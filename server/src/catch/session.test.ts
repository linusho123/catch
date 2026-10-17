import { describe, expect, it } from 'vitest'
import type { LensView } from '../../../shared/lens-protocol.ts'
import { VirtualClock } from '../../../test/harness/clock.ts'
import { pcmAt } from '../../../test/harness/player.ts'
import { loudnessSplit } from '../split/split.ts'
import type { SttWord } from '../stt/types.ts'
import { FRAME_WAIT_MS, LINE_MS, Session } from './session.ts'

// The session on its own: words and frames in, views out, every duration on
// the injected clock. The features (names, staying-dark) drive it end to end.

const WEARER = -12
const OTHER = -28

function setup() {
  const clock = new VirtualClock(1)
  const views: { at: number; view: LensView }[] = []
  const session = new Session({ clock, split: loudnessSplit(), show: (view) => views.push({ at: clock.now(), view }) })
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

  it('catches no introduction before the conversation begins on the wearer\'s first speech', () => {
    const { session, views, say } = setup()
    session.setHearing(true)
    say("Hi, I'm Priya.", 0, OTHER)
    say('Hello there.', 2, WEARER)
    say("Hi, I'm Marcus.", 4, OTHER)
    expect(views.map((v) => v.view).filter((v) => v.kind === 'line')).toEqual([{ kind: 'line', text: 'Marcus' }])
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
})
