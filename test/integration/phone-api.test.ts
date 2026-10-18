import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startServer, type RunningServer } from '../../server/src/app.ts'
import { wearerOf } from '../../server/src/phone/api.ts'
import { History } from '../../server/src/phone/history.ts'
import { systemClock } from '../../shared/clock.ts'
import type { HistoryResponse } from '../../shared/phone-protocol.ts'
import { isHistory, isJogger, joggerLinkOn, joggerOn, openPhone, rowsOn, sectionsOn } from '../harness/phone.ts'

// The phone API on a real server, and the phone page drawing from it (D130);
// its one write, the tick (P7), is tested in phone-tick.test.ts.
// The conversations are written into the store the way the server writes one
// as it ends; P2a's promises and P4's keep will write them through the
// pipeline, and the bound scenarios will read them through this same path.

let server: RunningServer
let history: History
// A throwaway token for this file only; the real one is the Fly secret CATCH_AUDIO_TOKEN.
const TOKEN = 'phone-test-token-not-a-secret'
const at = (h: number, m: number, day = 17) => new Date(2026, 9, day, h, m).getTime()

beforeAll(async () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'catch-phone-')), 'catch.db')
  server = await startServer({ port: 0, host: '127.0.0.1', dbPath, audioToken: TOKEN })
  history = new History(server.store)
  const me = wearerOf(TOKEN)
  history.record(me, { startedAt: at(9, 5), endedAt: at(9, 40), names: ['Dev'], you: ['Send Dev the deck tonight', 'Introduce Dev to Sam'], owed: ['Dev sends the agenda'], kept: false })
  history.record(me, { startedAt: at(14, 10), endedAt: at(14, 30), names: ['Priya'], you: ['Send Priya the link'], owed: [], kept: false })
  const ana = history.record(me, { startedAt: at(16, 0, 16), endedAt: at(17, 0, 16), names: ['Ana'], you: [], owed: [], kept: true })!
  history.recordJogger(ana, ['Her lab uses **diffusion models**.', '4 minutes not heard'])
  history.record(wearerOf('someone else'), { startedAt: at(15, 0), endedAt: at(15, 5), names: ['Zed'], you: ['Not yours'], owed: [], kept: false })
})
afterAll(() => server.close())

const get = (path: string, token?: string) => fetch(`${server.url}${path}`, token === undefined ? {} : { headers: { authorization: `Bearer ${token}` } })

