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
// The session belongs to the wearer, not to one /audio socket (D79: one
// wearer per account): app.ts keeps one per shared token and attaches each
// socket's lens to it, so a reconnect finds the held names, the wearer's own
// name and the open conversation where it left them.
//
// The conversation (D92 as amended by D129): the first one after Catch starts
// begins on anyone's speech, every later one on the wearer's; it ends after
// ten minutes in which the wearer does not speak, whatever anyone else says,
// or at once on a long-press, and its names clear. A tap at the dot shows the
// names page for five seconds (D31, D43); the promises page comes in P2a.

/** D17: a catch line holds for a second and a half. A ruling, not a tuning value. */
export const LINE_MS = 1500

/**
 * How long a word may wait for the lens frames that cover it before the split
 * judges it on the frames there are. The provider usually answers after the
 * audio is in; this bounds the wait when a frame is late or lost.
 */
export const FRAME_WAIT_MS = 300

/** D31, D43: a held page stays five seconds with no touch. A ruling, not a tuning value. */
export const PAGE_MS = 5000

/** D92: a conversation ends after ten minutes in which the wearer does not speak. A ruling, not a tuning value. */
export const QUIET_MS = 10 * 60 * 1000

/** The most recent words the split sees at once (the provider-label split reads them together). */
const SPLIT_WINDOW_WORDS = 200

export interface SessionOptions {
  clock: Clock
  split: WearerSplit
  /** Sends a view to the lens (called only when the view changes); the same as attaching one lens at once. */
  show?: (view: LensView) => void
  /** The wearer's name (CATCH_WEARER_NAME): never caught, whatever the split decides, beside D29's own-name exclusion. */
  wearerName?: string
}

/** One lens's hold on the session: what its socket may still do. */
export interface Attachment {
  /** False once the lens has gone or a newer lens has taken its place. */
  readonly active: boolean
  /** The lens has gone: Catch cannot hear it, but the conversation stays. */
  detach(): void
}

export interface AttachOptions {
  /**
   * Which launch of the plugin this is (the lens's id for its own run). A new
   * one means Catch has started again: if no conversation is open, the first
   * speech by anyone begins one (D129). The same one is a reconnect.
   */
  lens?: string
  /** A newer lens took this one's place (one wearer per account, D79). */
  onReplaced?: () => void
}

const DEAF = JSON.stringify({ kind: 'deaf' } satisfies LensView)

export class Session {
  private readonly clock: Clock
  private readonly split: WearerSplit
  private send: (view: LensView) => void = () => {}
  private attached: { active: boolean; show: (view: LensView) => void; onReplaced?: () => void } | undefined
  private lensId: string | undefined

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
  /** When the conversation ends unless the wearer speaks (D92). */
  private quietTimer: TimerHandle | undefined
  /** Names the wearer gave as their own (D29): never caught from anyone. They are the wearer's, so they outlast a conversation. */
  private ownNames = new Set<string>()
  /** The configured wearer name, case-folded, if any. */
  private readonly wearerName: string | undefined
  readonly names = new HeldNames()

  // What the lens shows.
  private hearing = false
  private view: LensView = { kind: 'deaf' }
  /** The lens starts with no dot (it cannot hear until told), so the first view worth sending is the dot. */
  private sent = DEAF
  /** Takes a line or a page off the lens when its time is up. */
  private viewTimer: TimerHandle | undefined
  private closed = false

  constructor(opts: SessionOptions) {
    this.clock = opts.clock
    this.split = opts.split
    this.wearerName = opts.wearerName?.trim().toLowerCase() || undefined
    if (opts.show) this.attach(opts.show)
  }

