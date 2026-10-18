import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { startServer, type RunningServer } from '../../server/src/app.ts'
import type { ModelClient } from '../../server/src/llm/client.ts'
import type { Notifier, PhoneNotification } from '../../server/src/notify.ts'
import type { SpeechToText, SttWord } from '../../server/src/stt/types.ts'
import type { LensView } from '../../shared/lens-protocol.ts'
import { encodeFrame } from '../../shared/wire.ts'
import { VirtualClock } from '../harness/clock.ts'
import { pcmAt } from '../harness/player.ts'
import { find, rows } from '../harness/store-reader.ts'

// A restart of the server process (P9, D73), through real sockets on a store
// of its own, closed and started again on the same file: what the second
// process knows it read from the store, never from the first one's memory.
// The open conversation is taken up again, with its names, its promises and
// its transcript, and is one conversation, not two; the quiet rule runs on
// the clock across the restart, so a conversation no lens ever comes back to
// ends and its words go (D92, D76); the notifications waiting for a phone
// survive it and arrive once (D114). Read from the store directly, from the
// lens's socket and from the phone's capture.

const TOKEN = 'restart-test-token-not-a-secret'
const WEARER_DBFS = -12
const OTHER_DBFS = -28
const FRAME_MS = 100
const WORD_S = 0.3

/** The wearer's promise, by the promise prompt; anything else is none. */
const model: ModelClient = {
  complete: async (_m, prompt) =>
    prompt.includes('The wearer now says: ') && /The wearer now says: I'll send you the Zanzibar deck\./.test(prompt)
      ? JSON.stringify({ promise: true, summary: 'send Priya the Zanzibar deck' })
      : JSON.stringify({ promise: false }),
}

/** The phone: refuses while `reachable` is false, records what it took. */
class Phone implements Notifier {
  reachable = true
  readonly received: { to: string; notification: PhoneNotification }[] = []
  refused = 0
  async send(to: string, notification: PhoneNotification): Promise<boolean> {
    if (!this.reachable) {
      this.refused++
      return false
    }
    this.received.push({ to, notification })
    return true
  }
}

/** A speech-to-text stand-in whose words the test hands to the stream open now. */
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
})

function newStore(): string {
  return join(mkdtempSync(join(tmpdir(), 'catch-restart-')), 'catch.db')
}

/** The lens's capture clock: one for the whole test, as Date.now is across a restart. */
let captureCursor = 0

async function start(dbPath: string, clock: VirtualClock, phone?: Phone) {
  const { stt, say } = scriptedStt()
  const server = await startServer({ port: 0, host: '127.0.0.1', dbPath, audioToken: TOKEN, clock, stt, model, ...(phone ? { notifier: phone } : {}) })
  servers.push(server)
  return { server, say }
}

async function stop(server: RunningServer): Promise<void> {
  for (const s of sockets.splice(0)) s.terminate()
  await server.close()
  servers.splice(servers.indexOf(server), 1)
}

/** One plugin launch's lens: a socket, the views the server sent it, and where its stream's first audio was captured. */
async function lens(server: RunningServer, launch: string) {
  const socket = new WebSocket(`${server.url.replace(/^http/, 'ws')}/audio?token=${TOKEN}&lens=${launch}`)
  sockets.push(socket)
  const views: LensView[] = []
  let acks = 0
  socket.on('message', (data) => {
    const msg = JSON.parse(String(data)) as { type: string; view?: LensView }
    if (msg.type === 'show') views.push(msg.view!)
    if (msg.type === 'ack') acks++
  })
  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve())
    socket.once('error', reject)
  })
  const until = async (ok: () => boolean, what: string) => {
    for (let i = 0; i < 200 && !ok(); i++) await new Promise((r) => setTimeout(r, 10))
    expect(ok(), what).toBe(true)
  }
  await until(() => views.at(-1)?.kind === 'dot', 'the lens shows the dot once Catch hears')
  let first: number | undefined
  let seq = 0
  return {
    socket,
    views,
    until,
    /** `text` at `dbfs`: its frames, acknowledged, then its words, timed from this lens's first audio. */
    async say(sayWords: (w: SttWord[]) => void, text: string, dbfs: number) {
      const tokens = text.split(' ')
      const frames = Math.ceil((tokens.length * WORD_S + 0.2) / (FRAME_MS / 1000))
      const at = captureCursor
      first ??= at
      const before = acks
      for (let i = 0; i < frames; i++) {
        socket.send(encodeFrame({ seq: seq++, captureMs: at + (i + 1) * FRAME_MS, speakerRole: 'unknown', direction: null, pcm: pcmAt(dbfs) }))
      }
      captureCursor = at + frames * FRAME_MS + 1000
      await until(() => acks === before + frames, 'the server acknowledged every frame')
      const base = (at - first) / 1000
      sayWords(tokens.map((t, i) => ({ text: t, start: base + i * WORD_S, end: base + (i + 1) * WORD_S, confidence: 1, speaker: null, isFinal: true })))
    },
    touch(gesture: 'tap' | 'long-press' | 'swipe-down' | 'swipe-up') {
      socket.send(JSON.stringify({ type: 'touch', gesture }))
    },
  }
}

