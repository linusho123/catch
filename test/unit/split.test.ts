import { describe, expect, it } from 'vitest'
import {
  createSplit,
  DEFAULT_SPLIT,
  loudnessSplit,
  pcmLoudnessDbfs,
  providerLabelSplit,
  speakerRoleSplit,
  splitFromEnv,
  type FrameSignal,
  type WearerSplit,
} from '../../server/src/split/split.ts'
import { fixtureNames, framesFor, loadFixture, splitWords } from '../fixtures/fixture.ts'

// The wearer-versus-others split on the two-fixture rule: every fixture runs
// in both variants, wearer louder and other louder.

const roles = (name: string) => loadFixture(name).words.map((w) => w.role)
const classify = (split: WearerSplit, name: string, opts: { roleless?: boolean } = {}) => {
  const fx = loadFixture(name)
  return split.classify(splitWords(fx), framesFor(fx, opts))
}
const wearerLouder = fixtureNames().filter((n) => n.endsWith('.wearer-louder'))
const otherLouder = fixtureNames().filter((n) => n.endsWith('.other-louder'))

describe('the speaker-role split', () => {
  for (const name of fixtureNames()) {
    it(`tells every word's side on ${name}`, () => {
      expect(classify(speakerRoleSplit(), name)).toEqual(roles(name))
    })
  }

  it('falls back to loudness when every frame is unknown, as in the simulator', () => {
    for (const name of fixtureNames()) {
      expect(classify(speakerRoleSplit(), name, { roleless: true })).toEqual(classify(loudnessSplit(), name))
    }
  })

  it("breaks a tied vote by the word's loudness", () => {
    const word = { text: 'so', start: 0, end: 0.2, speaker: null }
    const tied = (loudness: number): FrameSignal[] => [
      { start: 0, end: 0.1, role: 'self', loudness },
      { start: 0.1, end: 0.2, role: 'other', loudness },
    ]
    expect(speakerRoleSplit().classify([word], tied(-10))).toEqual(['wearer'])
    expect(speakerRoleSplit().classify([word], tied(-30))).toEqual(['other'])
  })
})

describe('a word at the edge of silence (P3: the last word before the wearer stops)', () => {
  // Frames are stamped when they arrive, so their grid drifts a few
  // milliseconds against the words': the frame after a word's end can reach
  // a hair into it. A sliver of silence must not outweigh the word's own audio.
  const word = { text: 'is', start: 13.43, end: 13.7, speaker: null }
  const frames: FrameSignal[] = [
    { start: 13.38, end: 13.48, role: 'self', loudness: -12 },
    { start: 13.49, end: 13.59, role: 'self', loudness: -12 },
    { start: 13.59, end: 13.69, role: 'self', loudness: -12 },
    { start: 13.69, end: 13.79, role: 'unknown', loudness: -70 },
  ]
  it.each([['loudness'], ['speaker-role']] as const)('%s weighs each frame by how much of the word it covers', (name) => {
    expect(createSplit(name).classify([word], frames)).toEqual(['wearer'])
    expect(createSplit(name).classify([word], frames.map((f) => ({ ...f, role: 'unknown' as const })))).toEqual(['wearer'])
  })
})

describe('the loudness split', () => {
  for (const name of wearerLouder) {
    it(`tells every word's side on ${name}`, () => {
      expect(classify(loudnessSplit(), name)).toEqual(roles(name))
    })
  }

  // Not a goal: this is the case the other two implementations exist for (D119, D125).
  for (const name of otherLouder) {
    it(`calls the louder other person the wearer on ${name}`, () => {
      expect(classify(loudnessSplit(), name)).toEqual(roles(name).map((r) => (r === 'wearer' ? 'other' : 'wearer')))
    })
  }
})

/**
 * Fixtures with one person at the glasses. In shared-pair (D79) two people
 * take turns wearing them, each with a provider label of their own; the
 * labels can name only one of them the wearer's (pinned below).
 */
