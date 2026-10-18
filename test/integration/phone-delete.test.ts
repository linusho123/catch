import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { startServer, type RunningServer } from '../../server/src/app.ts'
import type { ModelClient } from '../../server/src/llm/client.ts'
import { NOTIFY_RETRY_MS } from '../../server/src/notify.ts'
import { StoredOutbox } from '../../server/src/notify-store.ts'
import { wearerOf } from '../../server/src/phone/api.ts'
import { History } from '../../server/src/phone/history.ts'
import type { SpeechToText, SttWord } from '../../server/src/stt/types.ts'
import type { LensView, ServerMessage } from '../../shared/lens-protocol.ts'
import type { HistoryResponse } from '../../shared/phone-protocol.ts'
import { encodeFrame } from '../../shared/wire.ts'
import { VirtualClock } from '../harness/clock.ts'
import { NotificationCapture } from '../harness/notifications.ts'
import { isHistory, openPhone, rowsOn } from '../harness/phone.ts'
import { pcmAt } from '../harness/player.ts'
import { find, rows } from '../harness/store-reader.ts'
import { audioProtocols } from '../../shared/audio-token.ts'

// D134 on a real server over its own SQLite file: a conversation deleted from
// its screen on the phone page is gone everywhere. Its history row, names,
// promises of both kinds, ticks and jogger, and any notification still
// waiting for the phone (D114), in one transaction, then scrubbed from the
// file the way an ended conversation's transcript is (secure_delete and the
// write-ahead log truncated). Read from the store's file directly (its rows
// and its bytes), from the notification capture across a restart (P9), and
// from the phone page's rendered history; never from the API whose job is to
// delete. The second reviewer's focus: data left behind (any table, the WAL,
// the outbox, a jogger still being written, a restart) and authorization
// (another wearer's conversation, a missing or wrong token, an id that is not
// a number). Deleting never touches the lens or its open conversation (P5).

// Throwaway tokens for this file only; the real one is the Fly secret CATCH_AUDIO_TOKEN.
const TOKEN = 'delete-test-token-not-a-secret'
const OTHER = 'delete-test-other-token-not-a-secret'
const WEARER_DBFS = -12
const OTHER_DBFS = -28
const FRAME_MS = 100
const WORD_S = 0.3
const at = (h: number, m: number) => new Date(2026, 9, 17, h, m).getTime()

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

/**
 * The wearer's one promise, by the promise prompt; a jogger pass waits for
 * `releaseJogger` (a jogger still being written when the delete lands).
 */
function scriptedModel() {
  let release!: () => void
  const jogger = new Promise<void>((r) => (release = r))
  let joggerAsked = 0
  let tidyAsked = 0
  const model: ModelClient = {
    complete: async (_m, prompt) => {
      if (prompt.includes('You tidy a memory jogger')) {
        tidyAsked++
        return JSON.stringify({ bullets: ['The Quokka plan is ready.'] })
      }
      if (prompt.includes('memory jogger')) {
        joggerAsked++
        await jogger
        return JSON.stringify({ bullets: [{ line: 1, text: 'The Quokka plan is ready.' }] })
      }
      return /The wearer now says: I'll send you the Zanzibar deck\./.test(prompt)
        ? JSON.stringify({ promise: true, summary: 'send Xiomara the Zanzibar deck' })
        : JSON.stringify({ promise: false })
    },
  }
  return { model, releaseJogger: () => release(), joggerAsked: () => joggerAsked, tidyAsked: () => tidyAsked }
}

const servers: RunningServer[] = []
const sockets: WebSocket[] = []
afterEach(async () => {
  for (const s of sockets.splice(0)) s.terminate()
  for (const s of servers.splice(0)) await s.close().catch(() => {})
})

const newStore = () => join(mkdtempSync(join(tmpdir(), 'catch-delete-')), 'catch.db')

