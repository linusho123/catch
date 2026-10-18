import { describe, expect, it } from 'vitest'
import type { LensView } from '../../../shared/lens-protocol.ts'
import { VirtualClock } from '../../../test/harness/clock.ts'
import { pcmAt } from '../../../test/harness/player.ts'
import type { ModelClient } from '../llm/client.ts'
import { loudnessSplit } from '../split/split.ts'
import type { SttWord } from '../stt/types.ts'
import { PromiseDetector } from './promises.ts'
import { LINE_MS, PROMISE_MS, Session, type SessionOptions, type SessionState } from './session.ts'

// PT: the provider's pace. Names are caught from interim results, held
// tentatively until the final words confirm them (no second line, no `(2)`)
// or withdraw them (off the held names, off the page, the line taken down);
// the provider's UtteranceEnd ends the sentence being gathered. Every test
// here runs on a near-frozen clock: only advance() moves it.

const WEARER = -12
const OTHER = -28

function setup(opts: Partial<SessionOptions> = {}) {
  const clock = new VirtualClock(1e-9)
  const views: { at: number; view: LensView }[] = []
  const saved: SessionState[] = []
  const session = new Session({ clock, split: loudnessSplit(), show: (view) => views.push({ at: clock.now(), view }), persist: (s) => saved.push(s), ...opts })
  let seq = 0
  let heardTo = 0
  /** Frames at `dbfs` from where the audio heard so far ends up to stream second `to`. */
  const audio = (to: number, dbfs: number) => {
    for (let t = Math.round(heardTo * 10) + 1; t <= Math.round(to * 10); t++) {
      session.frame({ seq: seq++, captureMs: t * 100, speakerRole: 'unknown', direction: null, pcm: pcmAt(dbfs) })
    }
    heardTo = Math.max(heardTo, to)
  }
  /** Words of `text` from stream second `start`, each 0.3 s. */
  const words = (text: string, start: number, isFinal: boolean): SttWord[] =>
    text.split(' ').map((t, i) => ({ text: t, start: start + i * 0.3, end: start + i * 0.3 + 0.3, confidence: 1, speaker: null, isFinal }))
  /** Someone says `text` at `dbfs` from `start`: the audio, then the provider's interim hypothesis of it (no final yet). */
  const interim = (text: string, start: number, dbfs: number) => {
    const ws = words(text, start, false)
    audio(ws.at(-1)!.end, dbfs)
    session.words(ws)
    return ws
  }
  /** The provider's final words for `text` from `start` (their audio played as `dbfs` if not yet). */
  const final = (text: string, start: number, dbfs: number) => {
    const ws = words(text, start, true)
    audio(ws.at(-1)!.end, dbfs)
    session.words(ws)
    return ws
  }
  const lines = () => views.filter((v) => v.view.kind === 'line').map((v) => (v.view as { text: string }).text)
  return { clock, session, views, saved, interim, final, audio, lines }
}

/** A conversation under way: the wearer has spoken, finals in. */
function opened(opts: Partial<SessionOptions> = {}) {
  const s = setup(opts)
  s.session.setHearing(true)
  s.final('Morning, everyone.', 0, WEARER)
  return s
}

