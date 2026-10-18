import { describe, expect, it } from 'vitest'
import type { FixtureWord } from '../fixtures/fixture.ts'
import { loadFixture } from '../fixtures/fixture.ts'
import { modelForListenUrl, providerTimeline, type ProviderEvent } from '../harness/provider-model.ts'

// PT: the model of a streaming provider the latency test runs on. What it
// must never do is give a word before its audio has ended, or a final sooner
// than the provider would: that would make the latency test measure a
// provider faster than the real one.

const w = (text: string, start: number, end: number): FixtureWord => ({ text, start, end, role: 'other', loudness: -28, speaker: 1 })
const said = (e: ProviderEvent) => ('words' in e ? e.words.map((x) => x.text).join(' ') : `end@${e.lastWordEnd}`)

describe('the streaming provider model (PT)', () => {
  const model = { interimMs: 300, endpointingMs: 300, utteranceEndMs: 1000, maxSegmentMs: 4000 }

  it('sends interims every 300 ms while someone speaks, each of only words already ended, and a final after a pause past the endpointing', () => {
    const words = [w('one', 0, 0.25), w('two', 0.3, 0.55), w('three', 0.6, 0.85), w('four', 2.4, 2.6)]
    const events = providerTimeline(words, model)
    expect(events.map((e) => [e.t, e.kind, said(e)])).toEqual([
      [0.3, 'interim', 'one'],
      [0.6, 'interim', 'one two'],
      [0.9, 'interim', 'one two three'],
      [1.15, 'final', 'one two three'],
      [1.85, 'utteranceEnd', 'end@0.85'],
      [2.7, 'interim', 'four'],
      [2.9, 'final', 'four'],
      [3.6, 'utteranceEnd', 'end@2.6'],
    ])
    for (const e of events) if ('words' in e) for (const x of e.words) expect(x.end).toBeLessThanOrEqual(e.t + 1e-9)
  })

  it('gives continuous speech no final until four seconds of it have gone by', () => {
    // A word every 0.3 s, no pause, for six seconds.
    const words = Array.from({ length: 20 }, (_, i) => w(`w${i}`, i * 0.3, i * 0.3 + 0.25))
    const finals = providerTimeline(words, model).filter((e) => e.kind === 'final')
    expect(finals[0]!.t).toBeCloseTo(4, 6)
    // Every word ended by then, and none after.
    expect(finals[0]!.kind === 'final' && finals[0]!.words.at(-1)!.text).toBe('w12')
  })

  it('brings no final at a pause when no endpointing is set, and no utterance end when none is set', () => {
    const words = [w('one', 0, 0.25), w('two', 0.9, 1.15), w('three', 3, 3.25)]
    const events = providerTimeline(words, { interimMs: 300, maxSegmentMs: 4000 })
    expect(events.filter((e) => e.kind === 'utteranceEnd')).toEqual([])
    expect(events.filter((e) => e.kind === 'final').map((e) => [e.t, said(e)])).toEqual([[4, 'one two three']])
  })

  it('reads its endpointing and utterance end from a listen URL, and nothing else', () => {
    expect(modelForListenUrl('wss://api.deepgram.com/v1/listen?model=nova-3&endpointing=300&utterance_end_ms=1000')).toEqual({
      interimMs: 300,
      maxSegmentMs: 4000,
      endpointingMs: 300,
      utteranceEndMs: 1000,
    })
    expect(modelForListenUrl('wss://api.deepgram.com/v1/listen?model=nova-3')).toEqual({ interimMs: 300, maxSegmentMs: 4000 })
  })

  it('keeps the latency fixture honest: "Priya" sits mid-turn with no pause a provider could finalize at, and her final comes over two seconds after it', () => {
    const fx = loadFixture('long-turn.wearer-louder')
    const turn = fx.words.filter((x) => x.role === 'other').slice(0, -2)
    for (let i = 1; i < turn.length; i++) expect(turn[i]!.start - turn[i - 1]!.end).toBeLessThan(0.3)
    const priya = fx.words.find((x) => x.text === 'Priya')!
    const final = providerTimeline(fx.words, model).find((e) => e.kind === 'final' && e.words.includes(priya))!
    expect(final.t - priya.end).toBeGreaterThan(2)
  })
})
