import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { startServer, type RunningServer } from '../../server/src/app.ts'
import { wearerOf } from '../../server/src/phone/api.ts'
import { History } from '../../server/src/phone/history.ts'
import type { ConversationResponse } from '../../shared/phone-protocol.ts'

// D135 (operator, on the real G2): names and promises can be added by hand
// to a conversation on the phone page, a promise either the wearer's (YOU)
// or owed to the wearer (OWED TO YOU).
const TOKEN = 'add-test-token-not-a-secret'
const OTHER = 'add-test-other-token-not-a-secret'
const servers: RunningServer[] = []
afterEach(async () => {
  for (const s of servers.splice(0)) await s.close().catch(() => {})
})

async function seeded() {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'catch-add-')), 'catch.db')
  const server = await startServer({ port: 0, host: '127.0.0.1', dbPath, audioToken: TOKEN, otherAudioTokens: [OTHER] })
  servers.push(server)
  const history = new History(server.store)
  const mine = history.record(wearerOf(TOKEN), { startedAt: 1, endedAt: 2, names: ['Dev'], you: ['Send Dev the deck tonight'], owed: [], kept: false })!
  const theirs = history.record(wearerOf(OTHER), { startedAt: 1, endedAt: 2, names: ['Zed'], you: ['Send Zed the plan'], owed: [], kept: false })!
  return { server, mine, theirs }
}

const post = (server: RunningServer, path: string, body: unknown, token: string | undefined = TOKEN) =>
  fetch(`${server.url}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token === undefined ? {} : { authorization: `Bearer ${token}` }) },
    body: JSON.stringify(body),
  })

describe('adding names and promises by hand (D135)', () => {
  it('adds a name to the conversation, after the names caught', async () => {
    const { server, mine } = await seeded()
    const res = await post(server, `/phone/conversations/${mine}/names`, { name: '  Priya ' })
    expect(res.status).toBe(200)
    expect(((await res.json()) as ConversationResponse).names).toEqual(['Dev', 'Priya'])
  })

  it('adds a promise to YOU or to OWED TO YOU, after those already there, open', async () => {
    const { server, mine } = await seeded()
    await post(server, `/phone/conversations/${mine}/promises`, { side: 'you', text: 'Book the room' })
    const res = await post(server, `/phone/conversations/${mine}/promises`, { side: 'owed', text: 'Dev sends the agenda' })
    const c = (await res.json()) as ConversationResponse
    expect(c.you.map((p) => [p.text, p.done])).toEqual([['Send Dev the deck tonight', false], ['Book the room', false]])
    expect(c.owed.map((p) => p.text)).toEqual(['Dev sends the agenda'])
  })

  it('refuses an empty or overlong entry, a wrong side, a wrong token, and another wearer\'s conversation, changing nothing', async () => {
    const { server, mine, theirs } = await seeded()
    expect((await post(server, `/phone/conversations/${mine}/names`, { name: '   ' })).status).toBe(400)
    expect((await post(server, `/phone/conversations/${mine}/promises`, { side: 'you', text: 'x'.repeat(301) })).status).toBe(400)
    expect((await post(server, `/phone/conversations/${mine}/promises`, { side: 'theirs', text: 'Book it' })).status).toBe(400)
    expect((await post(server, `/phone/conversations/${mine}/names`, { name: 'Priya' }, 'wrong')).status).toBe(401)
    expect((await post(server, `/phone/conversations/${theirs}/names`, { name: 'Priya' })).status).toBe(404)
    const got = (await (await fetch(`${server.url}/phone/conversations/${mine}`, { headers: { authorization: `Bearer ${TOKEN}` } })).json()) as ConversationResponse
    expect(got.names).toEqual(['Dev'])
    expect(got.you.map((p) => p.text)).toEqual(['Send Dev the deck tonight'])
  })
})
