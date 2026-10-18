import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { startServer, type RunningServer } from '../../server/src/app.ts'
import { wearerOf } from '../../server/src/phone/api.ts'
import { History } from '../../server/src/phone/history.ts'
import { systemClock } from '../../shared/clock.ts'
import type { ConversationResponse, HistoryResponse } from '../../shared/phone-protocol.ts'
import { openPhone, rowsOn, sectionsOn } from '../harness/phone.ts'
import { rows } from '../harness/store-reader.ts'

// P7 (D39, D133): the phone page's one write, a promise ticked off, on a real
// server over its SQLite file. The second reviewer's focus: idempotency (a
// double tap, a tick of a promise already ticked), another wearer's token
// refused, a tick that only hid the row locally (read back from the store's
// file, never the API), and a tick that outlives a reload and a restart (P9).

// Throwaway tokens for this file only; the real one is the Fly secret CATCH_AUDIO_TOKEN.
const TOKEN = 'tick-test-token-not-a-secret'
const OTHER = 'tick-test-other-token-not-a-secret'
const at = (h: number, m: number) => new Date(2026, 9, 17, h, m).getTime()

const servers: RunningServer[] = []
afterEach(async () => {
  for (const s of servers.splice(0)) await s.close().catch(() => {})
})

async function serve(dbPath: string): Promise<RunningServer> {
  const server = await startServer({ port: 0, host: '127.0.0.1', dbPath, audioToken: TOKEN, otherAudioTokens: [OTHER] })
  servers.push(server)
  return server
}

/** A server with Dev's conversation (two of the wearer's, one owed) for TOKEN, and Zed's for OTHER. */
async function seeded() {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'catch-tick-')), 'catch.db')
  const server = await serve(dbPath)
  const history = new History(server.store)
  const dev = history.record(wearerOf(TOKEN), { startedAt: at(9, 5), endedAt: at(9, 40), names: ['Dev'], you: ['Send Dev the deck tonight', 'Introduce Dev to Sam'], owed: ['Dev sends the agenda'], kept: false })!
  const zed = history.record(wearerOf(OTHER), { startedAt: at(10, 0), endedAt: at(10, 5), names: ['Zed'], you: ['Send Zed the plan'], owed: [], kept: false })!
  const ids = (conversation: number) =>
    (rows(dbPath, 'promises') as { id: number; conversation_id: number; text: string }[]).filter((p) => p.conversation_id === conversation).map((p) => [p.text, p.id] as const)
  return { dbPath, server, dev, zed, promise: Object.fromEntries([...ids(dev), ...ids(zed)]) as Record<string, number> }
}

const tick = (server: RunningServer, id: number, token?: string, method = 'PUT') =>
  fetch(`${server.url}/phone/promises/${id}/done`, { method, ...(token === undefined ? {} : { headers: { authorization: `Bearer ${token}` } }) })
const get = (server: RunningServer, path: string, token = TOKEN) => fetch(`${server.url}${path}`, { headers: { authorization: `Bearer ${token}` } })
/** Each promise's done flag, read from the store's file. */
const doneIn = (dbPath: string) => Object.fromEntries((rows(dbPath, 'promises') as { text: string; done: number }[]).map((p) => [p.text, p.done]))

