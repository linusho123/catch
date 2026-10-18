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

function setup() {
  const clock = new VirtualClock(1)
  const ended: EndedConversation[] = []
  const session = new Session({ clock, split: loudnessSplit(), onEnd: (c) => ended.push(c) })
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
    say('Hello there.', 0, WEARER)
    const begun = clock.now()
    say("Hi, I'm Priya.", 1, OTHER)
    say("I'm Marcus.", 3, OTHER)
    clock.advance(5000)
    const pressed = clock.now()
    session.longPress()
    session.longPress()
    expect(ended).toHaveLength(1)
    expect(ended[0]!.names).toEqual(['Priya', 'Marcus'])
    expect(ended[0]!.startedAt).toBeLessThanOrEqual(begun)
    // The clock runs on in real time between the reading and the press.
    expect(ended[0]!.endedAt).toBeGreaterThanOrEqual(pressed)
    expect(ended[0]!.endedAt - pressed).toBeLessThan(50)
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
})