const oneWearer = (name: string) => !name.startsWith('shared-pair.')

describe("the provider's speaker labels", () => {
  for (const name of fixtureNames().filter(oneWearer)) {
    it(`map to the wearer or not on ${name}`, () => {
      expect(classify(providerLabelSplit(), name)).toEqual(roles(name))
    })
  }

  // M2: the label majority must do the work. Here the per-word anchor (the
  // speaker-role vote) is wrong on a few words, because their frames carry the
  // wrong role; the provider's labels still put those words on the right side.
  for (const name of fixtureNames().filter(oneWearer)) {
    it(`correct the anchor where a few frames carry the wrong role on ${name} (M2)`, () => {
      const fx = loadFixture(name)
      const truth = roles(name)
      const words = splitWords(fx)
      const wearerIdx = truth.flatMap((r, i) => (r === 'wearer' ? [i] : [])).slice(0, 2)
      const otherIdx = truth.flatMap((r, i) => (r === 'other' ? [i] : [])).slice(0, 1)
      const flipped = new Set([...wearerIdx, ...otherIdx])
      const frames = framesFor(fx).map((f) => {
        for (const i of flipped) {
          const w = words[i]!
          if (f.start < w.end && f.end > w.start) {
            return { ...f, role: truth[i] === 'wearer' ? ('other' as const) : ('self' as const) }
          }
        }
        return f
      })
      const anchor = speakerRoleSplit().classify(words, frames)
      for (const i of flipped) expect(anchor[i], `anchor on word ${i}`).not.toBe(truth[i])
      expect(providerLabelSplit().classify(words, frames)).toEqual(truth)
    })
  }

  // M2: the roleless path, the configured alternative in the simulator (D126).
  // Known limit (P2a, D79): the labels tell two wearers apart, and only one label can be the wearer's,
  // so the second person to wear the glasses is someone else to this split. D79 binds on loudness, the default.
  for (const name of fixtureNames().filter((n) => !oneWearer(n))) {
    it(`take only the first wearer's label for the wearer's on ${name} (known limit)`, () => {
      const fx = loadFixture(name)
      const sides = classify(providerLabelSplit(), name)
      const first = fx.words.find((w) => w.role === 'wearer')!.speaker
      fx.words.forEach((w, i) => expect(sides[i], `"${w.text}" (label ${w.speaker})`).toBe(w.role === 'wearer' && w.speaker === first ? 'wearer' : 'other'))
      expect(new Set(fx.words.filter((w) => w.role === 'wearer').map((w) => w.speaker)).size, 'two wearers, two labels').toBe(2)
    })
  }

  for (const name of wearerLouder.filter(oneWearer)) {
    it(`tell every word's side with every frame unknown, as in the simulator, on ${name} (M2)`, () => {
      expect(classify(providerLabelSplit(), name, { roleless: true })).toEqual(roles(name))
    })
  }

  // Not a goal (operator, 2026-10-17: only wearer-louder must pass on the
  // simulator default): with no speaker role the anchor is loudness, so the
  // louder other person's label is taken for the wearer's. Pinned as known-inverted.
  for (const name of otherLouder) {
    it(`take one louder other person's label for the wearer's with every frame unknown on ${name} (M2)`, () => {
      const fx = loadFixture(name)
      const sides = classify(providerLabelSplit(), name, { roleless: true })
      fx.words.forEach((w, i) => {
        if (w.role === 'wearer') expect(sides[i], `wearer word ${i}`).toBe('other')
      })
      const calledWearer = new Set(fx.words.filter((_, i) => sides[i] === 'wearer').map((w) => w.speaker))
      expect(calledWearer.size).toBe(1)
      const [label] = calledWearer
      expect(fx.words.filter((w) => w.speaker === label).every((w) => w.role === 'other')).toBe(true)
      expect(sides.filter((s) => s === 'wearer').length).toBe(fx.words.filter((w) => w.speaker === label).length)
    })
  }

  it('name no label the wearer\'s when the anchor gives none of its words to the wearer (M3)', () => {
    const words = [
      { text: 'hi', start: 0, end: 0.2, speaker: 1 },
      { text: 'there', start: 0.3, end: 0.5, speaker: 2 },
    ]
    const frames: FrameSignal[] = [0, 0.1, 0.2, 0.3, 0.4].map((start) => ({
      start,
      end: Math.round((start + 0.1) * 10) / 10,
      role: 'other',
      loudness: -40,
    }))
    expect(providerLabelSplit().classify(words, frames)).toEqual(['other', 'other'])
  })

  it('answer only the wearer or not, however many labels the provider gives', () => {
    const sides = new Set(classify(providerLabelSplit(), 'introductions.other-louder'))
    expect([...sides].sort()).toEqual(['other', 'wearer'])
  })
})

