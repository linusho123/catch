import type { Clock, TimerHandle } from '../../../shared/clock.ts'
import type { LensView } from '../../../shared/lens-protocol.ts'
import type { AudioFrame } from '../../../shared/wire.ts'
import { pcmLoudnessDbfs, type FrameSignal, type Side, type SplitWord, type WearerSplit } from '../split/split.ts'
import type { SttWord } from '../stt/types.ts'
import { HeldNames } from './held-names.ts'
import { findIntroductions, findSelfIntroductions } from './introductions.ts'

// One /audio session: what the server makes of one pair of glasses. It lines
// the provider's words up with the lens's frames, asks the split (D125) whose
// each word is, runs the introduction detector on everyone else's speech, holds
// the conversation's names, and decides what the lens shows and for how long.
// Every duration is read from the injected clock (the fixture clock under
// test), never from when a frame or a word happened to arrive.
//
// P1a: the first conversation begins on anyone's speech (D129; every later
// one will begin on the wearer's) and does not end yet (the end rules are
// P1b's); the names page is minimal (P1b gives it its header, dismissal and
// promises page).

/** D17: a catch line holds for a second and a half. A ruling, not a tuning value. */
export const LINE_MS = 1500

/**
 * How long a word may wait for the lens frames that cover it before the split
 * judges it on the frames there are. The provider usually answers after the
 * audio is in; this bounds the wait when a frame is late or lost.
 */
export const FRAME_WAIT_MS = 300

/** The most recent words the split sees at once (the provider-label split reads them together). */
const SPLIT_WINDOW_WORDS = 200

export interface SessionOptions {
  clock: Clock
  split: WearerSplit
  /** Sends a view to the lens. Called only when the view changes. */
  show: (view: LensView) => void
  /** The wearer's name (CATCH_WEARER_NAME): never caught, whatever the split decides, beside D29's own-name exclusion. */
  wearerName?: string
}

export class Session {
  private readonly clock: Clock
  private readonly split: WearerSplit
  private readonly send: (view: LensView) => void

  // The lens frames on the session's timeline (seconds from the first frame's start), and how far they reach.
  private epochMs: number | undefined
  private frames: FrameSignal[] = []
  private coveredUntil = 0

  // Final words waiting for their frames, and the words already judged.
  private pending: SttWord[] = []
  private pendingTimer: TimerHandle | undefined
  private judged: { word: SplitWord; side: Side }[] = []

  // The conversation.
  private inConversation = false
  /** Whether any conversation has begun since Catch started: until one has, anyone's speech begins it (D129). */
  private begun = false
  private otherRun: string[] = []
  private otherCaught = new Set<number>()
  private wearerRun: string[] = []
  /** Names the wearer gave as their own in this conversation (D29): never caught from anyone. */
  private ownNames = new Set<string>()
  /** The configured wearer name, case-folded, if any. */
  private readonly wearerName: string | undefined
  readonly names = new HeldNames()

  // What the lens shows.
  private hearing = false
  private view: LensView = { kind: 'deaf' }
  /** The lens starts with no dot (it cannot hear until told), so the first view worth sending is the dot. */
  private sent = JSON.stringify({ kind: 'deaf' } satisfies LensView)
  private lineTimer: TimerHandle | undefined
  private closed = false

  constructor(opts: SessionOptions) {
    this.clock = opts.clock
    this.split = opts.split
    this.send = opts.show
    this.wearerName = opts.wearerName?.trim().toLowerCase() || undefined
  }

  /** What the lens is showing now. */
  current(): LensView {
    return this.view
  }

  /**
   * One lens frame: its span on the session's timeline comes from its capture
   * time, its loudness from its PCM. Returns where the frame starts on that
   * timeline (seconds), so a speech-to-text stream fed from this frame on can
   * have its words placed there.
   */
  frame(frame: AudioFrame): number {
    const seconds = frame.pcm.byteLength / (16000 * 2)
    this.epochMs ??= frame.captureMs - seconds * 1000
    const end = (frame.captureMs - this.epochMs) / 1000
    this.frames.push({ start: end - seconds, end, role: frame.speakerRole, loudness: pcmLoudnessDbfs(frame.pcm) })
    if (end > this.coveredUntil) this.coveredUntil = end
    this.drain(false)
    return end - seconds
  }

