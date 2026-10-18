import { describe, expect, it } from 'vitest'
import { VirtualClock } from '../../../test/harness/clock.ts'
import { pcmAt } from '../../../test/harness/player.ts'
import { loudnessSplit } from '../split/split.ts'
import type { SttWord } from '../stt/types.ts'
import { QUIET_MS, Session, type EndedConversation } from './session.ts'

// The session's end, as the phone's history hears it (P2b′, D100): each
// conversation that ends, by quiet or by long-press, is reported once with its
// names and its span; a long-press with no conversation open reports nothing.

const WEARER = -12
const OTHER = -28
/** Each `say` is judged as soon as its audio is in: its first word (0.3 s) ended this long before the last of its audio. */
const FIRST_WORD_AGO_MS = 300
/** The clock runs in real time between a reading and the speech after it; a busy machine gets this much. */
const SLACK_MS = 200

function setup(onEnd?: (c: EndedConversation) => void) {
  const clock = new VirtualClock(1)
  const ended: EndedConversation[] = []
  const session = new Session({ clock, split: loudnessSplit(), onEnd: onEnd ?? ((c) => ended.push(c)) })
  session.setHearing(true)
  let seq = 0
  const word = (text: string, start: number, end: number): SttWord => ({ text, start, end, confidence: 1, speaker: null, isFinal: true })
  const say = (text: string, start: number, dbfs: number) => {
    const words = text.split(' ').map((t, i) => word(t, start + i * 0.3, start + i * 0.3 + 0.3))
    for (let t = Math.round(start * 10) + 1; t <= Math.round(words.at(-1)!.end * 10); t++) {
      session.frame({ seq: seq++, captureMs: (t / 10) * 1000, speakerRole: 'unknown', direction: null, pcm: pcmAt(dbfs) })
    }
    session.words(words)
  }
  return { clock, session, ended, say }
}

describe('the end of a conversation, for the phone', () => {
  it('reports a long-press end once, with the names caught in order and the span on the clock', () => {
    const { clock, session, ended, say } = setup()
    // Not at zero (fix round, M3): a start that is never set reads 0, and must not pass.
    clock.advance(60_000)
    const heard = clock.now()
    say('Hello there.', 0, WEARER)
    say("Hi, I'm Priya.", 1, OTHER)
    say("I'm Marcus.", 3, OTHER)
    clock.advance(5000)
    const pressed = clock.now()
    session.longPress()
    session.longPress()
    expect(ended).toHaveLength(1)
    expect(ended[0]!.names).toEqual(['Priya', 'Marcus'])
    // It began at the first word: "Hello" ends 0.3 s into the audio, which was heard up to 0.6 s when it was judged.
    expect(Math.abs(ended[0]!.startedAt - (heard - FIRST_WORD_AGO_MS))).toBeLessThan(SLACK_MS)
    // The clock runs on in real time between the reading and the press.
    expect(ended[0]!.endedAt).toBeGreaterThanOrEqual(pressed)
    expect(ended[0]!.endedAt - pressed).toBeLessThan(50)
  })

  it("reports each conversation's own start, not the first one's (fix round, M3)", () => {
    const { clock, session, ended, say } = setup()
    clock.advance(60_000)
    const first = clock.now()
    say('Hello there.', 0, WEARER)
    say("Hi, I'm Priya.", 1, OTHER)
    clock.advance(5000)
    session.longPress()
    clock.advance(120_000)
    const second = clock.now()
    say('Hello again.', 10, WEARER)
    say("Hi, I'm Dana.", 11, OTHER)
    clock.advance(5000)
    session.longPress()
    expect(ended.map((c) => c.names)).toEqual([['Priya'], ['Dana']])
    expect(Math.abs(ended[0]!.startedAt - (first - FIRST_WORD_AGO_MS))).toBeLessThan(SLACK_MS)
    expect(Math.abs(ended[1]!.startedAt - (second - FIRST_WORD_AGO_MS))).toBeLessThan(SLACK_MS)
    expect(ended[1]!.startedAt).toBeGreaterThan(ended[0]!.endedAt)
  })

  it('reports a quiet end at the ten minutes (D92)', () => {
    const { clock, ended, say } = setup()
    say('Hello there.', 0, WEARER)
    say("Hi, I'm Dana.", 1, OTHER)
    clock.advance(QUIET_MS - 1000)
    expect(ended).toEqual([])
    clock.advance(1000)
    expect(ended.map((c) => c.names)).toEqual([['Dana']])
  })

  it('reports nothing for a long-press with no conversation open, and nothing on close', () => {
    const { session, ended, say } = setup()
    session.longPress()
    expect(ended).toEqual([])
    say('Hello there.', 0, WEARER)
    session.close()
    expect(ended).toEqual([])
  })

  // Fix round, M4: the history's write (app.ts, History.record) can throw once
  // P2a fills `you`. The conversation is over whatever the history does with
  // it: an end that throws still ends it, and none of its names stay held.
  it('ends the conversation and lets its names go even when the end hook throws', () => {
    const { clock, session, say } = setup(() => {
      throw new Error('the store refused the write')
    })
    say('Hello there.', 0, WEARER)
    say("Hi, I'm Priya.", 1, OTHER)
    clock.advance(5000)
    expect(session.current()).toEqual({ kind: 'dot' })
    try {
      session.longPress()
    } catch {
      // Whether the hook's failure reaches the caller is not this test's matter.
    }
    expect(session.conversationOpen, 'the conversation is still open').toBe(false)
    session.tap()
    expect(session.current(), 'the ended conversation is still held').toEqual({ kind: 'names', names: [] })
  })

  it('ends a quiet conversation and lets its names go even when the end hook throws', () => {
    const { clock, session, say } = setup(() => {
      throw new Error('the store refused the write')
    })
    say('Hello there.', 0, WEARER)
    say("Hi, I'm Dana.", 1, OTHER)
    try {
      clock.advance(QUIET_MS)
    } catch {
      // As above.
    }
    expect(session.conversationOpen, 'the conversation is still open').toBe(false)
    session.tap()
    expect(session.current(), 'the ended conversation is still held').toEqual({ kind: 'names', names: [] })
  })
})
