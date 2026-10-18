import { describe, expect, it } from 'vitest'
import type { LensView } from '../../../shared/lens-protocol.ts'
import { VirtualClock } from '../../../test/harness/clock.ts'
import { loudnessSplit } from '../split/split.ts'
import { CONVERSATION_ENDED, Session, type EndedConversation, type SessionOptions } from './session.ts'

// D136 (operator, on the real G2, where the Even OS keeps long-press): a
// swipe down at the bare dot ends the conversation, and a tap at the dot with
// no conversation open starts one.
function setup(opts: Partial<SessionOptions> = {}) {
  const clock = new VirtualClock(1e-9)
  const views: LensView[] = []
  const ended: EndedConversation[] = []
  const session = new Session({ clock, split: loudnessSplit(), show: (v) => views.push(v), onEnd: (c) => ended.push(c), ...opts })
  session.setHearing(true)
  return { session, views, ended, clock }
}

describe('ending and starting a conversation by touch (D136)', () => {
  it('a tap at the dot starts a conversation when none is open, and still shows the held page', () => {
    const { session, views } = setup()
    expect(session.conversationOpen).toBe(false)
    session.tap()
    expect(session.conversationOpen).toBe(true)
    expect(views.at(-1)!.kind).toBe('names')
  })

  it('a swipe down at the dot ends the open conversation, says so, and goes back to the dot', () => {
    const { session, views, ended, clock } = setup()
    session.tap()
    clock.advance(6000)
    expect(views.at(-1)).toEqual({ kind: 'dot' })
    session.swipeDown()
    expect(session.conversationOpen).toBe(false)
    expect(ended).toHaveLength(1)
    expect(views.at(-1)).toEqual({ kind: 'line', text: CONVERSATION_ENDED })
  })

  it('a swipe down at the dot with no conversation open changes nothing, and with pause switched on it pauses instead', () => {
    const quiet = setup()
    const before = quiet.views.length
    quiet.session.swipeDown()
    expect(quiet.views.length).toBe(before)
    expect(quiet.ended).toEqual([])
    const paused = setup({ pause: () => true })
    paused.session.tap()
    paused.clock.advance(6000)
    paused.session.swipeDown()
    expect(paused.session.conversationOpen, 'pausing freezes the conversation, it does not end it (D81)').toBe(true)
    expect(paused.ended).toEqual([])
  })
})
