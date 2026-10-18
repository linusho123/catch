import type { FixtureWord } from '../fixtures/fixture.ts'

// A model of how a streaming provider answers (PT): not every word final the
// moment its audio ends, as FixtureStt gives them by default, but the way the
// operator saw Deepgram answer on the simulator. While someone speaks, an
// interim hypothesis of the words since the last final comes every
// `interimMs`; finals come only at a pause longer than the endpointing, or,
// in continuous speech, once `maxSegmentMs` of it has gone by without one;
// and after a gap of at least `utteranceEndMs` with no words, an UtteranceEnd
// naming the last word's end. With no endpointing set, pauses bring no final
// (only the long-speech cut, or the utterance end); with no utterance end set,
// none is ever sent. Every event is timed on fixture seconds at the moment the
// provider would send it, and carries only words whose audio has ended by
// then: a provider cannot transcribe what it has not heard (FixtureStt also
// holds each event until the frames carrying its audio have reached the server).

export interface ProviderModel {
  /** How often an interim hypothesis comes while someone speaks. */
  interimMs: number
  /** A pause longer than this brings a final (Deepgram's `endpointing`); unset, pauses bring none. */
  endpointingMs?: number
  /** A gap at least this long with no words brings an UtteranceEnd (Deepgram's `utterance_end_ms`); unset, none comes. */
  utteranceEndMs?: number
  /** In continuous speech, a final at the latest this long after the first word not yet final began. */
  maxSegmentMs: number
}

/** The interim cadence and the long-speech cut the operator saw on the simulator (the PT brief): about 300 ms and about 4 s. */
export const OBSERVED = { interimMs: 300, maxSegmentMs: 4000 } as const

/** The model for a Deepgram listen URL: its own endpointing and utterance-end settings, nothing else assumed. */
export function modelForListenUrl(url: string): ProviderModel {
  const params = new URL(url).searchParams
  const ms = (key: string) => {
    const value = params.get(key)
    return value !== null && /^\d+$/.test(value) ? Number(value) : undefined
  }
  const endpointingMs = ms('endpointing')
  const utteranceEndMs = ms('utterance_end_ms')
  return {
    ...OBSERVED,
    ...(endpointingMs !== undefined ? { endpointingMs } : {}),
    ...(utteranceEndMs !== undefined ? { utteranceEndMs } : {}),
  }
}

export type ProviderEvent =
  | { t: number; kind: 'interim' | 'final'; words: FixtureWord[] }
  | { t: number; kind: 'utteranceEnd'; lastWordEnd: number }

const round = (t: number) => Math.round(t * 1e6) / 1e6

/** Every message the provider sends for `words`, in the order sent. */
export function providerTimeline(words: readonly FixtureWord[], model: ProviderModel): ProviderEvent[] {
  const events: ProviderEvent[] = []
  let segment: FixtureWord[] = []
  const finalize = (at: number) => {
    if (segment.length === 0) return
    const start = segment[0]!.start
    let shown = 0
    // Interims while the segment is open: each tick, the words of it heard so far, sent when the hypothesis has grown.
    for (let tick = start + model.interimMs / 1000; tick < at - 1e-9; tick += model.interimMs / 1000) {
      const heard = segment.filter((w) => w.end <= tick + 1e-9)
      if (heard.length > shown) {
        events.push({ t: round(tick), kind: 'interim', words: heard })
        shown = heard.length
      }
    }
    events.push({ t: round(at), kind: 'final', words: segment })
    segment = []
  }
  for (let i = 0; i < words.length; i++) {
    const word = words[i]!
    // Continuous speech: the long-speech cut finalizes what has been said by then.
    if (segment.length > 0) {
      const cut = segment[0]!.start + model.maxSegmentMs / 1000
      if (word.end > cut) finalize(Math.max(cut, segment.at(-1)!.end))
    }
    segment.push(word)
    const next = words[i + 1]
    const gapMs = next ? (next.start - word.end) * 1000 : Infinity
    const utteranceEnds = model.utteranceEndMs !== undefined && gapMs >= model.utteranceEndMs
    if (model.endpointingMs !== undefined && gapMs > model.endpointingMs) {
      finalize(word.end + model.endpointingMs / 1000)
    } else if (utteranceEnds) {
      // The provider finalizes an utterance before it says the utterance has ended.
      finalize(word.end + model.utteranceEndMs! / 1000)
    } else if (!next) {
      finalize(Math.max(segment[0]!.start + model.maxSegmentMs / 1000, word.end))
    }
    if (utteranceEnds) events.push({ t: round(word.end + model.utteranceEndMs! / 1000), kind: 'utteranceEnd', lastWordEnd: word.end })
  }
  // In the order sent: by time, a final before the UtteranceEnd that follows it at the same instant.
  return events.map((e, i) => ({ e, i })).sort((a, b) => a.e.t - b.e.t || a.i - b.i).map(({ e }) => e)
}
