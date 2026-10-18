import { describe, expect, it } from 'vitest'
import type { LensView } from '../../../shared/lens-protocol.ts'
import { VirtualClock } from '../../../test/harness/clock.ts'
import { pcmAt } from '../../../test/harness/player.ts'
import { loudnessSplit } from '../split/split.ts'
import type { SttWord } from '../stt/types.ts'
import { FRAME_WAIT_MS, LINE_MS, PAGE_MS, QUIET_MS, Session } from './session.ts'

// The session on its own: words and frames in, views out, every duration on
// the injected clock. The features (names, staying-dark, holding) drive it end to end.

const WEARER = -12
const OTHER = -28

function setup(opts: { wearerName?: string; threadDetection?: () => boolean } = {}) {
  const clock = new VirtualClock(1)
  const views: { at: number; view: LensView }[] = []
  const session = new Session({ clock, split: loudnessSplit(), show: (view) => views.push({ at: clock.now(), view }), ...opts })
  let seq = 0
  /** One 100 ms frame ending at stream second `end`, at `dbfs`. */
  const frame = (end: number, dbfs: number) =>
    session.frame({ seq: seq++, captureMs: end * 1000, speakerRole: 'unknown', direction: null, pcm: pcmAt(dbfs) })
  const word = (text: string, start: number, end: number): SttWord => ({ text, start, end, confidence: 1, speaker: null, isFinal: true })
  /** A line said at `dbfs` from stream second `start`, frames and words, each word 0.3 s. */
  const say = (text: string, start: number, dbfs: number) => {
    const words = text.split(' ').map((t, i) => word(t, start + i * 0.3, start + i * 0.3 + 0.3))
    for (let t = Math.round(start * 10) + 1; t <= Math.round(words.at(-1)!.end * 10); t++) frame(t / 10, dbfs)
    session.words(words)
  }
  return { clock, session, views, say, frame, word }
}