/** Every byte the store keeps on disk: the database file and its write-ahead log. */
function bytesOnDisk(dbPath: string): string {
  return [dbPath, `${dbPath}-wal`]
    .filter((p) => existsSync(p))
    .map((p) => readFileSync(p).toString('latin1'))
    .join('')
}

const lineShown = (views: LensView[], text: string) => views.some((v) => v.kind === 'line' && v.text === text)

describe('the server restarts mid-conversation (P9, D73)', () => {
  it('takes up the open conversation: a lens from a fresh launch re-attaches to it, and it ends once, with every name and promise', async () => {
    const dbPath = newStore()
    const clock = new VirtualClock(1)
    const one = await start(dbPath, clock)
    const a = await lens(one.server, 'launch-1')
    await a.say(one.say, 'Morning, everyone.', WEARER_DBFS)
    await a.say(one.say, "Hi, I'm Priya.", OTHER_DBFS)
    await a.until(() => lineShown(a.views, 'Priya'), 'Priya is caught')
    await a.say(one.say, "I'll send you the Zanzibar deck.", WEARER_DBFS)
    await a.until(() => lineShown(a.views, 'promised · send Priya the Zanzibar deck'), 'the promise is held')
    await stop(one.server)
    // The store holds it between the processes: the open conversation, and its words.
    expect(rows(dbPath, 'sessions').map((r) => r.open)).toEqual([1])
    expect(find(dbPath, 'Zanzibar').map((h) => h.table).sort()).toEqual(['sessions', 'transcript'])

    const two = await start(dbPath, clock)
    const b = await lens(two.server, 'launch-2')
    // Someone other than the wearer speaks first after the restart: with no conversation open that would begin one (D129); here it is the same one.
    await b.say(two.say, "Hi, I'm Dev.", OTHER_DBFS)
    await b.until(() => lineShown(b.views, 'Dev'), 'Dev is caught in the same conversation')
    await new Promise((r) => setTimeout(r, 1600))
    b.touch('tap')
    await b.until(() => b.views.some((v) => v.kind === 'names' && v.names.join() === 'Priya,Dev'), 'the names page holds both, in order')
    b.touch('swipe-down')
    await b.until(() => b.views.some((v) => v.kind === 'promises' && v.you.join() === 'send Priya the Zanzibar deck'), 'the promises page holds the promise made before the restart')
    b.touch('long-press')
    await b.until(() => rows(dbPath, 'conversations').length > 0, 'the conversation ended')
    const conversations = rows(dbPath, 'conversations')
    expect(conversations, 'one conversation, never a second one begun at the restart').toHaveLength(1)
    expect(JSON.parse(String(conversations[0]!.names))).toEqual(['Priya', 'Dev'])
    expect(rows(dbPath, 'promises').map((r) => r.text)).toEqual(['Send Priya the Zanzibar deck'])
    // Deleted at its end like any other (D76).
    expect(rows(dbPath, 'transcript')).toEqual([])
    expect(rows(dbPath, 'sessions').map((r) => r.open)).toEqual([0])
    expect(bytesOnDisk(dbPath), 'the transcript is gone from the file').not.toContain('Morning,')
  })

  it('ends a conversation whose ten minutes of quiet ran out while no server ran, as it starts, and deletes its words, rows and bytes', async () => {
    const dbPath = newStore()
    const clock = new VirtualClock(1)
    const one = await start(dbPath, clock)
    const a = await lens(one.server, 'launch-1')
    await a.say(one.say, 'The Quetzal plan is ready.', WEARER_DBFS)
    await stop(one.server)
    expect(find(dbPath, 'Quetzal').map((h) => h.table)).toEqual(['transcript'])
    clock.advance(11 * 60_000)
    const two = await start(dbPath, clock)
    expect(rows(dbPath, 'transcript'), 'the abandoned conversation left no transcript').toEqual([])
    expect(bytesOnDisk(dbPath)).not.toContain('Quetzal')
    expect(rows(dbPath, 'sessions').map((r) => r.open)).toEqual([0])
    await stop(two.server)
  })

  it('ends one that no lens comes back to when its ten minutes run out after the restart, not ten minutes after it', async () => {
    const dbPath = newStore()
    const clock = new VirtualClock(1)
    const one = await start(dbPath, clock)
    const a = await lens(one.server, 'launch-1')
    await a.say(one.say, 'The Quetzal plan is ready.', WEARER_DBFS)
    const quietUntil = (JSON.parse(String(rows(dbPath, 'sessions')[0]!.state)) as { conversation: { quietUntil: number } }).conversation.quietUntil
    await stop(one.server)
    clock.advance(6 * 60_000)
    const two = await start(dbPath, clock)
    expect(rows(dbPath, 'transcript').length, 'still open after six minutes').toBeGreaterThan(0)
    clock.advance(quietUntil - clock.now() - 5000)
    expect(rows(dbPath, 'transcript').length, 'still open five seconds before its ten minutes').toBeGreaterThan(0)
    clock.advance(5000)
    expect(rows(dbPath, 'transcript'), 'gone at its ten minutes, with no lens ever back').toEqual([])
    expect(bytesOnDisk(dbPath)).not.toContain('Quetzal')
    await stop(two.server)
  })
})

