import { describe, expect, it } from 'vitest'
import type { LensView } from '../../../shared/lens-protocol.ts'
import { VirtualClock } from '../../../test/harness/clock.ts'
import { pcmAt } from '../../../test/harness/player.ts'
import type { ModelClient } from '../llm/client.ts'
import { loudnessSplit } from '../split/split.ts'
import type { SttWord } from '../stt/types.ts'
import { PromiseDetector } from './promises.ts'
import { ALREADY_KEPT, KEEP_PROMPT, KEPT, LINE_MS, QUIET_MS, Session, type EndedConversation } from './session.ts'
import type { TranscriptWord } from './transcript.ts'

// The keep (P4) in the session on its own: the prompt on a swipe up at the dot
// (D40), with no timer (D41), coming back after a catch line (D42); a tap keeps
// (`kept`, D111), a swipe down declines, a second swipe up in a kept
// conversation says `already kept` (D54); and what a kept conversation hands
// on at its end for the jogger: its transcript as the store held it, where the
// promises were said, and the spans Catch could not hear (D53, D73), while the
// store's copy is deleted all the same (D76). The clock is near-frozen: only
// advance() moves it, so the second-and-a-half bounds are exact.

const WEARER = -12
const OTHER = -28

function setup(model?: ModelClient) {
  const clock = new VirtualClock(1e-6)
  const views: LensView[] = []
  const ended: EndedConversation[] = []
  const stored: TranscriptWord[] = []
  let deleted = 0
  const session = new Session({
    clock,
    split: loudnessSplit(),
    show: (view) => views.push(view),
    onEnd: (e) => ended.push(e),
    ...(model ? { promises: new PromiseDetector(model) } : {}),
    transcript: { add: (w) => stored.push(w), words: () => stored.slice(), delete: () => (deleted++, stored.splice(0)) },
  })
  session.setHearing(true)
  let seq = 0
  const word = (text: string, start: number, end: number): SttWord => ({ text, start, end, confidence: 1, speaker: null, isFinal: true })
  const say = (text: string, start: number, dbfs: number) => {
    const words = text.split(' ').map((t, i) => word(t, start + i * 0.3, start + i * 0.3 + 0.3))
    for (let t = Math.round(start * 10) + 1; t <= Math.round(words.at(-1)!.end * 10); t++) {
      session.frame({ seq: seq++, captureMs: (t / 10) * 1000, speakerRole: 'unknown', direction: null, pcm: pcmAt(dbfs) })
    }
    clock.advance(Math.max(0, words.at(-1)!.end * 1000 - clock.now()))
    session.words(words)
  }
  const shows = () => session.current()
  const line = (text: string): LensView => ({ kind: 'line', text })
  return { clock, session, views, ended, stored, say, shows, line, deletes: () => deleted }
}

const settle = () => new Promise<void>((resolve) => setImmediate(resolve))

describe('the keep prompt (D40, D41, D42)', () => {
  it('comes on a swipe up at the dot in an open conversation and waits, with no timer, however long', () => {
    const { clock, session, say, shows, line } = setup()
    say('Morning, everyone.', 0, WEARER)
    session.swipeUp()
    expect(shows()).toEqual(line(KEEP_PROMPT))
    clock.advance(40_000)
    expect(shows(), 'still up forty seconds later').toEqual(line(KEEP_PROMPT))
    session.swipeUp()
    expect(shows(), 'a swipe up on the prompt changes nothing').toEqual(line(KEEP_PROMPT))
  })

  it('means nothing with no conversation open, or on a line or a page', () => {
    const { session, say, shows, line } = setup()
    session.swipeUp()
    expect(shows(), 'no conversation yet').toEqual({ kind: 'dot' })
    say("Hi, I'm Priya.", 0, OTHER)
    expect(shows()).toEqual(line('Priya'))
    session.swipeUp()
    expect(shows(), 'on a line').toEqual(line('Priya'))
    session.tap()
    session.tap()
    expect(shows().kind).toBe('names')
    session.swipeUp()
    expect(shows().kind, 'on a page').toBe('names')
  })

  it('gives way to a catch line and comes back when it goes, because it was never answered', () => {
    const { clock, session, say, shows, line } = setup()
    say('Morning, everyone.', 0, WEARER)
    session.swipeUp()
    say("Hi, I'm Priya.", 2, OTHER)
    expect(shows()).toEqual(line('Priya'))
    clock.advance(LINE_MS)
    expect(shows(), 'back after the name').toEqual(line(KEEP_PROMPT))
    // A tap on a line clears it, and the prompt comes back in its place.
    say("I'm Marcus.", 4, OTHER)
    session.tap()
    expect(shows()).toEqual(line(KEEP_PROMPT))
  })

  it('goes when the conversation it asked about ends, by quiet or by a long-press', () => {
    const a = setup()
    a.say('Morning, everyone.', 0, WEARER)
    a.session.swipeUp()
    a.clock.advance(QUIET_MS)
    expect(a.shows()).toEqual({ kind: 'dot' })
    expect(a.ended.map((e) => e.kept)).toEqual([false])
    const b = setup()
    b.say('Morning, everyone.', 0, WEARER)
    b.session.swipeUp()
    b.session.longPress()
    expect(b.shows()).toEqual({ kind: 'dot' })
  })

  it('comes back when Catch can hear again, but not while it cannot (D37)', () => {
    const { session, say, shows, line } = setup()
    say('Morning, everyone.', 0, WEARER)
    session.swipeUp()
    session.setHearing(false)
    expect(shows()).toEqual({ kind: 'deaf' })
    session.setHearing(true)
    expect(shows()).toEqual(line(KEEP_PROMPT))
  })
})