describe('a session', () => {
  it('shows nothing until the speech-to-text stream is up, then the dot', () => {
    const { session, views } = setup()
    expect(views).toEqual([])
    session.setHearing(true)
    expect(views.map((v) => v.view)).toEqual([{ kind: 'dot' }])
  })

  it('begins the first conversation on anyone\'s speech, so an introduction before the wearer has spoken is caught (D129)', () => {
    const { session, views, say } = setup()
    session.setHearing(true)
    say("Hi, I'm Priya.", 0, OTHER)
    say('Hello there.', 2, WEARER)
    say("Hi, I'm Marcus.", 4, OTHER)
    expect(views.map((v) => v.view).filter((v) => v.kind === 'line')).toEqual([
      { kind: 'line', text: 'Priya' },
      { kind: 'line', text: 'Marcus' },
    ])
    expect(session.names.list()).toEqual(['Priya', 'Marcus'])
  })

  it('holds a name line for a second and a half on its clock, then the dot', () => {
    const { clock, session, views, say } = setup()
    session.setHearing(true)
    say('Hello.', 0, WEARER)
    say("I'm Priya.", 1, OTHER)
    const line = views.find((v) => v.view.kind === 'line')!
    clock.advance(LINE_MS - 1)
    expect(views.at(-1)).toBe(line)
    clock.advance(1)
    expect(views.at(-1)!.view).toEqual({ kind: 'dot' })
    expect(views.at(-1)!.at - line.at).toBeCloseTo(LINE_MS, -1)
  })

  it('waits for the frames under a word before judging it, and judges it anyway when they never come', () => {
    const { clock, session, views, frame, word } = setup()
    session.setHearing(true)
    frame(0.1, WEARER)
    session.words([word('Hello.', 0, 0.1)])
    session.words([word("I'm", 1, 1.2), word('Priya.', 1.2, 1.5)])
    frame(1.2, OTHER)
    expect(views.filter((v) => v.view.kind === 'line')).toEqual([])
    clock.advance(FRAME_WAIT_MS)
    expect(views.filter((v) => v.view.kind === 'line').map((v) => v.view)).toEqual([{ kind: 'line', text: 'Priya' }])
  })

  it('never catches a name the wearer gave as their own, even from someone else (D29)', () => {
    const { session, views, say } = setup()
    session.setHearing(true)
    say("Hi, I'm Linus.", 0, WEARER)
    say('Everyone, this is Linus.', 2, OTHER)
    expect(views.filter((v) => v.view.kind === 'line')).toEqual([])
    expect(session.names.list()).toEqual([])
  })

  it.each([
    ['Priya, nice to meet you.', "Hi, I'm Priya."],
    ['Meet Dev.', "Hi, I'm Dev."],
    ['This is Dana.', "Hi, I'm Dana."],
  ])('takes only the wearer\'s self-introduction as their own name, not %j naming someone else (M2, D29)', (wearerSays, otherSays) => {
    const { session, say } = setup()
    session.setHearing(true)
    say(wearerSays, 0, WEARER)
    say(otherSays, 3, OTHER)
    expect(session.names.list()).toEqual([otherSays.replace(/^Hi, I'm |\.$/g, '')])
  })

  // D132: Dev's "meet Priya" names her, and her own "Hi, I'm Priya" is the same person.
  it('shows Priya again for her own introduction after "meet Priya", and lists her once (D132)', () => {
    const { session, views, say, clock } = setup()
    session.setHearing(true)
    say("Hi, I'm Dev.", 0, OTHER)
    say('Good to meet you, Dev.', 2, WEARER)
    say('Come and meet Priya.', 5, OTHER)
    clock.advance(FRAME_WAIT_MS)
    // Her name's line from Dev's words fades before she speaks.
    clock.advance(LINE_MS)
    say("Hi, I'm Priya.", 9, OTHER)
    clock.advance(FRAME_WAIT_MS)
    expect(views.filter((v) => v.view.kind === 'line').map((v) => v.view)).toEqual([
      { kind: 'line', text: 'Dev' },
      { kind: 'line', text: 'Priya' },
      { kind: 'line', text: 'Priya' },
    ])
    expect(session.names.list()).toEqual(['Dev', 'Priya'])
  })

  it.each([["Hi, I'm Linus."], ["I am Linus."], ['My name is Linus.'], ["My name's Linus."]])(
    'takes %j from the wearer as their own name (D29)',
    (wearerSays) => {
      const { session, say } = setup()
      session.setHearing(true)
      say(wearerSays, 0, WEARER)
      say('Everyone, this is Linus.', 3, OTHER)
      expect(session.names.list()).toEqual([])
    },
  )

  it('never catches the configured wearer name, even when the split hears the wearer as someone else (CATCH_WEARER_NAME)', () => {
    const { session, views, say } = setup({ wearerName: 'Linus' })
    session.setHearing(true)
    say('Morning, everyone.', 0, WEARER)
    // The wearer's own introduction, heard quiet: the split calls it someone else's.
    say("Hi, I'm Linus.", 2, OTHER)
    say("Hi, I'm Priya.", 4, OTHER)
    expect(views.filter((v) => v.view.kind === 'line').map((v) => v.view)).toEqual([{ kind: 'line', text: 'Priya' }])
    expect(session.names.list()).toEqual(['Priya'])
  })

  it('opens the names page on a tap at the dot, and goes back to the dot on the next', () => {
    const { session, views, say, clock } = setup()
    session.setHearing(true)
    say('Hello.', 0, WEARER)
    say("I'm Priya.", 1, OTHER)
    clock.advance(LINE_MS)
    session.tap()
    expect(views.at(-1)!.view).toEqual({ kind: 'names', names: ['Priya'] })
    session.tap()
    expect(views.at(-1)!.view).toEqual({ kind: 'dot' })
  })

  it('takes the dot away the moment it cannot hear, cutting a line short, and ignores taps meanwhile', () => {
    const { session, views, say } = setup()
    session.setHearing(true)
    say('Hello.', 0, WEARER)
    say("I'm Priya.", 1, OTHER)
    session.setHearing(false)
    expect(views.at(-1)!.view).toEqual({ kind: 'deaf' })
    session.tap()
    expect(views.at(-1)!.view).toEqual({ kind: 'deaf' })
    session.setHearing(true)
    expect(views.at(-1)!.view).toEqual({ kind: 'dot' })
  })

  it('shows the names page for five seconds on its clock, then the dot (D31, D43)', () => {
    const { session, views, say, clock } = setup()
    session.setHearing(true)
    say('Hello.', 0, WEARER)
    say("I'm Priya.", 1, OTHER)
    clock.advance(LINE_MS)
    session.tap()
    const page = views.at(-1)!
    expect(page.view).toEqual({ kind: 'names', names: ['Priya'] })
    clock.advance(PAGE_MS - 1)
    expect(views.at(-1)).toBe(page)
    clock.advance(1)
    expect(views.at(-1)!.view).toEqual({ kind: 'dot' })
  })

  it('clears a line to the dot on a tap and does not open the page over it (D34)', () => {
    const { session, views, say } = setup()
    session.setHearing(true)
    say('Hello.', 0, WEARER)
    say("I'm Priya.", 1, OTHER)
    expect(views.at(-1)!.view).toEqual({ kind: 'line', text: 'Priya' })
    session.tap()
    expect(views.at(-1)!.view).toEqual({ kind: 'dot' })
  })

  describe('the conversation boundary (D92, D129)', () => {
    /** This clock also runs with the wall (speed 1), so an edge is checked a few milliseconds either side. */
    const EDGE_MS = 20
    /** Dev talks every 45 s through `seconds` of the wearer's silence from stream second `from`. */
    const devTalks = (say: (t: string, s: number, d: number) => void, from: number, seconds: number) => {
      for (let t = from + 20; t < from + seconds - 3; t += 45) say('So anyway, the launch went fine.', t, OTHER)
    }

    it('stays the same conversation after nine minutes of the wearer\'s silence while Dev talks (D55)', () => {
      const { session, say, clock } = setup()
      session.setHearing(true)
      say('Hello Dev.', 0, WEARER)
      say("I'm Priya.", 1, OTHER)
      const wearerDone = 1.6
      devTalks((t, at, d) => { clock.advance(Math.max(0, at * 1000 - clock.now())); say(t, at, d) }, wearerDone, 540)
      clock.advance(wearerDone * 1000 + 540_000 - clock.now())
      say('Where were we?', wearerDone + 540, WEARER)
      expect(session.conversationOpen).toBe(true)
      expect(session.names.list()).toEqual(['Priya'])
    })

    it('ends the conversation at ten minutes of the wearer\'s silence, whatever Dev says, and clears its names (D56, D92)', () => {
      const { session, views, say, clock } = setup()
      session.setHearing(true)
      say('Hello Dev.', 0, WEARER)
      // The clock when the wearer's last word was judged (its audio was all in, so no time ago).
      const spoke = clock.now()
      say("I'm Priya.", 1, OTHER)
      devTalks((t, at, d) => { clock.advance(Math.max(0, at * 1000 - clock.now())); say(t, at, d) }, 0.6, 600)
      clock.advance(spoke + QUIET_MS - EDGE_MS - clock.now())
      expect(session.conversationOpen).toBe(true)
      clock.advance(2 * EDGE_MS)
      expect(session.conversationOpen).toBe(false)
      expect(session.names.list()).toEqual([])
      // Someone else speaking does not begin the next conversation; nothing they say is caught ...
      say("Hi, I'm Dana.", 602, OTHER)
      expect(session.conversationOpen).toBe(false)
      expect(views.filter((v) => v.view.kind === 'line').map((v) => v.view)).toEqual([{ kind: 'line', text: 'Priya' }])
      // ... the wearer's next speech does.
      say('Sorry, where were we?', 605, WEARER)
      expect(session.conversationOpen).toBe(true)
      say("Hi, I'm Marcus.", 608, OTHER)
      expect(session.names.list()).toEqual(['Marcus'])
    })

    // M1: D92's ten minutes as the ruling's own number, not the product's QUIET_MS,
    // so a QUIET_MS anywhere off 600 000 ms by more than half a second turns this red.
    it.each([
      [599_500, 'the same conversation', ['Priya']],
      [600_500, 'a new conversation', []],
    ])('after %i ms of the wearer\'s silence while Dev talks, the wearer speaks again in %s (M1, D92: exactly ten minutes)', (silenceMs, _which, names) => {
      const { session, say, clock } = setup()
      session.setHearing(true)
      // The clock runs with the stream: the wearer's last word ends at stream 0.6 s, judged at clock 0.6 s.
      clock.advance(600 - clock.now())
      say('Hello Dev.', 0, WEARER)
      const wearerDone = 0.6
      say("I'm Priya.", 1, OTHER)
      devTalks((t, at, d) => { clock.advance(Math.max(0, at * 1000 - clock.now())); say(t, at, d) }, wearerDone, silenceMs / 1000)
      const back = wearerDone + silenceMs / 1000
      clock.advance(back * 1000 - clock.now())
      say('Where were we?', back, WEARER)
      expect(session.conversationOpen).toBe(true)
      expect(session.names.list()).toEqual(names)
    })

    it('measures the quiet from when the wearer\'s last word was said, not from when the provider delivered it', () => {
      const { session, say, frame, word, clock } = setup()
      session.setHearing(true)
      say('Hello.', 0, WEARER)
      // The wearer's word ends at 1.5 s; the provider delivers it two seconds of audio later.
      for (let t = 11; t <= 35; t++) frame(t / 10, t <= 15 ? WEARER : -70)
      const heard = clock.now()
      session.words([word('Okay.', 1.2, 1.5)])
      clock.advance(heard + QUIET_MS - 2000 - EDGE_MS - clock.now())
      expect(session.conversationOpen).toBe(true)
      clock.advance(2 * EDGE_MS)
      expect(session.conversationOpen).toBe(false)
    })

    it('ends the first conversation ten minutes after it began on someone else\'s speech, if the wearer never speaks (D129)', () => {
      const { session, say, clock } = setup()
      session.setHearing(true)
      say("Hi, I'm Priya.", 0, OTHER)
      expect(session.conversationOpen).toBe(true)
      clock.advance(QUIET_MS + 1000)
      expect(session.conversationOpen).toBe(false)
      expect(session.names.list()).toEqual([])
    })

    it('ends the conversation on a long-press: its names clear and the next tap shows nothing held (D52)', () => {
      const { session, views, say, clock } = setup()
      session.setHearing(true)
      say('Hello Dev.', 0, WEARER)
      say("I'm Priya.", 1, OTHER)
      clock.advance(LINE_MS)
      session.longPress()
      expect(session.conversationOpen).toBe(false)
      session.tap()
      expect(views.at(-1)!.view).toEqual({ kind: 'names', names: [] })
      session.tap()
      say("Hi, I'm Dana.", 4, OTHER)
      expect(session.names.list()).toEqual([])
      say('Oh, hello again.', 6, WEARER)
      say("Hi, I'm Marcus.", 8, OTHER)
      expect(session.names.list()).toEqual(['Marcus'])
    })
  })

  describe('a long-press while the lens shows something (operator answer 4)', () => {
    it('clears a showing line to the dot at once, so the end is visible', () => {
      const { session, views, say } = setup()
      session.setHearing(true)
      say('Hello Dev.', 0, WEARER)
      say("I'm Priya.", 1, OTHER)
      expect(views.at(-1)!.view).toEqual({ kind: 'line', text: 'Priya' })
      session.longPress()
      expect(views.at(-1)!.view).toEqual({ kind: 'dot' })
    })

    it('clears a showing names page to the dot at once, so the ended conversation\'s names are never shown after it', () => {
      const { session, views, say, clock } = setup()
      session.setHearing(true)
      say('Hello Dev.', 0, WEARER)
      say("I'm Priya.", 1, OTHER)
      clock.advance(LINE_MS)
      session.tap()
      expect(views.at(-1)!.view).toEqual({ kind: 'names', names: ['Priya'] })
      session.longPress()
      expect(views.at(-1)!.view).toEqual({ kind: 'dot' })
      // The page's own five seconds then change nothing.
      const after = views.length
      clock.advance(PAGE_MS)
      expect(views.length).toBe(after)
    })
  })

  it('does not begin the next conversation on a wearer word said before the long-press but delivered after it (M2, D52)', () => {
    const { session, frame, word, clock } = setup()
    session.setHearing(true)
    // The wearer talks from 0 to 2.0 s; "Okay." is delivered at once and begins the conversation.
    for (let t = 1; t <= 20; t++) frame(t / 10, WEARER)
    session.words([word('Okay.', 0, 0.3)])
    expect(session.conversationOpen).toBe(true)
    // The wearer finishes the sentence and long-presses at 2.0 s ...
    clock.advance(2000 - clock.now())
    session.longPress()
    expect(session.conversationOpen).toBe(false)
    // ... and the provider's final for "See you." (1.4-2.0 s) lands half a second later.
    clock.advance(500)
    frame(2.5, -70)
    session.words([word('See', 1.4, 1.7), word('you.', 1.7, 2.0)])
    expect(session.conversationOpen).toBe(false)
    // Someone else's introduction before the wearer really speaks again is not caught ...
    for (let t = 26; t <= 36; t++) frame(t / 10, OTHER)
    session.words([word("I'm", 3.0, 3.3), word('Dana.', 3.3, 3.6)])
    expect(session.names.list()).toEqual([])
    // ... and the wearer's next words, said after the press, begin the next conversation.
    for (let t = 37; t <= 42; t++) frame(t / 10, WEARER)
    session.words([word('Hello', 3.6, 3.9), word('again.', 3.9, 4.2)])
    expect(session.conversationOpen).toBe(true)
    for (let t = 43; t <= 48; t++) frame(t / 10, OTHER)
    session.words([word("I'm", 4.2, 4.5), word('Marcus.', 4.5, 4.8)])
    expect(session.names.list()).toEqual(['Marcus'])
  })

  it('still never catches the wearer\'s own name after the conversation it was given in has ended (D29)', () => {
    const { session, say } = setup()
    session.setHearing(true)
    say("Hi, I'm Linus.", 0, WEARER)
    session.longPress()
    say('Right, a new one.', 3, WEARER)
    say('Everyone, this is Linus.', 5, OTHER)
    expect(session.conversationOpen).toBe(true)
    expect(session.names.list()).toEqual([])
  })

  describe('one wearer, many sockets (D79)', () => {
    it('keeps the conversation, its names and the wearer\'s own name when the lens comes back, and shows the newer lens the dot', () => {
      const { session, say, clock } = setup()
      session.setHearing(true)
      say("Hi, I'm Linus.", 0, WEARER)
      say("I'm Priya.", 2, OTHER)
      clock.advance(LINE_MS)
      const again: LensView[] = []
      session.attach((view) => again.push(view), { lens: undefined })
      expect(again).toEqual([])
      session.setHearing(true)
      expect(again).toEqual([{ kind: 'dot' }])
      say('Everyone, this is Linus.', 5, OTHER)
      expect(session.conversationOpen).toBe(true)
      expect(session.names.list()).toEqual(['Priya'])
    })

    it('tells a lens a newer one replaced that it cannot hear, and ignores its going', () => {
      const clock = new VirtualClock(1)
      const session = new Session({ clock, split: loudnessSplit() })
      const first: LensView[] = []
      let replaced = false
      const a = session.attach((view) => first.push(view), { lens: 'x', onReplaced: () => (replaced = true) })
      session.setHearing(true)
      const second: LensView[] = []
      const b = session.attach((view) => second.push(view), { lens: 'x' })
      expect(replaced).toBe(true)
      expect(a.active).toBe(false)
      expect(first.at(-1)).toEqual({ kind: 'deaf' })
      session.setHearing(true)
      a.detach()
      expect(b.active).toBe(true)
      expect(second.at(-1)).toEqual({ kind: 'dot' })
    })

    it('begins the next conversation on anyone\'s speech when Catch starts again with none open, but not on a reconnect (D129)', () => {
      const { session, say } = setup()
      session.attach(() => {}, { lens: 'first' })
      session.setHearing(true)
      say('Hello Dev.', 0, WEARER)
      session.longPress()
      // The same launch reconnecting: the next conversation still waits for the wearer.
      session.attach(() => {}, { lens: 'first' })
      session.setHearing(true)
      say("Hi, I'm Dana.", 2, OTHER)
      expect(session.names.list()).toEqual([])
      // A new launch of the plugin: Catch has started again.
      session.attach(() => {}, { lens: 'second' })
      session.setHearing(true)
      say("Hi, I'm Priya.", 4, OTHER)
      expect(session.names.list()).toEqual(['Priya'])
    })
  })

  describe('the dropped thread (D35, D48, D33, D36, D34, D120)', () => {
    const CUT = 'There are two reasons for this. The first is cost, and the second reason is'
    const DEV = 'Sorry, can I ask a quick question about that part first?'
    const lines = (views: { view: LensView }[]) => views.map((v) => v.view).filter((v) => v.kind === 'line')

    it('shows the last words once someone else has talked two seconds into the wearer\'s pause, and keeps them until the wearer speaks', () => {
      const { session, views, say, clock } = setup()
      session.setHearing(true)
      say(CUT, 0, WEARER)
      say(DEV, 5, OTHER)
      expect(lines(views)).toEqual([{ kind: 'line', text: '…and the second reason is' }])
      clock.advance(10 * 60 * 1000 - 1)
      expect(views.at(-1)!.view).toEqual({ kind: 'line', text: '…and the second reason is' })
      say('The second reason is cost.', 9, WEARER)
      expect(views.at(-1)!.view).toEqual({ kind: 'dot' })
    })

    it('shows nothing when the wearer finished the sentence (D33), or for a one-second interjection, or for silence (D36)', () => {
      const { session, views, say, clock } = setup()
      session.setHearing(true)
      say("And that's why we chose it.", 0, WEARER)
      say('That makes sense, we did the same thing.', 3, OTHER)
      say('So the plan for next week is', 6, WEARER)
      say('Mm-hm.', 8.5, OTHER)
      say('to ship on Friday, and the second reason is', 10, WEARER)
      clock.advance(60_000)
      expect(lines(views)).toEqual([])
    })

    it('never reaches back across someone else\'s turn (D48, D50)', () => {
      const { session, views, say } = setup()
      session.setHearing(true)
      say("And that's why we chose it.", 0, WEARER)
      say('Makes sense.', 2.5, OTHER)
      say('Well, the', 3.5, WEARER)
      say(DEV, 4.5, OTHER)
      expect(lines(views)).toEqual([{ kind: 'line', text: '…Well, the' }])
    })

    it('never reaches back across the long-press, nor across a turn said between conversations (head-1, D48, D52)', () => {
      const { session, views, say, frame, word } = setup()
      session.setHearing(true)
      say("Hi, I'm Linus.", 0, WEARER)
      say('Hello there.', 2, OTHER)
      // The wearer says "and the second" at 5.0-5.9 s; the long-press comes at 6.5 s, before the provider's final for it.
      for (let t = 51; t <= 59; t++) frame(t / 10, WEARER)
      for (let t = 60; t <= 65; t++) frame(t / 10, -70)
      session.longPress()
      session.words([word('and', 5.0, 5.3), word('the', 5.3, 5.6), word('second', 5.6, 5.9)])
      // Someone else talks between conversations; then the wearer begins the next one and is cut off.
      say('So what do you think', 8, OTHER)
      say('Well, the', 11, WEARER)
      say(DEV, 12, OTHER)
      expect(lines(views)).toEqual([{ kind: 'line', text: '…Well, the' }])
    })

    it('fires once per run: a line tapped away stays away while the same person talks on (D34)', () => {
      const { session, views, say } = setup()
      session.setHearing(true)
      say(CUT, 0, WEARER)
      say('Sorry, can I ask', 5, OTHER)
      say('a quick question', 6.2, OTHER)
      session.tap()
      expect(views.at(-1)!.view).toEqual({ kind: 'dot' })
      say('about that part first?', 7.1, OTHER)
      expect(views.at(-1)!.view).toEqual({ kind: 'dot' })
      expect(lines(views)).toHaveLength(1)
    })

    it('forgets the run when Catch stops hearing: the words lost in an outage may have finished the sentence', () => {
      const { session, views, say } = setup()
      session.setHearing(true)
      say('Lucky. The freeway', 0, WEARER)
      session.setHearing(false)
      session.setHearing(true)
      say(DEV, 70, OTHER)
      expect(lines(views)).toEqual([])
    })

    it('with detection off, never shows the line, and a tap at the dot gives the thread back above the names (D120)', () => {
      let on = true
      const { session, views, say, clock } = setup({ threadDetection: () => on })
      session.setHearing(true)
      say("I'm Priya.", 0, OTHER)
      clock.advance(LINE_MS)
      on = false
      say(CUT, 2, WEARER)
      say(DEV, 7, OTHER)
      expect(lines(views)).toEqual([{ kind: 'line', text: 'Priya' }])
      session.tap()
      expect(views.at(-1)!.view).toEqual({ kind: 'names', names: ['Priya'], thread: '…and the second reason is' })
      // Switched back on, the page is D43's again.
      on = true
      session.tap()
      session.tap()
      expect(views.at(-1)!.view).toEqual({ kind: 'names', names: ['Priya'] })
    })
  })
})