describe('notifications waiting for the phone survive a restart (P9, D114)', () => {
  it('arrive once the phone is back, after the process that queued them has gone, and only once', async () => {
    const dbPath = newStore()
    const clock = new VirtualClock(1)
    const phone = new Phone()
    phone.reachable = false
    const one = await start(dbPath, clock, phone)
    const a = await lens(one.server, 'launch-1')
    await a.say(one.say, 'Morning.', WEARER_DBFS)
    await a.say(one.say, "Hi, I'm Priya.", OTHER_DBFS)
    await a.say(one.say, "I'll send you the Zanzibar deck.", WEARER_DBFS)
    await a.until(() => lineShown(a.views, 'promised · send Priya the Zanzibar deck'), 'the promise is held')
    a.touch('long-press')
    await a.until(() => phone.refused > 0, 'the phone was tried')
    expect(rows(dbPath, 'outbox')).toHaveLength(1)
    await stop(one.server)

    phone.reachable = true
    const two = await start(dbPath, clock, phone)
    await a.until(() => phone.received.length > 0, 'the notification arrived after the restart')
    expect(phone.received.map((r) => r.notification.body)).toEqual(['Send Priya the Zanzibar deck'])
    expect(rows(dbPath, 'outbox'), 'taken, so it leaves the store').toEqual([])
    await stop(two.server)
    const three = await start(dbPath, clock, phone)
    await new Promise((r) => setTimeout(r, 50))
    expect(phone.received, 'never sent twice').toHaveLength(1)
    await stop(three.server)
  })
})

describe('a transcript no open conversation owns (P9, D76)', () => {
  it('is gone, rows and bytes, as the server starts: its session row was lost or cannot be read', async () => {
    for (const damage of ['DELETE FROM sessions', "UPDATE sessions SET state = 'not json'"]) {
      const dbPath = newStore()
      const clock = new VirtualClock(1)
      const one = await start(dbPath, clock)
      const a = await lens(one.server, 'launch-1')
      await a.say(one.say, 'The Zanzibar plan is ready.', WEARER_DBFS)
      await stop(one.server)
      const db = new DatabaseSync(dbPath)
      db.exec(damage)
      db.close()
      const two = await start(dbPath, clock)
      expect(rows(dbPath, 'transcript'), damage).toEqual([])
      expect(bytesOnDisk(dbPath), damage).not.toContain('Zanzibar')
      await stop(two.server)
    }
  })
})