  /**
   * A lens's socket joins the session. It cannot hear until its own
   * speech-to-text stream opens (setHearing), so it starts with no dot; a
   * lens it replaces is told it cannot hear and stops counting.
   */
  attach(show: (view: LensView) => void, opts: AttachOptions = {}): Attachment {
    const previous = this.attached
    if (previous?.active) {
      previous.active = false
      previous.show({ kind: 'deaf' })
      previous.onReplaced?.()
    }
    if (opts.lens !== this.lensId) {
      this.lensId = opts.lens
      // D129: Catch has started again; with no conversation open, anyone's speech begins the next.
      if (!this.inConversation) this.begun = false
    }
    this.send = () => {}
    this.setHearing(false)
    const mine = { active: true, show, onReplaced: opts.onReplaced }
    this.attached = mine
    this.send = show
    // A lens that has just connected shows no dot (D37) until told otherwise.
    this.sent = DEAF
    this.render()
    return {
      get active() {
        return mine.active
      },
      detach: () => {
        if (!mine.active) return
        mine.active = false
        this.setHearing(false)
        this.send = () => {}
      },
    }
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
    this.clearView()
    this.view = hearing ? { kind: 'dot' } : { kind: 'deaf' }
    this.render()
  }

  /**
   * A tap: the names page from the bare dot, for five seconds (D31, D43);
   * anything else showing goes back to the dot (D34).
   */
  tap(): void {
    if (!this.hearing) return
    this.clearView()
    if (this.view.kind === 'dot') {
      this.view = { kind: 'names', names: this.names.list() }
      this.viewTimer = this.clock.setTimeout(() => this.backToDot(), PAGE_MS)
    } else {
      this.view = { kind: 'dot' }
    }
    this.render()
  }

  /** A long-press ends the conversation now (D52, D92). What the lens shows stays as it is. */
  longPress(): void {
    this.endConversation()
  }

  /** Whether a conversation is open. */
  get conversationOpen(): boolean {
    return this.inConversation
  }

  close(): void {
    this.closed = true
    this.clearView()
    if (this.pendingTimer) this.clock.clearTimeout(this.pendingTimer)
    this.pendingTimer = undefined
    if (this.quietTimer) this.clock.clearTimeout(this.quietTimer)
    this.quietTimer = undefined
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
    // How long ago the word ended, by the audio heard since: the provider's
    // answer comes after the speech, and the quiet is the wearer's (D92).
    this.hear(word.text, entry.side, Math.max(0, (this.coveredUntil - word.end) * 1000))
  }

  private hear(text: string, side: Side, agoMs: number): void {
    // D129: the first conversation after Catch starts begins on anyone's
    // speech; every later one begins on the wearer's.
    if (!this.inConversation && (side === 'wearer' || !this.begun)) {
      this.inConversation = true
      this.begun = true
      this.restartQuiet(agoMs)
    }
    if (side === 'wearer') {
      if (this.inConversation) this.restartQuiet(agoMs)
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

  /** The quiet timer starts over: the conversation ends ten minutes after the wearer last spoke (D92). */
  private restartQuiet(agoMs: number): void {
    if (this.quietTimer) this.clock.clearTimeout(this.quietTimer)
    this.quietTimer = this.clock.setTimeout(() => {
      this.quietTimer = undefined
      this.endConversation()
    }, QUIET_MS - agoMs)
  }

  /** The conversation ends: its names clear, and the wearer's next speech begins the next one (D92, D129). */
  private endConversation(): void {
    if (this.quietTimer) this.clock.clearTimeout(this.quietTimer)
    this.quietTimer = undefined
    this.inConversation = false
    this.names.clear()
    this.otherRun = []
    this.otherCaught.clear()
    this.wearerRun = []
  }

  private showLine(text: string): void {
    if (!this.hearing || this.closed) return
    this.clearView()
    this.view = { kind: 'line', text }
    this.render()
    this.viewTimer = this.clock.setTimeout(() => this.backToDot(), LINE_MS)
  }

  private backToDot(): void {
    this.viewTimer = undefined
    this.view = this.hearing ? { kind: 'dot' } : { kind: 'deaf' }
    this.render()
  }

  private clearView(): void {
    if (this.viewTimer) this.clock.clearTimeout(this.viewTimer)
    this.viewTimer = undefined
  }

  private render(): void {
    if (this.closed) return
    const key = JSON.stringify(this.view)
    if (key === this.sent) return
    this.sent = key
    this.send(this.view)
  }
}