  /** Words from the provider, timed on the session's timeline (app.ts places each stream's); only final ones are judged. */
  words(words: readonly SttWord[]): void {
    for (const w of words) if (w.isFinal) this.pending.push(w)
    this.drain(false)
  }

  /** Whether the speech-to-text stream is up (D37: no dot while Catch cannot hear). */
  setHearing(hearing: boolean): void {
    if (this.hearing === hearing) return
    this.hearing = hearing
    this.clearLine()
    this.view = hearing ? { kind: 'dot' } : { kind: 'deaf' }
    this.render()
  }

  /** A tap: the names page from the bare dot; anything else showing goes back to the dot. */
  tap(): void {
    if (!this.hearing) return
    if (this.view.kind === 'dot') {
      this.view = { kind: 'names', names: this.names.list() }
    } else {
      this.clearLine()
      this.view = { kind: 'dot' }
    }
    this.render()
  }

  close(): void {
    this.closed = true
    this.clearLine()
    if (this.pendingTimer) this.clock.clearTimeout(this.pendingTimer)
    this.pendingTimer = undefined
  }

  private drain(timedOut: boolean): void {
    if (this.pendingTimer) this.clock.clearTimeout(this.pendingTimer)
    this.pendingTimer = undefined
    while (this.pending.length > 0) {
      const next = this.pending[0]!
      if (!timedOut && next.end > this.coveredUntil) {
        this.pendingTimer = this.clock.setTimeout(() => this.drain(true), FRAME_WAIT_MS)
        return
      }
      this.pending.shift()
      this.judge(next)
    }
  }

  private judge(word: SttWord): void {
    const entry = { word: { text: word.text, start: word.start, end: word.end, speaker: word.speaker }, side: 'other' as Side }
    this.judged.push(entry)
    if (this.judged.length > SPLIT_WINDOW_WORDS) this.judged.splice(0, this.judged.length - SPLIT_WINDOW_WORDS)
    const words = this.judged.map((j) => j.word)
    const from = words[0]!.start
    this.frames = this.frames.filter((f) => f.end > from)
    const sides = this.split.classify(words, this.frames)
    entry.side = sides.at(-1)!
    this.hear(word.text, entry.side)
  }

  private hear(text: string, side: Side): void {
    // D129: the first conversation after Catch starts begins on anyone's
    // speech; every later one begins on the wearer's.
    if (!this.inConversation && (side === 'wearer' || !this.begun)) {
      this.inConversation = true
      this.begun = true
    }
    if (side === 'wearer') {
      this.otherRun = []
      this.otherCaught.clear()
      this.wearerRun.push(text)
      // D29: only the wearer giving their own name ("I'm X", "my name is X"), never "meet X" or "X, nice to meet you" (M2).
      for (const { name } of findSelfIntroductions(this.wearerRun)) this.ownNames.add(name.toLowerCase())
      return
    }
    this.wearerRun = []
    if (!this.inConversation) return
    this.otherRun.push(text)
    for (const { name, index } of findIntroductions(this.otherRun)) {
      if (this.otherCaught.has(index)) continue
      this.otherCaught.add(index)
      if (this.ownNames.has(name.toLowerCase()) || name.toLowerCase() === this.wearerName) continue
      const heard = this.names.hear(name, this.clock.now())
      this.showLine(heard.line)
    }
  }

  private showLine(text: string): void {
    if (!this.hearing || this.closed) return
    this.clearLine()
    this.view = { kind: 'line', text }
    this.render()
    this.lineTimer = this.clock.setTimeout(() => {
      this.lineTimer = undefined
      this.view = this.hearing ? { kind: 'dot' } : { kind: 'deaf' }
      this.render()
    }, LINE_MS)
  }

  private clearLine(): void {
    if (this.lineTimer) this.clock.clearTimeout(this.lineTimer)
    this.lineTimer = undefined
  }

  private render(): void {
    if (this.closed) return
    const key = JSON.stringify(this.view)
    if (key === this.sent) return
    this.sent = key
    this.send(this.view)
  }
}