describe('choosing the split', () => {
  it('defaults to loudness, because the simulator has no speaker role (D126)', () => {
    expect(DEFAULT_SPLIT).toBe('loudness')
    expect(createSplit().name).toBe('loudness')
    expect(splitFromEnv({}).name).toBe('loudness')
  })

  it('selects each implementation by CATCH_SPLIT and refuses an unknown one', () => {
    expect(splitFromEnv({ CATCH_SPLIT: 'speaker-role' }).name).toBe('speaker-role')
    expect(splitFromEnv({ CATCH_SPLIT: 'provider-labels' }).name).toBe('provider-labels')
    expect(() => splitFromEnv({ CATCH_SPLIT: 'voiceprint' })).toThrow(/voiceprint/)
  })

  it('takes the near-field threshold from CATCH_LOUDNESS_THRESHOLD_DBFS', () => {
    const name = 'own-name.other-louder'
    // Below both speakers, everyone is the wearer; the threshold reached the split.
    expect(new Set(classify(splitFromEnv({ CATCH_LOUDNESS_THRESHOLD_DBFS: '-40' }), name))).toEqual(new Set(['wearer']))
  })

  it('refuses a malformed or blank CATCH_LOUDNESS_THRESHOLD_DBFS, naming the variable (M1)', () => {
    for (const raw of ['abc', '', ' ', 'NaN', 'Infinity', '-20dB']) {
      for (const CATCH_SPLIT of ['loudness', 'speaker-role', 'provider-labels']) {
        expect(() => splitFromEnv({ CATCH_SPLIT, CATCH_LOUDNESS_THRESHOLD_DBFS: raw }), `${CATCH_SPLIT} ${JSON.stringify(raw)}`).toThrow(
          /CATCH_LOUDNESS_THRESHOLD_DBFS/,
        )
      }
    }
    const loud: FrameSignal[] = [{ start: 0, end: 0.2, role: 'unknown', loudness: -10 }]
    const word = { text: 'so', start: 0, end: 0.2, speaker: null }
    expect(splitFromEnv({ CATCH_LOUDNESS_THRESHOLD_DBFS: ' -15 ' }).classify([word], loud)).toEqual(['wearer'])
  })
})

describe('frame loudness', () => {
  const pcmOf = (amplitude: number) => {
    const pcm = new Uint8Array(3200)
    const view = new DataView(pcm.buffer)
    for (let i = 0; i < 1600; i++) view.setInt16(i * 2, i % 2 === 0 ? amplitude : -amplitude, true)
    return pcm
  }

  it('measures PCM in dBFS', () => {
    expect(pcmLoudnessDbfs(pcmOf(32767))).toBeCloseTo(0, 2)
    expect(pcmLoudnessDbfs(pcmOf(16384))).toBeCloseTo(-6.02, 1)
    expect(pcmLoudnessDbfs(pcmOf(0))).toBe(-Infinity)
  })
})
