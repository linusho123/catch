import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { NOTIFY_RETRY_MS } from '../../server/src/notify.ts'
import { wearerOf } from '../../server/src/phone/api.ts'
import { harness, HARNESS_TOKEN, type Harness } from '../harness/index.ts'
import { linesOf } from '../harness/notifications.ts'
import { openPhone, sectionsOn } from '../harness/phone.ts'

// P2a end to end, outside the feature files: a promise said to the glasses
// reaches the phone. The notification waits for a phone that is off, however
// long (D114, the promise half of "Notifications wait for an unreachable
// phone", whose kept half is P4's), and the phone page's conversation screen
// lists the promise under YOU (D98, D130), read from the markup the page drew.

const ACCOUNT = wearerOf(HARNESS_TOKEN)

let h: Harness
beforeAll(async () => {
  h = await harness()
})
afterAll(() => h.close())
beforeEach(() => h.reset())

/** Plays promise-deck.wearer-louder to its end, then long-presses: the conversation ends with its one promise. */
async function promiseThenEnd(): Promise<void> {
  await h.startLens()
  for (let i = 0; i < 100 && h.host.payloads().length < 2; i++) await h.clock.sleepUntil(h.clock.now() + 20)
  const run = h.play('promise-deck.wearer-louder')
  await run.playTo()
  await run.playTo(run.seconds(h.clock.now()) + 2)
  h.host.push('sysEvent', { eventType: 9, eventSource: 1 })
  await run.playTo(run.seconds(h.clock.now()) + 0.5)
  expect(h.modelErrors).toEqual([])
}

describe("the wearer's promise on the phone", () => {
  it('waits for a phone that is off, three hours, and arrives whole once it is back on (D114)', async () => {
    h.notifications.reachable = false
    await promiseThenEnd()
    expect(h.notifications.received).toEqual([])
    expect(h.notifications.refused.map((c) => c.to)).toEqual([ACCOUNT])
    h.clock.advance(3 * 60 * 60_000)
    await new Promise((r) => setImmediate(r))
    expect(h.notifications.received, 'nothing while the phone is off').toEqual([])
    expect(h.notifications.refused.length, 'tried again while it was off').toBeGreaterThan(1)
    h.notifications.reachable = true
    const back = h.clock.now()
    h.clock.advance(NOTIFY_RETRY_MS)
    await new Promise((r) => setImmediate(r))
    const got = h.notifications.phone(ACCOUNT)
    expect(got.map((c) => linesOf(c.notification))).toEqual([['Catch', 'Send Dev the deck tonight']])
    expect(got[0]!.at - back).toBeLessThanOrEqual(NOTIFY_RETRY_MS)
  })

  it("lists it under YOU on the conversation's screen the notification opens (D98)", async () => {
    await promiseThenEnd()
    const [sent] = h.notifications.phone(ACCOUNT)
    expect(sent, 'the notification').toBeDefined()
    const conversation = Number(sent!.notification.data?.conversation)
    const { phone, record } = await openPhone({ server: h.server.url, token: HARNESS_TOKEN, clock: h.clock })
    await phone.open(conversation)
    expect(sectionsOn(record.screens.at(-1)!.markup).map((s) => [s.title, s.promises.map((p) => p.text)])).toEqual([
      ['YOU', ['Send Dev the deck tonight']],
      ['OWED TO YOU', []],
    ])
  })
})
