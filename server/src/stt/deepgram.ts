import WebSocket from 'ws'
import { systemClock, type Clock, type TimerHandle } from '../../../shared/clock.ts'
import type { SpeechToText, SttStream, SttWord } from './types.ts'

// Deepgram streaming (D126): PCM s16le 16 kHz mono in, word timings with
// diarization labels out. The key is DEEPGRAM_API_KEY, a Fly secret; it never
// ships in the lens. No test calls this socket: the lanes run on fixtures, and
// the live provider runs only by hand behind CATCH_REAL_STT=1.
//
// Deepgram closes a stream that has had no audio for about ten seconds. The
// lens streams a frame every 100 ms, but a WebView the phone backgrounds can
// stall for longer, so while no PCM has gone out for KEEPALIVE_MS the adapter
// sends Deepgram's {"type":"KeepAlive"}, and again every KEEPALIVE_MS until
// audio flows (PH). The timer runs on the injected clock, is set only while
// the socket is open, and is cleared as the stream closes, from either side.

export const DEEPGRAM_LISTEN = 'wss://api.deepgram.com/v1/listen'

/** At most this many keyterms go to Deepgram (nova-3's keyterm prompting has a cap). */
export const MAX_KEYTERMS = 100

/**
 * CATCH_KEYTERMS: a comma list of words Deepgram should listen for, such as
 * the names the wearer expects to hear, so it mishears them less (nova-3
 * keyterm prompting). Trimmed, blanks and repeats dropped, at most 100.
 */
export function keytermsFromEnv(value: string | undefined): string[] {
  const seen = new Set<string>()
  for (const raw of (value ?? '').split(',')) {
    const term = raw.trim()
    if (term && !seen.has(term)) seen.add(term)
  }
  return [...seen].slice(0, MAX_KEYTERMS)
}

export function deepgramUrl(opts: { keyterms?: readonly string[] } = {}): string {
  const params = new URLSearchParams({
    model: 'nova-3',
    language: 'en',
    encoding: 'linear16',
    sample_rate: '16000',
    channels: '1',
    interim_results: 'true',
    punctuate: 'true',
    // PT: finals at a pause of 300 ms rather than in late batches during
    // continuous speech, and an UtteranceEnd after a second with no words,
    // which ends the sentence being gathered (DESIGN.md, chosen).
    endpointing: '300',
    utterance_end_ms: '1000',
    diarize: 'true',
    // Opt out of Deepgram's model-improvement retention (D76: nothing survives).
    mip_opt_out: 'true',
    // Readability pass: Deepgram's smart formatting (punctuation, capitals,
    // numbers) on top of punctuate, so names and sentences read better.
    smart_format: 'true',
  })
  for (const term of opts.keyterms ?? []) params.append('keyterm', term)
  return `${DEEPGRAM_LISTEN}?${params}`
}

interface DeepgramWord {
  word: string
  punctuated_word?: string
  start: number
  end: number
  confidence: number
  speaker?: number
}

/** Words out of one Deepgram message; anything that is not a Results message yields none. */
export function parseDeepgramMessage(raw: string): SttWord[] {
  const event = parseDeepgramEvent(raw)
  return event?.kind === 'words' ? event.words : []
}

/**
 * What one Deepgram message says: words (a Results message; `speechFinal` when
 * its endpointing ended the speech there), an utterance end, or nothing Catch reads.
 */
export type DeepgramEvent = { kind: 'words'; words: SttWord[]; speechFinal: boolean } | { kind: 'utteranceEnd'; lastWordEnd: number }

export function parseDeepgramEvent(raw: string): DeepgramEvent | undefined {
  const msg = JSON.parse(raw) as {
    type?: string
    is_final?: boolean
    speech_final?: boolean
    channel?: { alternatives?: { words?: DeepgramWord[] }[] }
    last_word_end?: number
  }
  // UtteranceEnd: no words for utterance_end_ms after the word ending at last_word_end (seconds on the stream's clock).
  if (msg.type === 'UtteranceEnd') return typeof msg.last_word_end === 'number' && msg.last_word_end >= 0 ? { kind: 'utteranceEnd', lastWordEnd: msg.last_word_end } : undefined
  if (msg.type !== 'Results') return undefined
  const isFinal = msg.is_final === true
  // speech_final: the endpointing heard a pause after these final words (PT, operator answer 4).
  return { kind: 'words', words: toWords(msg.channel?.alternatives?.[0]?.words ?? [], isFinal), speechFinal: isFinal && msg.speech_final === true }
}

