import { describe, expect, it, vi } from 'vitest'
import { VirtualClock } from '../../test/harness/clock.ts'
import { checkedTimeZone, cutLine, keptNotification, listOf, NOTIFICATION_LINE_CHARS, NOTIFY_RETRY_MS, Outbox, promiseNotification, type Notifier, type PhoneNotification } from './notify.ts'

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

  it('carries a second line for the promises owed to the wearer, "Owed to you: …" (D28, D117, P5)', () => {
    expect(promiseNotification(7, ['Send Dev the deck tonight', 'Introduce Dev to Sam'], ['Dev sends the agenda'])).toEqual({
      title: 'Catch',
      body: 'Send Dev the deck tonight and introduce Dev to Sam\nOwed to you: Dev sends the agenda',
      data: { conversation: '7' },
    })
    expect(promiseNotification(7, [], ['they (1) sends the deck tonight', 'Dev sends the slides'])?.body, 'only owed: one line').toBe(
      'Owed to you: they (1) sends the deck tonight and Dev sends the slides',
    )
    expect(promiseNotification(7, [], []), 'nothing in either direction: no notification (D51)').toBeUndefined()
  })

  it('cuts each line on its own when it is too long (D28)', () => {
    const owed = ['Dev sends the agenda for the offsite', 'Dev shares the notes from the planning call', 'Dev books the van for Friday morning']
    const body = promiseNotification(7, ['Send Dev the deck tonight'], owed)!.body.split('\n')
    expect(body[0]).toBe('Send Dev the deck tonight')
    expect(body[1]!.endsWith('…')).toBe(true)
    expect(body[1]!.length).toBeLessThanOrEqual(NOTIFICATION_LINE_CHARS)
    expect(body[1]!.startsWith('Owed to you: Dev sends the agenda')).toBe(true)
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

describe('the kept notification (D24)', () => {
  it('names the conversation by who was caught, and opens its jogger', () => {
    expect(keptNotification(7, ['Ana'], 0)).toEqual({ title: 'Catch', body: 'Kept: conversation with Ana', data: { conversation: '7', screen: 'jogger' } })
    expect(keptNotification(7, ['Priya', 'Marcus', 'Dana'], 0).body).toBe('Kept: conversation with Priya, Marcus and Dana')
  })

  it('names the time it began, in the wearer\'s zone, when nobody was caught', () => {
    const at = Date.UTC(2026, 9, 17, 21, 10)
    expect(keptNotification(7, [], at, 'America/Los_Angeles').body).toBe('Kept: conversation at 2:10 pm')
    expect(keptNotification(7, [], at, 'UTC').body).toBe('Kept: conversation at 9:10 pm')
  })

  // Fix round, risk-2: a mistyped CATCH_TIME_ZONE never costs a kept notification.
  it('is still sent with a mistyped zone: by name when one was caught, in the server\'s zone when none was', () => {
    const at = Date.UTC(2026, 9, 17, 21, 10)
    expect(keptNotification(1, ['Ana'], at, 'Foo/Bar').body).toBe('Kept: conversation with Ana')
    expect(keptNotification(1, [], at, 'Foo/Bar').body).toBe(keptNotification(1, [], at).body)
  })

  it('has its zone checked once at startup: a mistyped one is named in a warning and the server\'s own is used', () => {
    const warn = vi.fn()
    expect(checkedTimeZone('Foo/Bar', warn)).toBeUndefined()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]![0])).toMatch(/CATCH_TIME_ZONE.*Foo\/Bar/)
    expect(checkedTimeZone('America/Los_Angeles', warn)).toBe('America/Los_Angeles')
    expect(checkedTimeZone(undefined, warn)).toBeUndefined()
    expect(warn).toHaveBeenCalledTimes(1)
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

  // Fix round, risk-4: a phone that answers when the test says, so a send can be in flight across forget() or close().
  function slowPhone(clock: VirtualClock) {
    const tried: { at: number; to: string; body: string }[] = []
    const answers: ((taken: boolean) => void)[] = []
    const notifier: Notifier = {
      send(to, n) {
        tried.push({ at: clock.now(), to, body: n.body })
        return new Promise((resolve) => answers.push(resolve))
      },
    }
    return { tried, notifier, answer: (taken: boolean) => answers.shift()!(taken) }
  }
  const settle = () => new Promise((r) => setImmediate(r))

  it('never drops a notification queued after forget() when a send from before it answers late (risk-4 b, D114)', async () => {
    const clock = new VirtualClock(1)
    const p = slowPhone(clock)
    const outbox = new Outbox(p.notifier, clock)
    outbox.enqueue('a', { title: 'Catch', body: 'before the restart' })
    await settle()
    outbox.forget()
    outbox.enqueue('a', { title: 'Catch', body: 'after the restart' })
    await settle()
    // The old send answers now: it must not take the new notification with it.
    p.answer(true)
    await settle()
    expect(p.tried.map((t) => t.body), 'the notification queued after forget() was sent').toEqual(['before the restart', 'after the restart'])
    expect(outbox.waiting, 'it waits for its own send to answer').toBe(1)
    p.answer(true)
    await settle()
    expect(outbox.waiting).toBe(0)
    outbox.close()
  })

  it("delivers one account's notification at once while another account's phone is unreachable (risk-4 a, D79, D114)", async () => {
    const clock = new VirtualClock(1)
    const got: { to: string; body: string }[] = []
    const notifier: Notifier = {
      async send(to, n) {
        if (to === 'off') return false
        got.push({ to, body: n.body })
        return true
      },
    }
    const outbox = new Outbox(notifier, clock)
    outbox.enqueue('off', { title: 'Catch', body: 'for the phone that is off' })
    outbox.enqueue('on', { title: 'Catch', body: 'for the phone that is on' })
    await settle()
    expect(got, 'the reachable phone is not held back by the other').toEqual([{ to: 'on', body: 'for the phone that is on' }])
    expect(outbox.waiting).toBe(1)
    outbox.close()
  })

  it('arms no retry once closed, whatever a send in flight answers (risk-4 c)', async () => {
    const clock = new VirtualClock(1)
    const p = slowPhone(clock)
    const outbox = new Outbox(p.notifier, clock)
    outbox.enqueue('a', { title: 'Catch', body: 'one' })
    await settle()
    outbox.close()
    const armed = vi.spyOn(clock, 'setTimeout')
    p.answer(false)
    await settle()
    expect(armed, 'a retry timer armed after the outbox closed').not.toHaveBeenCalled()
    clock.advance(10 * NOTIFY_RETRY_MS)
    await settle()
    expect(p.tried, 'tried again after the outbox closed').toHaveLength(1)
  })
})
