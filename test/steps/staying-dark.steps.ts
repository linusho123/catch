import { expect } from 'vitest'
import type { Definer } from 'gherkin-node-test/vitest'
import { findIntroductions } from '../../server/src/catch/introductions.ts'
import {
  begin,
  expectDotOnly,
  isDotOnly,
  pend,
  playTo,
  screenAt,
  screens,
  screensDuring,
  SLACK_MS,
  startRun,
  visible,
  type LensWorld,
} from './lens-world.ts'

// staying-dark.feature, the three scenarios P1a binds (D14, D16, D37); the
// rest stay scenario-scoped wip for P2a, P3 and P6. Every "sees" is read from
// the bridge stub's record on fixture time (lens-world.ts). The fixture is
// three minutes of talk with Dev (test/fixtures/scripts.ts, `small-talk`), on
// the default split, wearer louder.

const TALK = 'small-talk.wearer-louder'

const stayingDark: Definer<LensWorld> = (reg) => {
  // D14
  reg.define(/^the wearer is in a conversation in which nothing has slipped$/, async (w) => {
    await begin(w)
    pend(w, 'in-conversation, dot only')
    await startRun(w, TALK, 8)
  })

  reg.define(/^any moment of that conversation passes$/, async (w) => {
    await playTo(w, 25)
  })

  reg.define(/^the wearer sees a single dim dot at the lowest brightness in the top-right corner of the lens$/, (w) => {
    // At every moment since the conversation's fixture began, not only the last one.
    for (const s of screensDuring(w.h!, w.dotSince!, w.h!.clock.now())) expectDotOnly(s, 'during the conversation')
  })

  reg.define(/^the wearer sees nothing else on the lens$/, (w) => {
    for (const s of screensDuring(w.h!, w.dotSince!, w.h!.clock.now())) {
      expect(visible(s), `at ${s.at} ms the lens shows ${JSON.stringify(visible(s).map((c) => c.content))}`).toHaveLength(1)
    }
  })

  // D16
  reg.define(/^the wearer is talking with Dev for three minutes$/, async (w) => {
    await begin(w)
    const run = await startRun(w, TALK, 0)
    const words = run.fixture.words
    expect(words.at(-1)!.end, 'the talk lasts three minutes').toBeGreaterThanOrEqual(180)
    expect(words.some((wd) => wd.role === 'wearer' && wd.start < 5)).toBe(true)
    expect(run.fixture.lines.filter((l) => l.who !== 'wearer').every((l) => l.who === 'Dev'), 'the wearer talks with Dev alone').toBe(true)
  })

  reg.define(
    /^in those three minutes nobody introduces themselves, the wearer makes no promise, and nobody cuts the wearer off$/,
    (w) => {
      const lines = w.run!.fixture.lines
      // Nobody introduces themselves: the detector finds no name in anything said.
      for (const l of lines) expect(findIntroductions(l.text.split(/\s+/)), `"${l.text}"`).toEqual([])
      // The wearer makes no promise: no "I'll", "I will", "I promise", "let me".
      for (const l of lines.filter((x) => x.who === 'wearer')) expect(l.text).not.toMatch(/\b(i'll|i will|i promise|let me)\b/i)
      // Nobody cuts the wearer off: every wearer line ends its sentence, and Dev waits a second before answering.
      const words = w.run!.fixture.words
      for (let i = 1; i < words.length; i++) {
        if (words[i - 1]!.role === 'wearer' && words[i]!.role === 'other') {
          expect(words[i - 1]!.text).toMatch(/[.!?]$/)
          expect(words[i]!.start - words[i - 1]!.end).toBeGreaterThanOrEqual(0.99)
        }
      }
    },
  )

  reg.define(/^the three minutes pass$/, async (w) => {
    await playTo(w, 180)
  })

  reg.define(/^the wearer has seen nothing on the lens but the dim dot for the whole three minutes$/, (w) => {
    const during = screensDuring(w.h!, w.dotSince!, w.run!.at(180))
    expect(during.length).toBeGreaterThan(0)
    for (const s of during) expectDotOnly(s, 'in the three minutes')
  })

  // D37
  reg.define(/^the wearer is mid-conversation and the lens shows only the dot$/, async (w) => {
    await begin(w)
    pend(w, 'in-conversation, dot only')
    await startRun(w, TALK, 10)
  })

  reg.define(/^Catch loses its connection to speech-to-text for one minute$/, async (w) => {
    const h = w.h!
    w.lostAt = h.clock.now()
    h.stt.loseConnection()
    // The conversation goes on while Catch cannot hear.
    await playTo(w, w.run!.seconds(w.lostAt) + 60)
    w.restoredAt = h.clock.now()
    h.stt.restore()
  })

  reg.define(/^the wearer sees no dot for that minute$/, (w) => {
    const h = w.h!
    const gone = screens(h).find((s) => s.at >= w.lostAt! && !isDotOnly(s))
    expect(gone, 'the dot never went').toBeDefined()
    expect(gone!.at - w.lostAt!, `the dot went ${gone!.at - w.lostAt!} ms after the connection dropped`).toBeLessThanOrEqual(SLACK_MS)
    for (const s of screensDuring(h, gone!.at, w.restoredAt!)) {
      expect(visible(s), `at ${s.at} ms, while Catch cannot hear, the lens shows ${JSON.stringify(visible(s).map((c) => c.content))}`).toEqual([])
    }
  })

  reg.define(/^the wearer sees the dot return the moment Catch can hear again$/, async (w) => {
    const h = w.h!
    await playTo(w, w.run!.seconds(w.restoredAt!) + 3)
    // Catch can hear again when the provider takes a stream once more.
    const heard = h.stt.opened.find((at) => at >= w.restoredAt!)
    expect(heard, 'the server never opened a new speech-to-text stream').toBeDefined()
    expect(heard! - w.restoredAt!, `the server took ${heard! - w.restoredAt!} ms to reach the provider again`).toBeLessThanOrEqual(1000 + SLACK_MS)
    const back = screens(h).find((s) => s.at >= w.restoredAt! && isDotOnly(s))
    expect(back, 'the dot never came back').toBeDefined()
    expect(back!.at).toBeGreaterThanOrEqual(heard!)
    expect(back!.at - heard!, `the dot came back ${back!.at - heard!} ms after Catch could hear`).toBeLessThanOrEqual(SLACK_MS)
    expectDotOnly(back, 'when Catch can hear again')
    expectDotOnly(screenAt(h, h.clock.now()), 'now')
  })
}

export default stayingDark
