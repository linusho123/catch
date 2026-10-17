import WebSocket from 'ws'
import type { SpeechToText, SttStream, SttWord } from './types.ts'

// Deepgram streaming (D126): PCM s16le 16 kHz mono in, word timings with
// diarization labels out. The key is DEEPGRAM_API_KEY, a Fly secret; it never
// ships in the lens. No test calls this socket: the lanes run on fixtures, and
// the live provider runs only by hand behind CATCH_REAL_STT=1.

export const DEEPGRAM_LISTEN = 'wss://api.deepgram.com/v1/listen'

export function deepgramUrl(): string {
  const params = new URLSearchParams({
    model: 'nova-3',
    language: 'en',
    encoding: 'linear16',
    sample_rate: '16000',
    channels: '1',
    interim_results: 'true',
    punctuate: 'true',
    diarize: 'true',
    // Opt out of Deepgram's model-improvement retention (D76: nothing survives).
    mip_opt_out: 'true',
  })
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
  const msg = JSON.parse(raw) as {
    type?: string
    is_final?: boolean
    channel?: { alternatives?: { words?: DeepgramWord[] }[] }
  }
  if (msg.type !== 'Results') return []
  const words = msg.channel?.alternatives?.[0]?.words ?? []
  return words.map((w) => ({
    text: w.punctuated_word ?? w.word,
    start: w.start,
    end: w.end,
    confidence: w.confidence,
    speaker: w.speaker ?? null,
    isFinal: msg.is_final === true,
  }))
}

export function deepgram(apiKey: string): SpeechToText {
  if (!apiKey) throw new Error('DEEPGRAM_API_KEY is not set')
  return {
    name: 'deepgram',
    open(onWords, onError): SttStream {
      const socket = new WebSocket(deepgramUrl(), { headers: { authorization: `Token ${apiKey}` } })
      const pending: Uint8Array[] = []
      socket.on('open', () => {
        for (const chunk of pending.splice(0)) socket.send(chunk)
      })
      socket.on('message', (data) => {
        try {
          const words = parseDeepgramMessage(data.toString())
          if (words.length > 0) onWords(words)
        } catch (err) {
          onError(err)
        }
      })
      socket.on('error', onError)
      return {
        sendPcm(pcm) {
          if (socket.readyState === WebSocket.OPEN) socket.send(pcm)
          else if (socket.readyState === WebSocket.CONNECTING) pending.push(pcm)
        },
        close() {
          if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'CloseStream' }))
          else socket.terminate()
        },
      }
    },
  }
}
