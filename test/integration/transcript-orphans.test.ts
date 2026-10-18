import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import WebSocket from 'ws'
import { startServer, type RunningServer } from '../../server/src/app.ts'
import type { ModelClient } from '../../server/src/llm/client.ts'
import type { SpeechToText, SttWord } from '../../server/src/stt/types.ts'
import { encodeFrame } from '../../shared/wire.ts'
import { VirtualClock } from '../harness/clock.ts'
import { pcmAt } from '../harness/player.ts'
import { find, rows } from '../harness/store-reader.ts'
import { audioProtocols } from '../../shared/audio-token.ts'

// The server's own boundary rules, on a store of its own (the harness empties
// its store between scenarios, so the suite cannot see these from there).
//
// Fix round, risk-1 (D76), as P9 left it: a conversation the process was
// holding when it stopped is taken up again by the next one, and a transcript
// row no open conversation owns is deleted as the server starts
// (test/integration/restart.test.ts, which replaced P2a's purge of every row
// at start). forgetWearers, the harness's clean slate between scenarios,
// drops every open conversation, and its transcript with it.
//
// Fix round, head-log-1: a model answer that cannot be read is logged without
// a word of it.

const TOKEN = 'orphans-test-token-not-a-secret'
const WEARER_DBFS = -12
const FRAME_S = 0.1

/** A speech-to-text stand-in whose words the test hands over. */
function scriptedStt() {
  let deliver: ((words: SttWord[]) => void) | undefined
  const stt: SpeechToText = {
    name: 'scripted',
    open(onWords, _onError, onOpen) {
      deliver = onWords
      queueMicrotask(() => onOpen?.())
      return { sendPcm() {}, close() {} }
    },
  }
  return { stt, say: (words: SttWord[]) => deliver!(words) }
}

const servers: RunningServer[] = []
const sockets: WebSocket[] = []
afterEach(async () => {
  for (const s of sockets.splice(0)) s.terminate()
  for (const s of servers.splice(0)) await s.close().catch(() => {})
  vi.restoreAllMocks()
})

async function start(dbPath: string, model?: ModelClient) {
  const { stt, say } = scriptedStt()
  const clock = new VirtualClock(1)
  const server = await startServer({ port: 0, host: '127.0.0.1', dbPath, audioToken: TOKEN, clock, stt, model })
  servers.push(server)
  return { server, say, clock }
}

/** The wearer (loud frames, D126's loudness split) says `text`, one word every 0.3 s, through a real /audio socket. */
async function wearerSays(server: RunningServer, say: (words: SttWord[]) => void, text: string): Promise<void> {
  const socket = new WebSocket(`${server.url.replace(/^http/, 'ws')}/audio?lens=orphans`, audioProtocols(TOKEN))
  sockets.push(socket)
  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve())
    socket.once('error', reject)
  })
  const tokens = text.split(' ')
  const seconds = tokens.length * 0.3 + 0.2
  const frames = Math.ceil(seconds / FRAME_S)
  const acked = new Promise<void>((resolve) => {
    let n = 0
    socket.on('message', (data) => {
      if ((JSON.parse(String(data)) as { type: string }).type === 'ack' && ++n === frames) resolve()
    })
  })
  for (let seq = 0; seq < frames; seq++) {
    socket.send(encodeFrame({ seq, captureMs: (seq + 1) * FRAME_S * 1000, speakerRole: 'unknown', direction: null, pcm: pcmAt(WEARER_DBFS) }))
  }
  await acked
  say(tokens.map((t, i) => ({ text: t, start: i * 0.3, end: i * 0.3 + 0.3, confidence: 1, speaker: null, isFinal: true })))
}

/** Every byte the store keeps on disk: the database file and its write-ahead log. */
function bytesOnDisk(dbPath: string): string {
  return [dbPath, `${dbPath}-wal`]
    .filter((p) => existsSync(p))
    .map((p) => readFileSync(p).toString('latin1'))
    .join('')
}

describe('an orphaned transcript (risk-1, D76)', () => {
  it('is gone, rows and bytes, when the wearers are forgotten (the harness\'s clean slate)', async () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), 'catch-orphans-')), 'catch.db')
    const { server, say } = await start(dbPath)
    await wearerSays(server, say, 'The Zanzibar plan is ready.')
    expect(find(dbPath, 'Zanzibar').map((h) => h.table), 'the open conversation is held in the store').toEqual(['transcript'])
    server.forgetWearers()
    expect(rows(dbPath, 'transcript'), 'transcript rows survived forgetWearers').toEqual([])
    expect(bytesOnDisk(dbPath), "the words' bytes in the file or its log").not.toContain('Zanzibar')
  })
})

describe('a malformed model answer in the log (head-log-1)', () => {
  it('is logged as a failure, without the text of the answer', async () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), 'catch-orphans-')), 'catch.db')
    const logged: string[] = []
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => void logged.push(args.map(String).join(' ')))
    vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => void logged.push(args.map(String).join(' ')))
    const model: ModelClient = { complete: async () => 'Xylophone, Quentin' }
    const { server, say } = await start(dbPath, model)
    const failed = new Promise((resolve) => server.events.once('modelError', resolve))
    await wearerSays(server, say, "I'll send you the deck tonight.")
    await failed
    expect(logged.length, 'the failure is logged').toBeGreaterThan(0)
    for (const line of logged) expect(line).not.toMatch(/xylophone|quentin|deck/i)
  })
})