describe('the phone API', () => {
  it('refuses a request without the shared token, or with the wrong one', async () => {
    expect((await get('/phone/history')).status).toBe(401)
    expect((await get('/phone/history', 'wrong')).status).toBe(401)
    expect((await get('/phone/conversations/1', 'wrong')).status).toBe(401)
  })

  it("answers the token's wearer with that wearer's history, newest first", async () => {
    const res = await get('/phone/history', TOKEN)
    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    const body = (await res.json()) as HistoryResponse
    expect(body.conversations.map((c) => [c.names, c.open, c.kept])).toEqual([
      [['Priya'], 1, false],
      [['Dev'], 2, false],
      [['Ana'], 0, true],
    ])
    // Only the wearer's own promises are open (operator answer 2): Dev's owed one is not counted.
    expect(body.open).toBe(3)
  })

  it("answers one conversation's screen, and nothing of another wearer's", async () => {
    const { conversations } = (await (await get('/phone/history', TOKEN)).json()) as HistoryResponse
    const dev = conversations.find((c) => c.names.includes('Dev'))!
    const screen = await (await get(`/phone/conversations/${dev.id}`, TOKEN)).json()
    expect(screen.you.map((p: { text: string }) => p.text)).toEqual(['Send Dev the deck tonight', 'Introduce Dev to Sam'])
    expect(screen.owed.map((p: { text: string }) => p.text)).toEqual(['Dev sends the agenda'])
    const zed = history.list(wearerOf('someone else')).conversations[0]!
    expect((await get(`/phone/conversations/${zed.id}`, TOKEN)).status).toBe(404)
    expect((await get('/phone/conversations/nope', TOKEN)).status).toBe(404)
  })

  it("answers a kept conversation's jogger (D99), and nothing for one with none or another wearer's", async () => {
    const { conversations } = (await (await get('/phone/history', TOKEN)).json()) as HistoryResponse
    const ana = conversations.find((c) => c.kept)!
    const res = await get(`/phone/conversations/${ana.id}/jogger`, TOKEN)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: ana.id, startedAt: at(16, 0, 16), endedAt: at(17, 0, 16), names: ['Ana'], bullets: ['Her lab uses **diffusion models**.', '4 minutes not heard'] })
    expect((await (await get(`/phone/conversations/${ana.id}`, TOKEN)).json()).jogger).toBe(true)
    const dev = conversations.find((c) => c.names.includes('Dev'))!
    expect((await (await get(`/phone/conversations/${dev.id}`, TOKEN)).json()).jogger).toBe(false)
    expect((await get(`/phone/conversations/${dev.id}/jogger`, TOKEN)).status).toBe(404)
    expect((await get(`/phone/conversations/${ana.id}/jogger`, 'wrong')).status).toBe(401)
    expect((await get(`/phone/conversations/${ana.id}/jogger`, wearerOf('x'))).status).toBe(401)
  })

  it('is read-only, and lets a page on another origin send the token', async () => {
    const post = await fetch(`${server.url}/phone/history`, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` } })
    expect(post.status).toBe(405)
    const preflight = await fetch(`${server.url}/phone/history`, { method: 'OPTIONS' })
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('access-control-allow-headers')).toContain('authorization')
  })
})

describe('the phone page on the API', () => {
  it('draws the history and, on a tap, the conversation with every promise under YOU and OWED TO YOU', async () => {
    const { phone, record } = await openPhone({ server: server.url, token: TOKEN, clock: { ...systemClock, now: () => at(18, 0) } })
    await phone.home()
    const rows = rowsOn(record.innerHTML)
    expect(rows.map((r) => [r.day, r.names, r.time, r.open, r.kept])).toEqual([
      ['TODAY', 'Priya', '2:10 pm', '1 open', false],
      ['TODAY', 'Dev', '9:05 am', '2 open', false],
      ['YESTERDAY', 'Ana', '4:00 pm', 'all done', true],
    ])
    await phone.open(Number(rows[1]!.conversation))
    expect(sectionsOn(record.innerHTML)).toEqual([
      { title: 'YOU', promises: [{ text: 'Send Dev the deck tonight', tickable: true }, { text: 'Introduce Dev to Sam', tickable: true }] },
      { title: 'OWED TO YOU', promises: [{ text: 'Dev sends the agenda', tickable: true }] },
    ])
    await phone.home()
    expect(isHistory(record.innerHTML)).toBe(true)
  })
})

describe("the phone page's jogger (D99)", () => {
  it('opens from the conversation screen\'s "Kept conversation ›", and from a kept notification: the names and the length, then one list with the terms in bold', async () => {
    const { phone, record } = await openPhone({ server: server.url, token: TOKEN, clock: { ...systemClock, now: () => at(18, 0) } })
    await phone.home()
    const ana = rowsOn(record.innerHTML).find((r) => r.kept)!
    await phone.open(Number(ana.conversation))
    expect(joggerLinkOn(record.innerHTML)).toBe(ana.conversation)
    record.tap('data-jogger', ana.conversation)
    for (let i = 0; i < 20 && !isJogger(record.innerHTML); i++) await new Promise((r) => setTimeout(r, 5))
    expect(joggerOn(record.innerHTML)).toEqual({
      names: 'Ana',
      length: '1 h',
      lists: 1,
      headings: [],
      bullets: [
        { text: 'Her lab uses diffusion models.', bold: ['diffusion models'] },
        { text: '4 minutes not heard', bold: [] },
      ],
    })
    await phone.home()
    await phone.openNotification({ conversation: ana.conversation, screen: 'jogger' })
    expect(isJogger(record.innerHTML)).toBe(true)
    await phone.openNotification({ conversation: ana.conversation })
    expect(sectionsOn(record.innerHTML).map((s) => s.title), 'a promise notification opens the conversation screen').toEqual(['YOU', 'OWED TO YOU'])
    const dev = rowsOn((await phone.home(), record.innerHTML)).find((r) => r.names === 'Dev')!
    await phone.open(Number(dev.conversation))
    expect(joggerLinkOn(record.innerHTML), 'no jogger, no link').toBeUndefined()
  })
})
