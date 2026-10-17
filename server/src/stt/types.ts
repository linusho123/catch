// The one speech-to-text interface every provider sits behind. Words carry
// timings in seconds from the start of the stream, so the split and the
// detectors can line them up with the lens frames and the fixture clock.

export interface SttWord {
  text: string
  start: number
  end: number
  confidence: number
  /** The provider's diarization label, or null when it gave none. */
  speaker: number | null
  /** False for an interim result the provider may still revise. */
  isFinal: boolean
}

export interface SttStream {
  sendPcm(pcm: Uint8Array): void
  close(): void
}

export interface SpeechToText {
  readonly name: string
  open(onWords: (words: SttWord[]) => void, onError: (err: unknown) => void): SttStream
}
