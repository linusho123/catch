import { describe, expect, it } from 'vitest'
import { VirtualClock } from '../../test/harness/clock.ts'
import { cutLine, listOf, NOTIFICATION_LINE_CHARS, NOTIFY_RETRY_MS, Outbox, promiseNotification, type Notifier, type PhoneNotification } from './notify.ts'

// The notification semantics on their own (D28, D51, D114, D117).

describe('the promise notification', () => {
  it('is one notification of commands on one line, carrying the conversation it opens (D28, D117)', () => {
    expect(promiseNotification(7, ['Send Dev the deck tonight', 'Introduce Dev to Sam'])).toEqual({
      title: 'Catch',
      body: 'Send Dev the deck tonight and introduce Dev to Sam',
      data: { conversation: '7' },
    })
    expect(listOf(['A', 'b', 'c'])).toBe('A, b and c')
  })

  it('is no notification at all when nothing was promised (D51)', () => {
    expect(promiseNotification(7, [])).toBeUndefined()
  })

  it('cuts a line too long for the notification at a word, with an ellipsis (D28)', () => {
    const long = 'Send Dev the deck tonight, introduce Dev to Sam, book the room for Thursday, email Dev the budget and call Dev on Monday'
    const cut = cutLine(long)
    expect(cut.length).toBeLessThanOrEqual(NOTIFICATION_LINE_CHARS)
    expect(cut.endsWith('…')).toBe(true)
    expect(long.startsWith(cut.slice(0, -1))).toBe(true)
    expect(cut).not.toMatch(/[ ,]…$/)
    expect(cutLine('Send Dev the deck')).toBe('Send Dev the deck')
  })
})

describe('the outbox', () => {
  function phone(clock: VirtualClock) {
    const got: { at: number; to: string; n: PhoneNotification }[] = []
    let reachable = false
    const notifier: Notifier = {
      async send(to, n) {
        if (reachable) got.push({ at: clock.now(), to, n })
        return reachable
      },
    }
    return { got, notifier, on: () => (reachable = true) }
  }

  it('holds a notification the phone did not take, tries again on the clock, and delivers it whole when the phone is back (D114)', async () => {
    const clock = new VirtualClock(1)
    const p = phone(clock)
    const outbox = new Outbox(p.notifier, clock)
    const n = { title: 'Catch', body: 'Send Dev the deck tonight' }
    outbox.enqueue('account', n)
    await Promise.resolve()
    clock.advance(3 * 60 * 60_000)
    await Promise.resolve()
    expect(p.got).toEqual([])
    expect(outbox.waiting).toBe(1)
    p.on()
    clock.advance(NOTIFY_RETRY_MS)
    await new Promise((r) => setImmediate(r))
    expect(p.got).toEqual([{ at: expect.any(Number), to: 'account', n }])
    expect(outbox.waiting).toBe(0)
    outbox.close()
  })

  it('sends in order, at once, to the phone it is addressed to', async () => {
    const clock = new VirtualClock(1)
    const p = phone(clock)
    p.on()
    const outbox = new Outbox(p.notifier, clock)
    outbox.enqueue('a', { title: 'Catch', body: 'one' })
    outbox.enqueue('a', { title: 'Catch', body: 'two' })
    await new Promise((r) => setImmediate(r))
    expect(p.got.map((g) => [g.to, g.n.body])).toEqual([
      ['a', 'one'],
      ['a', 'two'],
    ])
    for (const g of p.got) expect(g.at).toBeLessThan(50)
    outbox.close()
  })
})