function toWords(words: DeepgramWord[], isFinal: boolean): SttWord[] {
  return words.map((w) => ({
    text: w.punctuated_word ?? w.word,
    start: w.start,
    end: w.end,
    confidence: w.confidence,
    speaker: w.speaker ?? null,
    isFinal,
  }))
}

/**
 * The most PCM held while the socket is still opening: five seconds of 16 kHz
 * mono s16le. Past it the oldest audio is dropped and onError says so (M7).
 */
export const MAX_PENDING_BYTES = 5 * 16000 * 2

/** How long the stream may go without PCM before a KeepAlive is sent, and the gap between KeepAlives after it (PH). */
export const KEEPALIVE_MS = 5000

/** Deepgram's KeepAlive message: holds a stream open through a gap in the audio. */
export const KEEPALIVE_MESSAGE = JSON.stringify({ type: 'KeepAlive' })

export interface DeepgramOptions {
  /** The listen URL; a loopback stand-in in tests. Defaults to deepgramUrl(). */
  url?: string
  /** Where the KeepAlive timer's time comes from; the system clock by default. */
  clock?: Clock
  /** Words Deepgram should listen for (CATCH_KEYTERMS); ignored when `url` is given. */
  keyterms?: readonly string[]
}

export function deepgram(apiKey: string, opts: DeepgramOptions = {}): SpeechToText {
  if (!apiKey) throw new Error('DEEPGRAM_API_KEY is not set')
  const url = opts.url ?? deepgramUrl({ keyterms: opts.keyterms })
  const clock = opts.clock ?? systemClock
  return {
    name: 'deepgram',
    open(onWords, onError, onOpen, onUtteranceEnd): SttStream {
      const socket = new WebSocket(url, { headers: { authorization: `Token ${apiKey}` } })
      const pending: Uint8Array[] = []
      let pendingBytes = 0
      let overflowReported = false
      let closing = false
      // KeepAlive, KEEPALIVE_MS after the last PCM sent and every KEEPALIVE_MS after that while none is (PH).
      let keepAlive: TimerHandle | undefined
      const stopKeepAlive = () => {
        if (keepAlive) clock.clearTimeout(keepAlive)
        keepAlive = undefined
      }
      const armKeepAlive = () => {
        stopKeepAlive()
        if (closing || socket.readyState !== WebSocket.OPEN) return
        keepAlive = clock.setTimeout(() => {
          keepAlive = undefined
          if (closing || socket.readyState !== WebSocket.OPEN) return
          socket.send(KEEPALIVE_MESSAGE)
          armKeepAlive()
        }, KEEPALIVE_MS)
      }
      socket.on('open', () => {
        for (const chunk of pending.splice(0)) socket.send(chunk)
        pendingBytes = 0
        armKeepAlive()
        onOpen?.()
      })
      // Deepgram drops idle or failed streams; audio after that would vanish
      // without a sound, so an unexpected close is an error (M7).
      socket.on('close', (code, reason) => {
        stopKeepAlive()
        if (closing) return
        const why = reason.toString()
        onError(new Error(`Deepgram closed the stream (code ${code}${why ? `, ${why}` : ''})`))
      })
      socket.on('message', (data) => {
        try {
          const event = parseDeepgramEvent(data.toString())
          if (event?.kind === 'words' && event.words.length > 0) {
            onWords(event.words)
            // The endpointing's pause ends the utterance at these words, as an UtteranceEnd would a second later;
            // the session ends a sentence once, so the UtteranceEnd that may follow changes nothing (operator answer 4).
            if (event.speechFinal) onUtteranceEnd?.(Math.max(...event.words.map((w) => w.end)))
          }
          if (event?.kind === 'utteranceEnd') onUtteranceEnd?.(event.lastWordEnd)
        } catch (err) {
          onError(err)
        }
      })
      socket.on('error', onError)
      return {
        sendPcm(pcm) {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(pcm)
            armKeepAlive()
          } else if (socket.readyState === WebSocket.CONNECTING) {
            pending.push(pcm)
            pendingBytes += pcm.byteLength
            let dropped = 0
            while (pendingBytes > MAX_PENDING_BYTES && pending.length > 0) {
              const old = pending.shift()!
              pendingBytes -= old.byteLength
              dropped += old.byteLength
            }
            if (dropped > 0 && !overflowReported) {
              overflowReported = true
              onError(new Error(`dropped ${dropped} bytes of audio held before Deepgram opened (cap ${MAX_PENDING_BYTES})`))
            }
          } else if (!closing) {
            onError(new Error(`dropped ${pcm.byteLength} bytes of audio: the Deepgram stream is closed`))
          }
        },
        close() {
          closing = true
          stopKeepAlive()
          if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'CloseStream' }))
          else socket.terminate()
        },
      }
    },
  }
}