describe('the tick write (P7)', () => {
  it("marks the promise done in the store and answers its conversation's screen as it now stands", async () => {
    const { dbPath, server, dev, promise } = await seeded()
    const res = await tick(server, promise['Send Dev the deck tonight']!, TOKEN)
    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    const screen = (await res.json()) as ConversationResponse
    expect(screen.id).toBe(dev)
    expect(screen.you.map((p) => [p.text, p.done])).toEqual([
      ['Send Dev the deck tonight', true],
      ['Introduce Dev to Sam', false],
    ])
    expect(doneIn(dbPath)).toEqual({ 'Send Dev the deck tonight': 1, 'Introduce Dev to Sam': 0, 'Dev sends the agenda': 0, 'Send Zed the plan': 0 })
    // The history's open count drops: only the wearer's own count (operator answer 2).
    const history = (await (await get(server, '/phone/history')).json()) as HistoryResponse
    expect([history.open, history.conversations.map((c) => c.open)]).toEqual([1, [1]])
  })

  it('is idempotent: a double tap and a tick of a promise already ticked change nothing and error nothing', async () => {
    const { dbPath, server, promise } = await seeded()
    const id = promise['Introduce Dev to Sam']!
    const [a, b] = await Promise.all([tick(server, id, TOKEN), tick(server, id, TOKEN)])
    expect([a.status, b.status]).toEqual([200, 200])
    const before = rows(dbPath, 'promises')
    const again = await tick(server, id, TOKEN)
    expect(again.status).toBe(200)
    expect(((await again.json()) as ConversationResponse).you.map((p) => p.done)).toEqual([false, true])
    expect(rows(dbPath, 'promises'), 'the store is as it was').toEqual(before)
  })

  it("refuses a tick without the token or with a wrong one, and another wearer's promise, touching nothing", async () => {
    const { dbPath, server, promise } = await seeded()
    const zeds = promise['Send Zed the plan']!
    expect((await tick(server, zeds)).status).toBe(401)
    expect((await tick(server, zeds, 'wrong')).status).toBe(401)
    // A signed-in account's token, on a promise of the other account's.
    expect((await tick(server, zeds, TOKEN)).status).toBe(404)
    expect((await tick(server, promise['Dev sends the agenda']!, OTHER)).status).toBe(404)
    expect((await tick(server, 999_999, TOKEN)).status).toBe(404)
    expect((await fetch(`${server.url}/phone/promises/nope/done`, { method: 'PUT', headers: { authorization: `Bearer ${TOKEN}` } })).status).toBe(404)
    expect((await fetch(`${server.url}/phone/promises/${zeds}`, { method: 'PUT', headers: { authorization: `Bearer ${OTHER}` } })).status).toBe(404)
    expect(Object.values(doneIn(dbPath)), 'nothing was ticked').toEqual([0, 0, 0, 0])
    // Its own wearer can.
    expect((await tick(server, zeds, OTHER)).status).toBe(200)
    expect(doneIn(dbPath)['Send Zed the plan']).toBe(1)
  })

  it('takes PUT only, and lets a page on another origin send it', async () => {
    const { dbPath, server, promise } = await seeded()
    expect((await tick(server, promise['Introduce Dev to Sam']!, TOKEN, 'GET')).status).toBe(405)
    expect((await tick(server, promise['Introduce Dev to Sam']!, TOKEN, 'POST')).status).toBe(405)
    expect((await fetch(`${server.url}/phone/history`, { method: 'PUT', headers: { authorization: `Bearer ${TOKEN}` } })).status).toBe(405)
    expect(Object.values(doneIn(dbPath))).toEqual([0, 0, 0, 0])
    const preflight = await fetch(`${server.url}/phone/promises/1/done`, { method: 'OPTIONS' })
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('access-control-allow-methods')).toContain('PUT')
    expect(preflight.headers.get('access-control-allow-headers')).toContain('authorization')
  })

  it('outlives a reload of the phone page and a restart of the server (P9)', async () => {
    const { dbPath, server, dev, promise } = await seeded()
    const clock = { ...systemClock, now: () => at(18, 0) }
    const first = await openPhone({ server: server.url, token: TOKEN, clock })
    await first.phone.open(dev)
    await first.phone.tick(promise['Dev sends the agenda']!)
    await first.phone.tick(promise['Send Dev the deck tonight']!)
    await server.close()
    servers.splice(servers.indexOf(server), 1)
    const again = await serve(dbPath)
    const reloaded = await openPhone({ server: again.url, token: TOKEN, clock })
    await reloaded.phone.open(dev)
    expect(sectionsOn(reloaded.record.innerHTML).map((s) => [s.title, s.promises.map((p) => p.text)])).toEqual([
      ['YOU', ['Introduce Dev to Sam']],
      ['OWED TO YOU', []],
    ])
    await reloaded.phone.home()
    expect(rowsOn(reloaded.record.innerHTML).map((r) => r.open)).toEqual(['1 open'])
  })
})
