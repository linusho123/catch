import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { harness, HARNESS_TOKEN, type Harness } from '../harness/index.ts'
import { openPhone, rowsOn } from '../harness/phone.ts'

// On the real G2 the Even OS keeps long-press for itself ("end this
// feature?"), so a conversation could only end after ten minutes of the
// wearer's silence. The phone page's "End conversation" does what a
// long-press does (D52): the conversation ends now and its promises reach
// the history (operator, on the glasses; DESIGN.md, chosen).
let h: Harness
beforeAll(async () => {
  h = await harness()
})
afterAll(() => h.close())
beforeEach(() => h.reset())

describe('ending the conversation from the phone page', () => {
  it('ends the open conversation as a long-press would, and the history then lists it with its promise', async () => {
    await h.startLens()
    for (let i = 0; i < 100 && h.host.payloads().length < 2; i++) await h.clock.sleepUntil(h.clock.now() + 20)
    const run = h.play('promise-deck.wearer-louder')
    await run.playTo()
    await run.playTo(run.seconds(h.clock.now()) + 2)
    const { phone, record } = await openPhone({ server: h.server.url, token: HARNESS_TOKEN, clock: h.clock })
    await phone.home()
    expect(rowsOn(record.innerHTML), 'nothing listed while the conversation is open').toEqual([])
    await phone.endConversation()
    await run.playTo(run.seconds(h.clock.now()) + 4)
    await phone.home()
    const listed = rowsOn(record.innerHTML)
    expect(listed, 'the ended conversation is listed').toHaveLength(1)
    expect(listed[0]!.names).toContain('Dev')
  })

  it('answers quietly when no conversation is open, and refuses a wrong token', async () => {
    const end = (token?: string) =>
      fetch(`${h.server.url}/phone/end`, { method: 'POST', ...(token === undefined ? {} : { headers: { authorization: `Bearer ${token}` } }) })
    expect((await end(HARNESS_TOKEN)).status).toBe(200)
    expect((await end('wrong')).status).toBe(401)
    expect((await end()).status).toBe(401)
    expect((await fetch(`${h.server.url}/phone/end`, { headers: { authorization: `Bearer ${HARNESS_TOKEN}` } })).status).toBe(405)
  })
})
