import type { SpeakerRole } from '../../../shared/wire.ts'

// The wearer-versus-others split (D119, D125, D126): one interface, three
// implementations, each answering only "the wearer or not" for every word.
// Never voice identification. Which one runs is configuration (CATCH_SPLIT);
// the default is loudness, because off the glasses the SDK's speaker role is
// always unknown (D126: simulator only). DESIGN.md records the one in use.

export type Side = 'wearer' | 'other'

/** One 100 ms audio frame's evidence: the SDK's role and the frame's loudness. Times in seconds. */
export interface FrameSignal {
  start: number
  end: number
  role: SpeakerRole
  /** RMS level in dBFS (0 is full scale, silence is very negative). */
  loudness: number
}

export interface SplitWord {
  text: string
  start: number
  end: number
  /** The speech-to-text provider's diarization label, or null. */
  speaker: number | null
}

export const SPLIT_NAMES = ['speaker-role', 'loudness', 'provider-labels'] as const
export type SplitName = (typeof SPLIT_NAMES)[number]

export interface WearerSplit {
  readonly name: SplitName
  classify(words: readonly SplitWord[], frames: readonly FrameSignal[]): Side[]
}

export const DEFAULT_SPLIT: SplitName = 'loudness'
/** Near-field threshold: a word at or above it is the wearer's. A tuning value for PS, not a ruling. */
export const DEFAULT_LOUDNESS_THRESHOLD_DBFS = -20

export interface SplitOptions {
  loudnessThresholdDbfs?: number
}

function overlapping(word: SplitWord, frames: readonly FrameSignal[]): FrameSignal[] {
  return frames.filter((f) => f.start < word.end && f.end > word.start)
}

function meanLoudness(frames: readonly FrameSignal[]): number {
  if (frames.length === 0) return -Infinity
  return frames.reduce((sum, f) => sum + f.loudness, 0) / frames.length
}

/** Near-field energy: the mic sits at the wearer's mouth, so the wearer is the loud one. */
export function loudnessSplit(opts: SplitOptions = {}): WearerSplit {
  const threshold = opts.loudnessThresholdDbfs ?? DEFAULT_LOUDNESS_THRESHOLD_DBFS
  return {
    name: 'loudness',
    classify: (words, frames) =>
      words.map((w) => (meanLoudness(overlapping(w, frames)) >= threshold ? 'wearer' : 'other')),
  }
}

/**
 * The SDK's per-frame speaker role: a majority vote of the frames over each
 * word's span; an `unknown` frame is decided by its loudness, and a tied vote
 * by the word's mean loudness.
 */
export function speakerRoleSplit(opts: SplitOptions = {}): WearerSplit {
  const threshold = opts.loudnessThresholdDbfs ?? DEFAULT_LOUDNESS_THRESHOLD_DBFS
  return {
    name: 'speaker-role',
    classify: (words, frames) =>
      words.map((w) => {
        const span = overlapping(w, frames)
        let wearer = 0
        let other = 0
        for (const f of span) {
          const self = f.role === 'self' || (f.role === 'unknown' && f.loudness >= threshold)
          if (self) wearer++
          else other++
        }
        if (wearer !== other) return wearer > other ? 'wearer' : 'other'
        return meanLoudness(span) >= threshold ? 'wearer' : 'other'
      }),
  }
}

/**
 * The provider's speaker labels, mapped to "the wearer or not": the label
 * whose words the speaker-role vote (and through it, loudness) most often
 * calls the wearer's is the wearer's label; every other label is other. A word
 * with no label takes the vote's answer.
 */
export function providerLabelSplit(opts: SplitOptions = {}): WearerSplit {
  const anchor = speakerRoleSplit(opts)
  return {
    name: 'provider-labels',
    classify: (words, frames) => {
      const anchored = anchor.classify(words, frames)
      const share = new Map<number, { wearer: number; total: number }>()
      words.forEach((w, i) => {
        if (w.speaker === null) return
        const s = share.get(w.speaker) ?? { wearer: 0, total: 0 }
        s.total++
        if (anchored[i] === 'wearer') s.wearer++
        share.set(w.speaker, s)
      })
      // A label none of whose words the vote gives the wearer is never the
      // wearer's; when every label is like that, no label is chosen (M3).
      let wearerLabel: number | null = null
      let best = 0
      for (const [label, s] of share) {
        const ratio = s.wearer / s.total
        if (ratio > best) {
          best = ratio
          wearerLabel = label
        }
      }
      return words.map((w, i) => {
        if (w.speaker === null) return anchored[i]!
        return w.speaker === wearerLabel ? 'wearer' : 'other'
      })
    },
  }
}

export function createSplit(name: SplitName = DEFAULT_SPLIT, opts: SplitOptions = {}): WearerSplit {
  switch (name) {
    case 'speaker-role':
      return speakerRoleSplit(opts)
    case 'loudness':
      return loudnessSplit(opts)
    case 'provider-labels':
      return providerLabelSplit(opts)
  }
}

/** CATCH_SPLIT picks the implementation; CATCH_LOUDNESS_THRESHOLD_DBFS tunes the near-field threshold. */
export function splitFromEnv(env: Record<string, string | undefined> = process.env): WearerSplit {
  const name = env.CATCH_SPLIT ?? DEFAULT_SPLIT
  if (!(SPLIT_NAMES as readonly string[]).includes(name)) {
    throw new Error(`CATCH_SPLIT=${name} is not one of ${SPLIT_NAMES.join(', ')}`)
  }
  const raw = env.CATCH_LOUDNESS_THRESHOLD_DBFS
  if (raw === undefined) return createSplit(name as SplitName)
  // Number('') and Number(' ') are 0 and Number('abc') is NaN; either would
  // silently call every word 'other', so a bad value is refused like a bad CATCH_SPLIT (M1).
  const threshold = raw.trim() === '' ? NaN : Number(raw)
  if (!Number.isFinite(threshold)) {
    throw new Error(`CATCH_LOUDNESS_THRESHOLD_DBFS=${JSON.stringify(raw)} is not a finite number of dBFS`)
  }
  return createSplit(name as SplitName, { loudnessThresholdDbfs: threshold })
}

/** RMS level of a PCM s16le chunk in dBFS; silence is -Infinity. */
export function pcmLoudnessDbfs(pcm: Uint8Array): number {
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength)
  const samples = Math.floor(pcm.byteLength / 2)
  if (samples === 0) return -Infinity
  let sum = 0
  for (let i = 0; i < samples; i++) {
    const s = view.getInt16(i * 2, true) / 32768
    sum += s * s
  }
  return 10 * Math.log10(sum / samples)
}