describe('names from interim results (PT)', () => {
  it('shows a name from the interim before any final word, and the final confirms it with no second line', () => {
    const { session, views, interim, final, lines, clock } = opened()
    const at = clock.now()
    interim("Hi, I'm Priya", 2, OTHER)
    // At once, on the interim: the line, and the name on the names page.
    expect(lines()).toEqual(['Priya'])
    expect(views.at(-1)!.at - at).toBeLessThan(1)
    expect(session.names.list()).toEqual(['Priya'])
    // Not yet given by the final words: not in what promises or the end read.
    expect(session.names.confirmedList()).toEqual([])
    // The interim grows, then the final comes: still one line, one name.
    interim("Hi, I'm Priya and I run", 2, OTHER)
    final("Hi, I'm Priya and I run the lab.", 2, OTHER)
    expect(lines()).toEqual(['Priya'])
    expect(session.names.list()).toEqual(['Priya'])
    expect(session.names.confirmedList()).toEqual(['Priya'])
  })

  it('shows no second line when the final confirms a name after its line has faded', () => {
    const { session, views, interim, final, lines, clock } = opened()
    interim("Hi, I'm Priya and I run", 2, OTHER)
    clock.advance(LINE_MS)
    expect(views.at(-1)!.view).toEqual({ kind: 'dot' })
    clock.advance(1500)
    final("Hi, I'm Priya and I run the lab.", 2, OTHER)
    expect(lines()).toEqual(['Priya'])
    expect(views.at(-1)!.view).toEqual({ kind: 'dot' })
    expect(session.names.list()).toEqual(['Priya'])
  })

  it('confirms a name whose final comes in two batches, the name in the second', () => {
    const { session, interim, final, lines } = opened()
    interim("Hi, I'm Priya", 2, OTHER)
    final("Hi, I'm", 2, OTHER)
    // The rest of the hypothesis stands; it is not caught a second time.
    expect(lines()).toEqual(['Priya'])
    expect(session.names.list()).toEqual(['Priya'])
    final('Priya.', 2.6, OTHER)
    expect(lines()).toEqual(['Priya'])
    expect(session.names.confirmedList()).toEqual(['Priya'])
  })

  it('neither withdraws nor shows again a name whose final timings moved a little, its name word in the next batch', () => {
    const { session, interim, audio, lines } = opened()
    interim("Hi, I'm Priya", 2, OTHER)
    const at = (text: string, start: number, end: number): SttWord => ({ text, start, end, confidence: 1, speaker: null, isFinal: true })
    // The final words come a tenth of a second later than the interim's, in two batches.
    audio(3.2, OTHER)
    session.words([at('Hi,', 2.1, 2.4), at("I'm", 2.4, 2.7)])
    expect(session.names.list()).toEqual(['Priya'])
    session.words([at('Priya.', 2.72, 3.0)])
    expect(lines()).toEqual(['Priya'])
    expect(session.names.confirmedList()).toEqual(['Priya'])
  })

  // risk-1: the final timings can come later than the interim's by half the
  // name word or more, and the long-speech cut can fall between "I'm" and the
  // name. A batch ending on "I'm" has then not passed the name: it must not be
  // withdrawn (it blinked off the names page), and the next batch, which gives
  // it, must not show it a second time.
  for (const drift of [0.2, 0.3, 0.5]) {
    it(`keeps a name, with one line, when its final timings come ${drift} s late and the finals are cut between "I'm" and the name (risk-1)`, () => {
      const { session, interim, audio, lines, views } = opened()
      interim("Hi, I'm Priya", 2, OTHER)
      const at = (text: string, start: number): SttWord => ({ text, start: start + drift, end: start + drift + 0.3, confidence: 1, speaker: null, isFinal: true })
      audio(3.2 + drift, OTHER)
      session.words([at('Hi,', 2.0), at("I'm", 2.3)])
      expect(session.names.list()).toEqual(['Priya'])
      expect(views.at(-1)!.view).toMatchObject({ kind: 'line', text: 'Priya' })
      session.words([at('Priya.', 2.6)])
      expect(lines()).toEqual(['Priya'])
      expect(session.names.list()).toEqual(['Priya'])
      expect(session.names.confirmedList()).toEqual(['Priya'])
    })
  }

  it('withdraws a name the final words do not give: off the held names, and its line taken down at once', () => {
    const { session, views, interim, final, lines, clock } = opened()
    interim("Hi, I'm Priya", 2, OTHER)
    expect(lines()).toEqual(['Priya'])
    clock.advance(200)
    final("Hi, I'm here.", 2, OTHER)
    expect(session.names.list()).toEqual([])
    expect(views.at(-1)!.view).toEqual({ kind: 'dot' })
    // A tap finds nothing held.
    session.tap()
    expect(views.at(-1)!.view).toMatchObject({ kind: 'names', names: [] })
  })

  it('withdraws a misheard name from a names page that is showing, which stays up for the rest of its time', () => {
    const { session, views, interim, final, clock } = opened()
    final("Hi, I'm Dev.", 2, OTHER)
    clock.advance(LINE_MS)
    interim("And I'm Pria", 4, OTHER)
    clock.advance(LINE_MS)
    session.tap()
    expect(views.at(-1)!.view).toMatchObject({ kind: 'names', names: ['Dev', 'Pria'] })
    final('And I agree.', 4, OTHER)
    expect(views.at(-1)!.view).toMatchObject({ kind: 'names', names: ['Dev'] })
    expect(session.names.list()).toEqual(['Dev'])
  })

  it('shows the name the final words give in place of a misheard one, which goes', () => {
    const { session, interim, final, lines, clock, views } = opened()
    interim("Hi, I'm Pria", 2, OTHER)
    final("Hi, I'm Priya.", 2, OTHER)
    expect(lines()).toEqual(['Pria', 'Priya'])
    expect(session.names.list()).toEqual(['Priya'])
    clock.advance(LINE_MS)
    session.tap()
    expect(views.at(-1)!.view).toMatchObject({ kind: 'names', names: ['Priya'] })
  })

  it('splits interim words on the frames: the wearer giving a name is never a catch, and the name is the wearer\'s own (D29)', () => {
    const { session, interim, final, lines } = opened()
    interim("Hi, I'm Linus", 2, WEARER)
    expect(lines()).toEqual([])
    final("Hi, I'm Linus.", 2, WEARER)
    interim('Linus, nice to meet you', 4, OTHER)
    expect(lines()).toEqual([])
    expect(session.names.list()).toEqual([])
  })

  it('reads the wearer\'s own name from the same hypothesis before anyone else\'s interim can catch it (D29)', () => {
    const { session, audio, lines } = opened()
    // One hypothesis: the wearer's "I'm Linus" (loud), then the other's "Linus, nice to meet you" (quiet), no final yet.
    audio(3, WEARER)
    audio(4.5, OTHER)
    session.words([
      { text: "I'm", start: 2.1, end: 2.4, confidence: 1, speaker: null, isFinal: false },
      { text: 'Linus.', start: 2.5, end: 2.9, confidence: 1, speaker: null, isFinal: false },
      ...'Linus, nice to meet you'.split(' ').map((t, i) => ({ text: t, start: 3.1 + i * 0.28, end: 3.35 + i * 0.28, confidence: 1, speaker: null, isFinal: false })),
    ])
    expect(lines()).toEqual([])
    expect(session.names.list()).toEqual([])
  })

  it('catches nothing from someone else\'s interim when no conversation is open and their words cannot begin one (D129)', () => {
    const { session, interim, final, lines, clock } = opened()
    session.longPress()
    clock.advance(1000)
    interim("Hi, I'm Priya", 3, OTHER)
    final("Hi, I'm Priya.", 3, OTHER)
    expect(lines()).toEqual([])
  })

  it('catches a name from an interim in which the wearer\'s words open the next conversation (D129)', () => {
    const { session, audio, lines, clock } = opened()
    session.longPress()
    clock.advance(1000)
    audio(4, WEARER)
    audio(6, OTHER)
    const at = (text: string, start: number, end: number): SttWord => ({ text, start, end, confidence: 1, speaker: null, isFinal: false })
    session.words([at('Hello', 3.2, 3.5), at('there.', 3.6, 3.9), at('Hi,', 4.2, 4.5), at("I'm", 4.6, 4.9), at('Dana', 5.0, 5.4)])
    expect(lines()).toEqual(['Dana'])
  })

  it('never catches the configured wearer name from an interim (CATCH_WEARER_NAME)', () => {
    const { session, interim, lines } = opened({ wearerName: 'Linus' })
    interim("Hi, I'm Linus", 2, OTHER)
    expect(lines()).toEqual([])
    expect(session.names.list()).toEqual([])
  })

  it('a second Priya inside two minutes is Priya (2) from her interim, once, and confirmed as such (D87, D88)', () => {
    const { session, interim, final, lines, clock } = opened()
    interim("Hi, I'm Priya", 2, OTHER)
    final("Hi, I'm Priya.", 2, OTHER)
    clock.advance(30_000)
    final('Great.', 4, WEARER)
    interim("Hi, I'm Priya", 6, OTHER)
    interim("Hi, I'm Priya too", 6, OTHER)
    final("Hi, I'm Priya too.", 6, OTHER)
    expect(lines()).toEqual(['Priya', 'Priya (2)'])
    expect(session.names.list()).toEqual(['Priya', 'Priya (2)'])
  })

  it('Priya named by "meet Priya" and then introducing herself, both from interims, is one person (D132)', () => {
    const { session, interim, final, lines, clock } = opened()
    interim('Come and meet Priya', 2, OTHER)
    final('Come and meet Priya.', 2, OTHER)
    clock.advance(LINE_MS)
    interim("Hi, I'm Priya", 4, OTHER)
    final("Hi, I'm Priya.", 4, OTHER)
    expect(lines()).toEqual(['Priya', 'Priya'])
    expect(session.names.list()).toEqual(['Priya'])
  })

  it('withdraws a name whose stream is lost before its final words come', () => {
    const { session, interim, lines } = opened()
    interim("Hi, I'm Priya", 2, OTHER)
    expect(lines()).toEqual(['Priya'])
    session.setHearing(false)
    session.setHearing(true)
    expect(session.names.list()).toEqual([])
  })

  it('withdraws a name at the end of its utterance when the final words never reached it', () => {
    const { session, views, interim, final, clock } = opened()
    interim("Hi, I'm Priya", 2, OTHER)
    // The final words were shorter than the hypothesis, and the provider says the utterance has ended.
    final('Hi.', 2, OTHER)
    expect(session.names.list()).toEqual(['Priya'])
    clock.advance(100)
    session.utteranceEnd(2.3)
    expect(session.names.list()).toEqual([])
    expect(views.at(-1)!.view).toEqual({ kind: 'dot' })
  })

  it('never stores a name not yet confirmed: a restart finds only the names the final words gave (D73)', () => {
    const { session, saved, interim, final } = opened()
    interim("Hi, I'm Priya", 2, OTHER)
    // test-honesty-1: a final word that ends before the name is judged and saved while the tentative name stands.
    const before = saved.length
    final('Hi,', 2, OTHER)
    expect(session.names.list()).toEqual(['Priya'])
    expect(saved.length).toBeGreaterThan(before)
    expect(saved.at(-1)!.conversation!.names.entries.map((e) => e.label)).not.toContain('Priya')
    final("I'm Priya.", 2.3, OTHER)
    expect(saved.at(-1)!.conversation!.names.entries.map((e) => e.label)).toEqual(['Priya'])
  })

  // head-1: the split decides an interim word's side from its frames, so a word is read only once they are in.
  it('reads an interim word for names only once its frames are in, and splits it on them (head-1)', () => {
    const { session, audio, lines } = opened()
    const hypothesis = (text: string, start: number): SttWord[] =>
      text.split(' ').map((t, i) => ({ text: t, start: start + i * 0.3, end: start + i * 0.3 + 0.3, confidence: 1, speaker: null, isFinal: false }))
    // The wearer's "Hi, I'm Dana" comes before its frames: nothing read yet; then its loud frames make it the wearer's (D29).
    session.words(hypothesis("Hi, I'm Dana", 2))
    expect(lines()).toEqual([])
    audio(2.9, WEARER)
    expect(lines()).toEqual([])
    expect(session.names.list()).toEqual([])
    // Someone else's "Hi, I'm Priya" before its frames: nothing yet; caught once its quiet frames are in.
    session.words(hypothesis("Hi, I'm Priya", 4))
    audio(3.9, OTHER)
    expect(lines()).toEqual([])
    audio(4.9, OTHER)
    expect(lines()).toEqual(['Priya'])
  })

  it('ends with only the confirmed names, and gives the promise detector only those (promises stay on finals)', async () => {
    const prompts: string[] = []
    const model: ModelClient = {
      complete(_m, prompt) {
        prompts.push(prompt)
        return Promise.resolve('{"promise": false}')
      },
    }
    const ended: string[][] = []
    const { session, interim, final } = opened({ promises: new PromiseDetector(model), onEnd: (e) => ended.push(e.names) })
    interim("Hi, I'm Priya", 2, OTHER)
    final("I'll send you the deck.", 4, WEARER)
    await Promise.resolve()
    expect(prompts.at(-1)).toMatch(/Names caught in this conversation, in the order heard: \(none\)/)
    // A name still standing on an interim when the conversation ends is not among its names.
    interim("And I'm Dana", 7, OTHER)
    expect(session.names.list()).toEqual(['Dana'])
    session.longPress()
    await new Promise((resolve) => setImmediate(resolve))
    expect(ended).toEqual([[]])
  })
})

