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

describe("the provider's speaker labels", () => {
  for (const name of fixtureNames()) {
    it(`map to the wearer or not on ${name}`, () => {
      expect(classify(providerLabelSplit(), name)).toEqual(roles(name))
    })
  }

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
