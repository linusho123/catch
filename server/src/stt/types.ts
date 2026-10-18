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
  /**
   * Opens one stream. `onOpen` fires once the provider is ready to hear (the
   * server shows the dot only then, D37); `onError` means the stream is lost,
   * and the server opens a new one. `onUtteranceEnd` fires when the provider
   * has heard a gap with no words after the word ending at `lastWordEnd`
   * (seconds on the stream's clock), sent after that utterance's final words:
   * a natural pause, which ends the sentence being gathered (PT).
   */
  open(
    onWords: (words: SttWord[]) => void,
    onError: (err: unknown) => void,
    onOpen?: () => void,
    onUtteranceEnd?: (lastWordEnd: number) => void,
  ): SttStream
}