async function start(dbPath: string, clock: VirtualClock, opts: { phone?: NotificationCapture; model?: ModelClient } = {}) {
  const { stt, say } = scriptedStt()
  const server = await startServer({
    port: 0,
    host: '127.0.0.1',
    dbPath,
    audioToken: TOKEN,
    otherAudioTokens: [OTHER],
    clock,
    stt,
    ...(opts.model ? { model: opts.model } : {}),
    ...(opts.phone ? { notifier: opts.phone } : {}),
  })
  servers.push(server)
  return { server, say }
}

async function stop(server: RunningServer): Promise<void> {
  for (const s of sockets.splice(0)) s.terminate()
  await server.close()
  servers.splice(servers.indexOf(server), 1)
}

const until = async (ok: () => boolean, what: string) => {
  for (let i = 0; i < 400 && !ok(); i++) await new Promise((r) => setTimeout(r, 5))
  expect(ok(), what).toBe(true)
}

/** The lens: a real /audio socket, the views the server sent it, and speech at a loudness (the loudness split, D126). */
async function lens(server: RunningServer, say: (w: SttWord[]) => void) {
  const socket = new WebSocket(`${server.url.replace(/^http/, 'ws')}/audio?lens=delete-test`, audioProtocols(TOKEN))
  sockets.push(socket)
  const views: LensView[] = []
  let acks = 0
  socket.on('message', (data) => {
    const msg = JSON.parse(String(data)) as ServerMessage
    if (msg.type === 'show') views.push(msg.view)
    if (msg.type === 'ack') acks++
  })
  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve())
    socket.once('error', reject)
  })
  await until(() => views.at(-1)?.kind === 'dot', 'the lens shows the dot once Catch hears')
  let seq = 0
  let cursor = 0
  return {
    views,
    async say(text: string, dbfs: number) {
      const tokens = text.split(' ')
      const frames = Math.ceil((tokens.length * WORD_S + 0.2) / (FRAME_MS / 1000))
      const from = cursor
      const before = acks
      for (let i = 0; i < frames; i++) {
        socket.send(encodeFrame({ seq: seq++, captureMs: (from + i + 1) * FRAME_MS, speakerRole: 'unknown', direction: null, pcm: pcmAt(dbfs) }))
      }
      cursor = from + frames + 10
      await until(() => acks === before + frames, 'the server acknowledged every frame')
      const base = (from * FRAME_MS) / 1000
      say(tokens.map((t, i) => ({ text: t, start: base + i * WORD_S, end: base + (i + 1) * WORD_S, confidence: 1, speaker: null, isFinal: true })))
    },
    touch(gesture: 'tap' | 'long-press' | 'swipe-up') {
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

const remove = (server: RunningServer, id: number | string, token?: string, method = 'DELETE') =>
  fetch(`${server.url}/phone/conversations/${id}`, { method, ...(token === undefined ? {} : { headers: { authorization: `Bearer ${token}` } }) })

/** Every row of the tables a conversation leaves for the phone, read from the file. */
const leftFor = (dbPath: string) => ({
  conversations: rows(dbPath, 'conversations'),
  promises: rows(dbPath, 'promises'),
  joggers: rows(dbPath, 'joggers'),
  outbox: rows(dbPath, 'outbox'),
})

describe('a conversation deleted from the phone page (D134)', () => {
  it('is gone everywhere: its rows, its name and promise in no byte of the file, its waiting notification never sent, not after a restart either; the lens is undisturbed', async () => {
    const dbPath = newStore()
    const clock = new VirtualClock(1)
    const phone = new NotificationCapture(clock)
    phone.reachable = false
    const { model } = scriptedModel()
    const one = await start(dbPath, clock, { phone, model })
    const a = await lens(one.server, one.say)
    await a.say('Morning.', WEARER_DBFS)
    await a.say("Hi, I'm Xiomara.", OTHER_DBFS)
    await until(() => a.views.some((v) => v.kind === 'line' && v.text === 'Xiomara'), 'Xiomara is caught')
    await a.say("I'll send you the Zanzibar deck.", WEARER_DBFS)
    await until(() => a.views.some((v) => v.kind === 'line' && v.text === 'promised · send Xiomara the Zanzibar deck'), 'the promise is held')
    a.touch('long-press')
    await until(() => phone.refused.length > 0, 'the phone was tried, and is off')
    const [conversation] = rows(dbPath, 'conversations') as { id: number }[]
    expect(rows(dbPath, 'outbox'), 'the notification waits in the store (D114)').toHaveLength(1)
    expect(find(dbPath, 'Xiomara').map((h) => h.table).sort(), 'the name, in its row, its promise and its notification').toEqual(['conversations', 'outbox', 'promises'])

    // The next conversation is open on the lens while the wearer deletes the last one on the phone.
    await a.say('The Quokka plan is ready.', WEARER_DBFS)
    await until(() => find(dbPath, 'Quokka').length > 0, 'the next conversation is open, its words in the store')
    const viewsBefore = a.views.length

    // The phone page: the conversation's screen, its delete, its confirm; back on the history, which no longer lists it.
    const page = await openPhone({ server: one.server.url, token: TOKEN, clock })
    await page.phone.home()
    expect(rowsOn(page.record.innerHTML).map((r) => [r.names, r.open])).toEqual([['Xiomara', '1 open']])
    await page.phone.open(conversation!.id)
    page.record.tap('data-delete', String(conversation!.id))
    page.record.tap('data-delete-confirm', String(conversation!.id))
    await until(() => isHistory(page.record.innerHTML), 'the page is back on the history')
    expect(rowsOn(page.record.innerHTML), 'the history no longer lists it').toEqual([])
    expect(page.record.innerHTML).toContain('<p class="open-total">all done</p>')

    // The far side: the file's rows and its bytes.
    expect(leftFor(dbPath)).toEqual({ conversations: [], promises: [], joggers: [], outbox: [] })
    expect(find(dbPath, 'Xiomara'), 'the name in any table').toEqual([])
    expect(find(dbPath, 'Zanzibar'), "the promise's words in any table").toEqual([])
    const bytes = bytesOnDisk(dbPath)
    expect(bytes, "the caught name's bytes in the file or its log").not.toContain('Xiomara')
    expect(bytes, "the promise's bytes in the file or its log").not.toContain('Zanzibar')

    // The lens heard nothing of it, and its open conversation is as it was.
    await new Promise((r) => setTimeout(r, 50))
    expect(a.views.length, 'nothing was sent to the lens').toBe(viewsBefore)
    expect(find(dbPath, 'Quokka').map((h) => h.table)).toEqual(['transcript'])
    expect(rows(dbPath, 'sessions').map((r) => r.open)).toEqual([1])

    // The phone comes back: nothing for the deleted conversation arrives, now or after a restart (P9).
    phone.reachable = true
    clock.advance(NOTIFY_RETRY_MS * 2)
    await new Promise((r) => setTimeout(r, 30))
    expect(phone.received, 'the waiting notification was never sent').toEqual([])
    await stop(one.server)
    const two = await start(dbPath, clock, { phone, model })
    await new Promise((r) => setTimeout(r, 50))
    expect(phone.received, 'nor after a restart').toEqual([])
    const after = (await (await fetch(`${two.server.url}/phone/history`, { headers: { authorization: `Bearer ${TOKEN}` } })).json()) as HistoryResponse
    expect(after.conversations, 'the restart re-created nothing').toEqual([])
    expect(leftFor(dbPath)).toEqual({ conversations: [], promises: [], joggers: [], outbox: [] })
    expect(bytesOnDisk(dbPath)).not.toContain('Xiomara')
  })

  it('takes a kept conversation whose jogger is still being written: it is cancelled, so no second pass is sent its words, and no jogger and no kept notification ever arrive for it', async () => {
    const dbPath = newStore()
    const clock = new VirtualClock(1)
    const phone = new NotificationCapture(clock)
    const { model, releaseJogger, joggerAsked, tidyAsked } = scriptedModel()
    const { server, say } = await start(dbPath, clock, { phone, model })
    const modelErrors: unknown[] = []
    server.events.on('modelError', ({ error }) => modelErrors.push(error))
    const a = await lens(server, say)
    await a.say('The Quokka plan is ready.', WEARER_DBFS)
    await until(() => a.views.at(-1)?.kind === 'dot', 'the dot is up')
    a.touch('swipe-up')
    await until(() => a.views.some((v) => v.kind === 'line' && v.text === 'keep this conversation?'), 'the keep prompt')
    a.touch('tap')
    await until(() => a.views.some((v) => v.kind === 'line' && v.text === 'kept'), '"kept"')
    clock.advance(2000)
    a.touch('long-press')
    await until(() => joggerAsked() > 0, 'the jogger is being written')
    const [conversation] = rows(dbPath, 'conversations') as { id: number }[]

    const res = await remove(server, conversation!.id, TOKEN)
    expect(res.status).toBe(200)
    releaseJogger()
    await new Promise((r) => setTimeout(r, 50))
    clock.advance(NOTIFY_RETRY_MS)
    await new Promise((r) => setTimeout(r, 20))
    expect(leftFor(dbPath), 'no jogger was stored for it, and no row came back').toEqual({ conversations: [], promises: [], joggers: [], outbox: [] })
    expect(phone.received.map((c) => c.notification.body), 'no "Kept:" notification').toEqual([])
    expect(tidyAsked(), "the tidy pass was never sent the deleted conversation's words").toBe(0)
    expect(modelErrors, 'a cancelled jogger is no model failure').toEqual([])
    expect(bytesOnDisk(dbPath)).not.toContain('Quokka')
  })

  it("head-1: cancels only the deleted conversation's jogger: another kept conversation's jogger, in flight at the same time, is stored and its \"Kept:\" notification arrives", async () => {
    const dbPath = newStore()
    const clock = new VirtualClock(1)
    const phone = new NotificationCapture(clock)
    const { model, releaseJogger, joggerAsked } = scriptedModel()
    const { server, say } = await start(dbPath, clock, { phone, model })
    const a = await lens(server, say)
    /** One kept conversation, ended, its jogger left being written. */
    const kept = async (words: string, asked: number) => {
      await a.say(words, WEARER_DBFS)
      await until(() => a.views.at(-1)?.kind === 'dot', 'the dot is up')
      const shown = a.views.length
      a.touch('swipe-up')
      await until(() => a.views.slice(shown).some((v) => v.kind === 'line' && v.text === 'keep this conversation?'), 'the keep prompt')
      a.touch('tap')
      await until(() => a.views.slice(shown).some((v) => v.kind === 'line' && v.text === 'kept'), '"kept"')
      clock.advance(2000)
      a.touch('long-press')
      await until(() => joggerAsked() === asked, 'its jogger is being written')
    }
    await kept('The Quokka plan is ready.', 1)
    await kept('The Wombat plan is ready.', 2)
    const [deleted, other] = (rows(dbPath, 'conversations') as { id: number }[]).map((r) => r.id).sort((x, y) => x - y)
    expect(other, 'two kept conversations, both joggers in flight').toBeDefined()

    expect((await remove(server, deleted!, TOKEN)).status).toBe(200)
    releaseJogger()
    await until(() => phone.received.length > 0, 'the kept conversation left alone has its "Kept:" notification')
    expect(
      (rows(dbPath, 'joggers') as { conversation_id: number }[]).map((r) => r.conversation_id),
      "the other conversation's jogger is stored, the deleted one's is not",
    ).toEqual([other])
    expect(phone.received.map((c) => [c.notification.data?.conversation, c.notification.body.startsWith('Kept:')])).toEqual([[String(other), true]])
  })
})

describe('the delete write (D134)', () => {
  /** A server with Dev's conversation (kept, with a jogger, a tick and a waiting notification) for TOKEN, and Zed's for OTHER. */
  async function seeded() {
    const dbPath = newStore()
    const { server } = await start(dbPath, new VirtualClock(1))
    const history = new History(server.store)
    const dev = history.record(wearerOf(TOKEN), { startedAt: at(9, 5), endedAt: at(9, 40), names: ['Dev'], you: ['Send Dev the deck tonight'], owed: ['Dev sends the agenda'], kept: true })!
    history.recordJogger(dev, ['Dev works on **diffusion models**.'])
    history.tick(wearerOf(TOKEN), history.conversation(wearerOf(TOKEN), dev)!.you[0]!.id)
    const zed = history.record(wearerOf(OTHER), { startedAt: at(10, 0), endedAt: at(10, 5), names: ['Zed'], you: ['Send Zed the plan'], owed: [], kept: false })!
    const outbox = new StoredOutbox(server.store)
    outbox.add(wearerOf(TOKEN), { title: 'Catch', body: 'Kept: conversation with Dev', data: { conversation: String(dev), screen: 'jogger' } })
    outbox.add(wearerOf(OTHER), { title: 'Catch', body: 'Send Zed the plan', data: { conversation: String(zed) } })
    return { dbPath, server, dev, zed }
  }

  it('answers the history as it now stands, and a second delete of the same conversation is a quiet success that changes nothing', async () => {
    const { dbPath, server, dev } = await seeded()
    const res = await remove(server, dev, TOKEN)
    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect((await res.json()) as HistoryResponse).toEqual({ open: 0, conversations: [] })
    const left = leftFor(dbPath)
    expect([left.conversations.length, left.promises.length, left.joggers.length, left.outbox.length], "only Zed's are left").toEqual([1, 1, 0, 1])
    expect(find(dbPath, 'Dev'), "Dev's name, promises, jogger and notification in any table").toEqual([])
    const again = await remove(server, dev, TOKEN)
    expect(again.status).toBe(200)
    expect((await again.json()) as HistoryResponse).toEqual({ open: 0, conversations: [] })
    expect(leftFor(dbPath), 'the store is as it was').toEqual(left)
  })

  it("refuses a missing or wrong token and an id that is not a number; another wearer's conversation is the same quiet success as a missing one; nothing changes", async () => {
    const { dbPath, server, dev, zed } = await seeded()
    const before = leftFor(dbPath)
    expect((await remove(server, dev)).status).toBe(401)
    expect((await remove(server, dev, 'wrong')).status).toBe(401)
    // Answer (1): a second token cannot learn which conversation numbers exist, so another wearer's answers as a missing one does.
    const missing = await remove(server, zed + 1000, TOKEN)
    const others = await remove(server, zed, TOKEN)
    expect([others.status, await others.json()], "another wearer's conversation, answered as a missing one is").toEqual([missing.status, await missing.json()])
    expect(others.status).toBe(200)
    const asOther = await remove(server, dev, OTHER)
    expect(asOther.status, "another wearer's conversation, from the other side").toBe(200)
    expect((await asOther.json()) as HistoryResponse, "only the asker's own history, as it stands").toEqual({ open: 1, conversations: [{ id: zed, startedAt: at(10, 0), names: ['Zed'], open: 1, kept: false }] })
    for (const id of ['nope', '1.5', '-1', '1e3', '%20', `${dev}/jogger`]) {
      expect([id, (await remove(server, id, TOKEN)).status], 'not a conversation it can delete').not.toEqual([id, 200])
    }
    expect((await fetch(`${server.url}/phone/history`, { method: 'DELETE', headers: { authorization: `Bearer ${TOKEN}` } })).status).toBe(405)
    expect((await remove(server, dev, TOKEN, 'POST')).status).toBe(405)
    expect(leftFor(dbPath), 'nothing was deleted').toEqual(before)
    // Its own wearer can.
    expect((await remove(server, zed, OTHER)).status).toBe(200)
    expect(find(dbPath, 'Zed')).toEqual([])
  })

  it('lets a page on another origin send it', async () => {
    const { server } = await seeded()
    const preflight = await fetch(`${server.url}/phone/conversations/1`, { method: 'OPTIONS' })
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('access-control-allow-methods')).toContain('DELETE')
  })
})