describe('the answer (D40, D111, D54)', () => {
  it('a tap keeps: `kept` for a second and a half, then the dot; a swipe up then says `already kept` for as long', () => {
    const { clock, session, say, shows, line, ended } = setup()
    say('Morning, everyone.', 0, WEARER)
    session.swipeUp()
    session.tap()
    expect(shows()).toEqual(line(KEPT))
    clock.advance(LINE_MS - 1)
    expect(shows()).toEqual(line(KEPT))
    clock.advance(1)
    expect(shows()).toEqual({ kind: 'dot' })
    session.swipeUp()
    expect(shows()).toEqual(line(ALREADY_KEPT))
    clock.advance(LINE_MS)
    expect(shows()).toEqual({ kind: 'dot' })
    session.longPress()
    expect(ended.map((e) => e.kept)).toEqual([true])
  })

  it('a swipe down declines: the dot, nothing kept, and a later swipe up asks again', () => {
    const { session, say, shows, line, ended } = setup()
    say('Morning, everyone.', 0, WEARER)
    session.swipeUp()
    session.swipeDown()
    expect(shows()).toEqual({ kind: 'dot' })
    session.swipeUp()
    expect(shows()).toEqual(line(KEEP_PROMPT))
    session.swipeDown()
    session.longPress()
    expect(ended.map((e) => e.kept)).toEqual([false])
  })

  it('a tap at the bare dot still opens the names page, and the keep belongs to one conversation only', () => {
    const { session, say, shows, ended } = setup()
    say('Morning, everyone.', 0, WEARER)
    session.swipeUp()
    session.tap()
    session.longPress()
    say('Hello again.', 5, WEARER)
    session.swipeUp()
    expect(shows(), 'the next conversation asks afresh').toEqual({ kind: 'line', text: KEEP_PROMPT })
    session.swipeDown()
    session.tap()
    expect(shows().kind).toBe('names')
    session.longPress()
    expect(ended.map((e) => e.kept)).toEqual([true, false])
  })
})

describe('what a kept conversation hands on (D73, D53, D76)', () => {
  it('its transcript as the store held it, read before the store deletes it; an unkept one hands on none', async () => {
    const { session, say, ended, stored, deletes } = setup()
    say('Morning, everyone.', 0, WEARER)
    say('We use diffusion models.', 2, OTHER)
    session.swipeUp()
    session.tap()
    session.longPress()
    await settle()
    expect(ended[0]!.transcript.map((w) => [w.text, w.side])).toEqual([
      ['Morning,', 'wearer'],
      ['everyone.', 'wearer'],
      ['We', 'other'],
      ['use', 'other'],
      ['diffusion', 'other'],
      ['models.', 'other'],
    ])
    expect(stored, 'the store copy is deleted at the end all the same').toEqual([])
    expect(deletes()).toBe(1)
    say('Hello again.', 5, WEARER)
    session.longPress()
    expect(ended[1]!.transcript, 'not kept: nothing handed on').toEqual([])
  })

  it('each span Catch could not hear while the conversation was open: where it fell and how long, the last one closed by the end', () => {
    const { clock, session, say, ended } = setup()
    session.setHearing(false)
    clock.advance(30_000)
    session.setHearing(true)
    say('Morning, everyone.', 0, WEARER)
    session.setHearing(false)
    clock.advance(240_000)
    session.setHearing(true)
    say('Still there?', 300, WEARER)
    session.setHearing(false)
    clock.advance(90_000)
    session.longPress()
    expect(ended[0]!.gaps.map((g) => ({ at: g.at, ms: Math.round(g.ms) })), 'not the span before it began; the one in it; the last, up to the end').toEqual([
      { at: 0.6, ms: 240_000 },
      { at: 300.6, ms: 90_000 },
    ])
  })

  it('where each promise was said: the end of its sentence on the timeline', async () => {
    const model: ModelClient = { complete: () => Promise.resolve(JSON.stringify({ promise: true, summary: 'send Dev the deck' })) }
    const { session, say, ended, clock } = setup(model)
    say('Morning, Dev.', 0, WEARER)
    say("I'll send you the deck.", 2, WEARER)
    await settle()
    clock.advance(10)
    session.longPress()
    await settle()
    expect(ended[0]!.promises).toEqual(['send Dev the deck'])
    expect(ended[0]!.promiseTimes).toEqual([3.5])
  })
})