describe('the provider\'s utterance end (PT)', () => {
  function promising() {
    const asked: string[] = []
    const model: ModelClient = {
      complete(_m, prompt) {
        const said = /^The wearer now says: (.*)$/m.exec(prompt)![1]!
        asked.push(said)
        return Promise.resolve(said === "Sure I'll send you the deck tonight" ? '{"promise": true, "summary": "send Dev the deck tonight"}' : '{"promise": false}')
      },
    }
    return { asked, model }
  }

  it('ends the wearer\'s sentence at a natural pause, so a promise with no closing punctuation is judged there (D89)', async () => {
    const { asked, model } = promising()
    const { session, final, lines, clock, views } = opened({ promises: new PromiseDetector(model) })
    const said = final("Sure I'll send you the deck tonight", 2, WEARER)
    // Nothing judged on the words alone: no punctuation, no change of speaker.
    expect(asked).toEqual([])
    clock.advance(1000)
    const pausedAt = clock.now()
    session.utteranceEnd(said.at(-1)!.end)
    await Promise.resolve()
    await Promise.resolve()
    expect(asked).toEqual(["Sure I'll send you the deck tonight"])
    expect(lines()).toEqual(['promised · send Dev the deck tonight'])
    expect(views.at(-1)!.at - pausedAt).toBeLessThanOrEqual(PROMISE_MS)
    // The wearer goes on: a new sentence, not the old one grown.
    final('Anyway, how long are you here?', 4, WEARER)
    expect(asked).toHaveLength(1)
  })

  it('judges a sentence once when its speech_final end and the UtteranceEnd after it both end it (operator answer 4)', async () => {
    const { asked, model } = promising()
    const { session, final, lines, clock } = opened({ promises: new PromiseDetector(model) })
    const said = final("Sure I'll send you the deck tonight", 2, WEARER)
    // The provider's endpointing marked these finals speech_final: the adapter ends the utterance at their last word.
    session.utteranceEnd(said.at(-1)!.end)
    await Promise.resolve()
    await Promise.resolve()
    expect(asked).toEqual(["Sure I'll send you the deck tonight"])
    // A second later Deepgram's UtteranceEnd names the same word: the sentence has ended already.
    clock.advance(700)
    session.utteranceEnd(said.at(-1)!.end)
    await Promise.resolve()
    await Promise.resolve()
    expect(asked).toHaveLength(1)
    expect(lines()).toEqual(['promised · send Dev the deck tonight'])
  })

  it('leaves a sentence alone when the utterance end is for words before it', () => {
    const { asked, model } = promising()
    const { session, final } = opened({ promises: new PromiseDetector(model) })
    final("Sure I'll send you the deck tonight", 2, WEARER)
    session.utteranceEnd(1.0)
    expect(asked).toEqual([])
  })

  it('takes the utterance end in order behind final words still waiting for their frames', async () => {
    const { asked, model } = promising()
    const { session, audio } = opened({ promises: new PromiseDetector(model) })
    const ws = "Sure I'll send you the deck tonight".split(' ').map((t, i) => ({ text: t, start: 2 + i * 0.3, end: 2.3 + i * 0.3, confidence: 1, speaker: null, isFinal: true }))
    audio(3, WEARER)
    session.words(ws)
    session.utteranceEnd(ws.at(-1)!.end)
    expect(asked).toEqual([])
    audio(ws.at(-1)!.end, WEARER)
    await Promise.resolve()
    expect(asked).toEqual(["Sure I'll send you the deck tonight"])
  })
})
