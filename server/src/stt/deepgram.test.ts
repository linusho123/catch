import { describe, expect, it } from 'vitest'
import { deepgram, deepgramUrl, parseDeepgramMessage } from './deepgram.ts'

describe('the Deepgram adapter', () => {
  it('asks for 16 kHz mono linear PCM with word timings and diarization, opted out of retention', () => {
    const url = new URL(deepgramUrl())
    expect(url.origin + url.pathname).toBe('wss://api.deepgram.com/v1/listen')
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      // M5: the model DESIGN.md's chosen line names; without it Deepgram uses its default.
      model: 'nova-3',
      language: 'en',
      encoding: 'linear16',
      sample_rate: '16000',
      channels: '1',
      diarize: 'true',
      interim_results: 'true',
      mip_opt_out: 'true',
    })
  })

  it('turns a Results message into timed words with speaker labels', () => {
    const raw = JSON.stringify({
      type: 'Results',
      is_final: true,
      channel: {
        alternatives: [
          {
            transcript: "hi i'm priya",
            words: [
              { word: 'hi', punctuated_word: 'Hi,', start: 3.0, end: 3.2, confidence: 0.99, speaker: 1 },
              { word: "i'm", punctuated_word: "I'm", start: 3.26, end: 3.5, confidence: 0.98, speaker: 1 },
              { word: 'priya', start: 3.56, end: 4.0, confidence: 0.91 },
            ],
          },
        ],
      },
    })
    expect(parseDeepgramMessage(raw)).toEqual([
      { text: 'Hi,', start: 3.0, end: 3.2, confidence: 0.99, speaker: 1, isFinal: true },
      { text: "I'm", start: 3.26, end: 3.5, confidence: 0.98, speaker: 1, isFinal: true },
      { text: 'priya', start: 3.56, end: 4.0, confidence: 0.91, speaker: null, isFinal: true },
    ])
  })

  it('marks interim words as not final and ignores messages that are not Results', () => {
    const interim = JSON.stringify({ type: 'Results', is_final: false, channel: { alternatives: [{ words: [{ word: 'hi', start: 0, end: 0.2, confidence: 0.5 }] }] } })
    expect(parseDeepgramMessage(interim)[0]?.isFinal).toBe(false)
    expect(parseDeepgramMessage(JSON.stringify({ type: 'Metadata', request_id: 'x' }))).toEqual([])
  })

  it('refuses to start without a key', () => {
    expect(() => deepgram('')).toThrow(/DEEPGRAM_API_KEY/)
  })
})
