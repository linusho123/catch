import type { Clock, TimerHandle } from '../../../shared/clock.ts'
import type { LensView } from '../../../shared/lens-protocol.ts'
import type { AudioFrame } from '../../../shared/wire.ts'
import { pcmLoudnessDbfs, type FrameSignal, type Side, type SplitWord, type WearerSplit } from '../split/split.ts'
import type { SttWord } from '../stt/types.ts'
import { HeldNames, type HeldNamesState } from './held-names.ts'
import { findIntroductionsHow, findSelfIntroductions, type Introduced } from './introductions.ts'
import { CONTEXT_SENTENCES, isCandidate, owedLine, PromisePassError, type PromiseDetector, type Said } from './promises.ts'
import { Thread } from './thread.ts'
import type { TranscriptWord } from './transcript.ts'

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
//
// The dropped thread (thread.ts): when the wearer stops mid-sentence and
// someone else takes the floor, the wearer's last words show as a line that
// stays, with no timer, until the wearer speaks again or taps (D34, D35).
// With automatic detection switched off (D120, the operator's setting), no
// thread line ever comes on its own, and a tap at the dot gives the thread
// back as the held page's first line, above the names.
//
// The wearer's promises (P2a): every sentence of the wearer's that carries a
// commitment cue goes to the promise detector (promises.ts) with the
// sentences before it and the names caught; a promise shows as `promised ·
// <summary>` for a second and a half and is held for the conversation, and a
// swipe down on the names page turns to the promises page (D43, D112). At the
// end the conversation's promises go to the phone (onEnd, once every pass in
// flight has answered or reached its deadline), and its transcript is
// deleted, in the store and in the session's memory (D76).
//
// Every pass has D89's three seconds on the injected clock (fix round,
// risk-2). One that has not answered by then shows no line, is reported
// (onLatePass), and no longer holds up the end; if it answers while its
// conversation is still open, the promise is held without a line, so it still
// reaches the promises page, the notification and the phone page (operator
// answer 9). Once the end has handed the promises on, any pass still out is
// cancelled (its AbortSignal reaches the request itself) and reported lost.
//
// The keep (P4): a swipe up at the bare dot in an open conversation asks
// `keep this conversation?`; a tap keeps it (`kept` for a second and a half,
// D111), a swipe down declines (D40). The prompt has no timer: it waits however
// long it takes (D41), and a catch line that replaces it under newest-wins
// gives way to it again when the line goes, because it was never answered
// (D42). A swipe up in a kept conversation shows `already kept` (D54). The
// ended conversation tells onEnd whether it was kept, and a kept one hands
// on its transcript as the store held it (D73), where the wearer's promises
// were said, and the spans Catch could not hear (D53), so the jogger can be
// written; the store's copy is deleted at the end all the same (D76).
//
// Promises owed to the wearer (P5, D91, D26, D113): every sentence of someone
// else's that carries a commitment cue gets a pass of its own (promises.ts,
// `detectOwed`), which answers the action alone. Who promised is never
// guessed from the voice (Catch cannot tell voices apart): it is the last name
// caught in the conversation when the sentence was said, or, before any name
// is caught, an unnamed promiser, numbered in the order heard on the promises
// page, `they (1)`, `they (2)`. A name caught later attaches to the most
// recent promiser if that one is unnamed, and to nobody else (D113). The lens
// shows `Dev promised · send the agenda` (or `they promised · …`) for a second
// and a half under the same three seconds as the wearer's; the promises page
// lists the owed after the wearer's own; the end hands them on as "who does
// what", `Dev sends the agenda`, for the notification's second line and the
// phone page's OWED TO YOU (D28, D117, D98).
//
// A restart (P9, D73): everything the open conversation holds lives in the
// store from its first word, not only in this object, so a server that
// restarts (a redeploy, a crash) finds it where it was, as a lens started
// again (the Even app restarted, an Android WebView reclaimed) does already
// through the session that outlives its socket. After every change the
// session hands `persist` its state (SessionState): the names in order with
// their D87 windows, the wearer's promises and where each was said, the
// promises owed to the wearer, the keep mark, the spans not heard, when the
// quiet ends it, and where its timeline stands; the transcript is already in
// the store word by word (transcript.ts). A session built from `saved` takes
// the conversation up again: the same conversation, never a second one. What
// it never stores is what was said outside the transcript (the detector's
// context, a sentence half heard): those start again empty, as after any
// span not heard. From when the last process stopped hearing (its lens gone,
// or the process closing; at the latest its last save, for a crash) until a
// lens is heard again is a span not heard (D53). The quiet rule runs on the
// clock across the restart (D92): a conversation whose ten minutes of the
// wearer's silence ran out while no server was running ends as the session is
// built, at the moment the quiet ran out, and its transcript is deleted then
// like any other (D76), so no abandoned conversation's words outlive it. A
// conversation that ends hands the store a state with no conversation in it.

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

/**
 * D89: a promise line within three seconds. A pass not answered by then shows
 * no line, and the end of its conversation waits for it no longer (risk-2). A
 * ruling, not a tuning value.
 */
export const PROMISE_MS = 3000

/** D92: a conversation ends after ten minutes in which the wearer does not speak. A ruling, not a tuning value. */
export const QUIET_MS = 10 * 60 * 1000

/** What the lens says when the wearer swipes up to keep the conversation (D40). */
export const KEEP_PROMPT = 'keep this conversation?'
/** The line a tap on the prompt shows, for a second and a half (D111). */
export const KEPT = 'kept'
/** The line a swipe up shows in a conversation already kept, for a second and a half (D54). */
export const ALREADY_KEPT = 'already kept'

/** The most recent words the split sees at once (the provider-label split reads them together). */
const SPLIT_WINDOW_WORDS = 200

export interface SessionOptions {
  clock: Clock
  split: WearerSplit
  /** Sends a view to the lens (called only when the view changes); the same as attaching one lens at once. */
  show?: (view: LensView) => void
  /** The wearer's name (CATCH_WEARER_NAME): never caught, whatever the split decides, beside D29's own-name exclusion. */
  wearerName?: string
  /**
   * Whether the dropped thread is detected automatically (D120; on by
   * default). Read at every word and tap, so the operator's setting holds for
   * a session already open.
   */
  threadDetection?: () => boolean
  /** A conversation has ended (quiet or long-press): what it held, for the phone (D100, D28). */
  onEnd?: (ended: EndedConversation) => void
  /** The wearer's promise detector (D89); without one, nothing is ever promised. */
  promises?: PromiseDetector
  /** A model pass failed (an error, under test a missing cassette, or no answer before its conversation's end): the promise it judged is lost, loudly. */
  onModelError?: (error: unknown) => void
  /** A model pass had not answered within D89's three seconds: a promise it finds is held without a line (answer 9). */
  onLatePass?: () => void
  /** The end's hook threw (a store error, say); the conversation has ended all the same (risk-3). */
  onEndError?: (error: unknown) => void
  /** Where the open conversation's transcript is held, read for a kept one's jogger, and deleted at its end (D73, D76). */
  transcript?: { add(word: TranscriptWord): void; words?(): TranscriptWord[]; delete(): void }
  /** Where the session's state goes after every change, so a restart finds it (P9, D73). */
  persist?: (state: SessionState) => void
  /** The state a previous process left (P9): the session takes up the open conversation where it stood. */
  saved?: SessionState
  /** `persist` threw (a store error); the session goes on in memory. */
  onSaveError?: (error: unknown) => void
}

/** The open conversation as the store keeps it across a restart (P9, D73). Nothing of what was said: that is the transcript's, and goes with it (D76). */
export interface SavedConversation {
  startedAt: number
  /** The clock reading at which ten minutes of the wearer's silence end it (D92). */
  quietUntil: number
  names: HeldNamesState
  /** The wearer's promises held, in the order made, each with where it was said (seconds on the session's timeline). */
  promises: { summary: string; at: number }[]
  /** The promises owed to the wearer held, in the order made (P5, D113). */
  owed: { action: string; name?: string; heldUnnamed?: boolean; namedLater?: boolean }[]
  keep: 'none' | 'asking' | 'kept'
  gaps: Gap[]
  /** Since when Catch has not heard, if it has not heard since (D53). */
  deafSince?: { at: number; clock: number }
  /** The last name caught: who an owed promise said next is from (D91, D26). */
  lastCaught?: string
}

/** One wearer's session as the store keeps it (P9). */
export interface SessionState {
  v: 1
  /** The plugin launch last attached: the same one reconnecting is no new start (D129). */
  lens?: string
  /** Whether a conversation has begun since that launch (D129). */
  begun: boolean
  /** The names the wearer gave as their own (D29). */
  ownNames: string[]
  /** Where the session's timeline starts, on the lens's capture clock (ms), so the conversation's times run on across a restart. */
  epochMs?: number
  /** How far the audio heard reached on the timeline (seconds). */
  coveredUntil: number
  /** The clock when this state was saved: Catch heard at least until then. */
  savedAt: number
  conversation?: SavedConversation
}

/** A span of an open conversation in which Catch could not hear (D37, D53): where it fell, and how long it lasted. */
export interface Gap {
  /** Where it fell on the session's timeline (seconds): after every word that ended by then. */
  at: number
  /** How long it lasted, on the session's clock (ms). */
  ms: number
}

/** A conversation as it ends, on the session's clock (ms). */
export interface EndedConversation {
  startedAt: number
  endedAt: number
  /** The names caught, in the order heard. */
  names: string[]
  /** The wearer's promises, as the lens summarizes them, in the order made (D89). */
  promises: string[]
  /** Where each of `promises` was said: the end of its sentence on the session's timeline (seconds). */
  promiseTimes: number[]
  /** The promises owed to the wearer, in the order made, each "who does what": `Dev sends the agenda`, `they (1) sends the deck tonight` (P5). */
  owed: string[]
  /** Whether the wearer kept it (D40, D111). */
  kept: boolean
  /** A kept conversation's transcript as the store held it, in the order heard (D73), for its jogger; empty when it was not kept. */
  transcript: TranscriptWord[]
  /** The spans Catch could not hear while it was open, in order (D53). */
  gaps: Gap[]
}

/** One promise owed to the wearer, from the moment its sentence ends (P5). */
interface OwedSlot {
  /** Until its pass answers; `no` when it was no promise, or its pass was lost. */
  state: 'out' | 'yes' | 'no'
  /** What the promiser will do, once the pass has said it is a promise: `send the agenda`. */
  action?: string
  /** The name the promiser goes by: the last name caught when the sentence was said, or one caught after it (D113). */
  name?: string
  /** The name came after the sentence (D113): if the pass then says no promise, the name passes to the promiser before. */
  namedLater?: boolean
  /** It was held with no name, so it counts among the numbered unnamed promisers, `they (n)` (D113). */
  heldUnnamed?: boolean
}

/** One conversation's promises: a slot per pass, in the order the sentences were said, and the passes still out. */
interface Promises {
  slots: (string | undefined)[]
  /** Where each slot's sentence ended, on the session's timeline (seconds). */
  times: number[]
  /** The promises owed to the wearer, a slot per pass, in the order the sentences were said (P5). */
  owed: OwedSlot[]
  /** What the end waits for: one per pass, settled at its answer or at its deadline, whichever comes first. */
  inflight: Set<Promise<void>>
  /** Every pass not yet answered, deadline or not: cancelled once the end has handed the promises on. */
  out: Set<AbortController>
  /** The end has handed this conversation's promises on (or the session closed): a later answer can go nowhere. */
  done: boolean
}

const noPromises = (): Promises => ({ slots: [], times: [], owed: [], inflight: new Set(), out: new Set(), done: false })

const held = (p: Promises) => p.slots.filter((s): s is string => s !== undefined)
const heldTimes = (p: Promises) => p.times.filter((_, i) => p.slots[i] !== undefined)

/**
 * The owed promises held, in the order made, as "who does what". The unnamed
 * promisers are numbered in the order heard among those held unnamed, so a
 * name that comes later leaves the others' numbers alone (D113: `they (2)`
 * becomes `Dev`, `they (1)` stays `they (1)`).
 */
function heldOwed(p: Promises): string[] {
  let they = 0
  const out: string[] = []
  for (const slot of p.owed) {
    if (slot.state !== 'yes' || slot.action === undefined) continue
    const n = slot.heldUnnamed ? ++they : 0
    out.push(owedLine(slot.name ?? `they (${n})`, slot.action))
  }
  return out
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
  private startedAt = 0
  private readonly onEnd: ((ended: EndedConversation) => void) | undefined
  /** Whether any conversation has begun since Catch started: until one has, anyone's speech begins it (D129). */
  private begun = false
  /**
   * How far the audio reached (on the session's timeline) when the wearer last
   * long-pressed: a word that ended by then was said before the press, so it
   * is not "the next thing the wearer says" and begins nothing (D52, M2).
   */
  private pressedAt = -Infinity
  private otherRun: string[] = []
  private otherCaught = new Set<number>()
  private wearerRun: string[] = []
  /** When the conversation ends unless the wearer speaks (D92). */
  private quietTimer: TimerHandle | undefined
  /** The clock reading at which it does (D92), kept so a restart runs the same ten minutes on (P9). */
  private quietUntil = 0
  /** Names the wearer gave as their own (D29): never caught from anyone. They are the wearer's, so they outlast a conversation. */
  private ownNames = new Set<string>()
  /** The configured wearer name, case-folded, if any. */
  private readonly wearerName: string | undefined
  readonly names = new HeldNames()
  /** The wearer's most recent continuous run, and whether someone has taken the floor from it (D35, D48). */
  private readonly thread = new Thread()
  private readonly threadDetection: () => boolean
  private readonly detector: PromiseDetector | undefined
  private readonly onModelError: (error: unknown) => void
  private readonly onLatePass: () => void
  private readonly onEndError: (error: unknown) => void
  private readonly transcript: SessionOptions['transcript']
  /** The open conversation's promises. */
  private promises: Promises = noPromises()
  /** Ended conversations whose end still waits for a pass: none is handed on once the session closes (risk-3). */
  private readonly ending = new Set<Promises>()
  /** The wearer's sentence so far, someone else's, and the sentences said before them (the detector's context). */
  private wearerSentence: string[] = []
  /** Where the wearer's sentence so far ends on the session's timeline: where a promise in it was said. */
  private wearerSentenceEnd = 0
  private otherSentence: string[] = []
  private said: Said[] = []
  /** The open conversation's keep: not asked, the prompt waiting for an answer, or kept (D40, D41, D54, D111). */
  private keep: 'none' | 'asking' | 'kept' = 'none'
  /** Since when Catch has not heard, while a conversation was open (D53): where on the timeline, and the clock then. */
  private deafSince: { at: number; clock: number } | undefined
  /** The open conversation's spans not heard (D53). */
  private gaps: Gap[] = []
  /** The last name caught in the open conversation: who an owed promise said now is from (P5, D91, D26). */
  private lastCaught: string | undefined
  /**
   * A name caught by someone else's pattern ("meet X", "this is X", "X, nice
   * to meet you") inside the other sentence still open: it is someone the
   * speaker mentions, not the speaker, so it becomes the last name caught only
   * once that sentence has been judged (risk-1).
   */
  private caughtInSentence: string | undefined

  // What the lens shows.
  private hearing = false
  private view: LensView = { kind: 'deaf' }
  /** The view showing is the dropped-thread line: it stays until the wearer speaks or taps (D34, D35). */
  private threadShowing = false
  /** The view showing is the keep prompt: it stays until a tap or a swipe down (D40, D41). */
  private promptShowing = false
  /** The lens starts with no dot (it cannot hear until told), so the first view worth sending is the dot. */
  private sent = DEAF
  /** Takes a line or a page off the lens when its time is up. */
  private viewTimer: TimerHandle | undefined
  private closed = false
  private readonly persist: ((state: SessionState) => void) | undefined
  private readonly onSaveError: (error: unknown) => void
  /** The state last handed to `persist`, without its time: an unchanged state is not written again. */
  private savedKey: string | undefined

  constructor(opts: SessionOptions) {
    this.clock = opts.clock
    this.split = opts.split
    this.wearerName = opts.wearerName?.trim().toLowerCase() || undefined
    this.threadDetection = opts.threadDetection ?? (() => true)
    this.onEnd = opts.onEnd
    this.detector = opts.promises
    this.onModelError = opts.onModelError ?? (() => {})
    this.onLatePass = opts.onLatePass ?? (() => {})
    this.onEndError = opts.onEndError ?? (() => {})
    this.transcript = opts.transcript
    this.persist = opts.persist
    this.onSaveError = opts.onSaveError ?? (() => {})
    if (opts.saved) this.restore(opts.saved)
    if (opts.show) this.attach(opts.show)
  }

  /**
   * Takes up what a previous process left (P9, D73): the open conversation
   * with its names, promises, keep mark and spans not heard, not yet hearing.
   * One whose quiet ran out meanwhile ends now, at the moment it ran out (D92).
   */
  private restore(state: SessionState): void {
    this.lensId = state.lens
    this.begun = state.begun
    this.ownNames = new Set(state.ownNames)
    this.epochMs = state.epochMs
    this.coveredUntil = state.coveredUntil
    this.savedKey = JSON.stringify({ ...state, savedAt: 0 })
    const c = state.conversation
    if (!c) return
    this.inConversation = true
    this.begun = true
    this.startedAt = c.startedAt
    this.names.restore(c.names)
    this.promises.slots = c.promises.map((p) => p.summary)
    this.promises.times = c.promises.map((p) => p.at)
    this.promises.owed = c.owed.map((o) => ({
      state: 'yes',
      action: o.action,
      ...(o.name !== undefined ? { name: o.name } : {}),
      ...(o.heldUnnamed ? { heldUnnamed: true } : {}),
      ...(o.namedLater ? { namedLater: true } : {}),
    }))
    this.keep = c.keep
    this.gaps = c.gaps.map((g) => ({ ...g }))
    this.lastCaught = c.lastCaught
    // Not heard since the last process stopped hearing, or at the latest since it last saved (a crash).
    this.deafSince = c.deafSince ? { ...c.deafSince } : { at: state.coveredUntil, clock: state.savedAt }
    this.quietUntil = c.quietUntil
    const left = c.quietUntil - this.clock.now()
    if (left <= 0) this.endConversation(c.quietUntil)
    else this.armQuiet(left)
  }

  /** What the store keeps of this session now (P9). */
  private snapshot(): SessionState {
    const owed = this.promises.owed
      .filter((o) => o.state === 'yes' && o.action !== undefined)
      .map((o) => ({
        action: o.action!,
        ...(o.name !== undefined ? { name: o.name } : {}),
        ...(o.heldUnnamed ? { heldUnnamed: true } : {}),
        ...(o.namedLater ? { namedLater: true } : {}),
      }))
    return {
      v: 1,
      ...(this.lensId !== undefined ? { lens: this.lensId } : {}),
      begun: this.begun,
      ownNames: [...this.ownNames],
      ...(this.epochMs !== undefined ? { epochMs: this.epochMs } : {}),
      coveredUntil: this.coveredUntil,
      savedAt: this.clock.now(),
      ...(this.inConversation
        ? {
            conversation: {
              startedAt: this.startedAt,
              quietUntil: this.quietUntil,
              names: this.names.snapshot(),
              promises: held(this.promises).map((summary, i) => ({ summary, at: heldTimes(this.promises)[i]! })),
              owed,
              keep: this.keep,
              gaps: this.gaps.map((g) => ({ ...g })),
              ...(this.deafSince ? { deafSince: { ...this.deafSince } } : {}),
              ...(this.lastCaught !== undefined ? { lastCaught: this.lastCaught } : {}),
            },
          }
        : {}),
    }
  }

  /** Hands the store the session's state if it changed (P9); never after the session has closed. */
  private save(): void {
    if (this.closed || !this.persist) return
    const state = this.snapshot()
    const key = JSON.stringify({ ...state, savedAt: 0 })
    if (key === this.savedKey) return
    try {
      this.persist(state)
      this.savedKey = key
    } catch (error) {
      this.onSaveError(error)
    }
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
    this.save()
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
    // What was said while Catch could not hear may have finished the wearer's
    // sentence, or been someone else's turn: the run is not known to be cut off.
    if (!hearing) this.thread.clear()
    // D53: a span the open conversation did not hear, from here to when Catch hears again (or the end).
    if (!hearing && this.inConversation) this.deafSince = { at: this.coveredUntil, clock: this.clock.now() }
    if (hearing) this.closeGap()
    this.clearView()
    this.toRest()
    this.render()
    this.save()
  }

  /**
   * A tap: the names page from the bare dot, for five seconds (D31, D43);
   * anything else showing goes back to the dot (D34).
   */
  tap(): void {
    if (!this.hearing) return
    // D111: a tap on the prompt keeps the conversation.
    if (this.promptShowing) {
      this.keep = 'kept'
      this.showLine(KEPT)
      this.save()
      return
    }
    this.clearView()
    if (this.view.kind === 'dot') {
      // D120: with detection off, the page gives the thread back as its first line.
      const thread = this.threadDetection() ? undefined : this.thread.line()
      const names = this.names.list()
      // With no names but promises held (either way), the names page leads on to them; D31's empty page is for nothing held.
      const promisesHeld = names.length === 0 && (held(this.promises).length > 0 || heldOwed(this.promises).length > 0)
      this.view = { kind: 'names', names, ...(thread ? { thread } : {}), ...(promisesHeld ? { promisesHeld: true as const } : {}) }
      this.viewTimer = this.clock.setTimeout(() => this.backToDot(), PAGE_MS)
    } else {
      // A line or a page goes; an unanswered prompt comes back in its place (D42).
      this.toRest()
    }
    this.render()
  }

  /**
   * A swipe down: on the names page, the promises page, for five seconds
   * (D43, D112); on the keep prompt, no (D40). Anywhere else it means nothing
   * yet (P6 pauses at the dot).
   */
  swipeDown(): void {
    if (!this.hearing) return
    // D40: a swipe down on the prompt declines it; nothing is kept, and a later swipe up asks again.
    if (this.promptShowing) {
      this.keep = 'none'
      this.backToDot()
      this.save()
      return
    }
    if (this.view.kind !== 'names') return
    this.clearView()
    this.view = { kind: 'promises', you: held(this.promises), owed: heldOwed(this.promises) }
    this.viewTimer = this.clock.setTimeout(() => this.backToDot(), PAGE_MS)
    this.render()
  }

  /**
   * A swipe up at the bare dot in an open conversation: the keep prompt, which
   * waits for a tap or a swipe down however long it takes (D40, D41); in a
   * conversation already kept, `already kept` for a second and a half (D54).
   * On the prompt it changes nothing (the prompt stays, D41); on a line or a
   * page it means nothing yet (P10 scrolls a page back). With no conversation
   * open there is nothing to keep, and it does nothing.
   */
  swipeUp(): void {
    if (!this.hearing || this.closed || this.promptShowing) return
    if (this.view.kind !== 'dot' || !this.inConversation) return
    if (this.keep === 'kept') {
      this.showLine(ALREADY_KEPT)
      return
    }
    this.keep = 'asking'
    this.toRest()
    this.render()
    this.save()
  }

  /**
   * A long-press ends the conversation now (D52, D92). A line or a page
   * showing goes back to the dot at once, so the end is visible and the ended
   * conversation's names are never shown after it (operator answer 4).
   */
  longPress(): void {
    this.pressedAt = this.coveredUntil
    this.endConversation()
    if (!this.hearing || this.closed) return
    this.clearView()
    this.view = { kind: 'dot' }
    this.render()
  }

  /** Whether a conversation is open. */
  get conversationOpen(): boolean {
    return this.inConversation
  }

  close(): void {
    // The process is stopping, not the conversation (P9): until a server hears this wearer again is a span not heard (D53).
    if (this.inConversation && !this.deafSince) this.deafSince = { at: this.coveredUntil, clock: this.clock.now() }
    this.save()
    this.closed = true
    // Nothing of an ended conversation's is handed on after the session has closed, and no pass is left on the network (risk-3).
    this.stopPasses(this.promises)
    for (const promises of this.ending) this.stopPasses(promises)
    this.ending.clear()
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
    this.hear(word.text, entry.side, word.start, word.end, Math.max(0, (this.coveredUntil - word.end) * 1000))
    this.save()
  }

  private hear(text: string, side: Side, start: number, end: number, agoMs: number): void {
    // D129: the first conversation after Catch starts begins on anyone's
    // speech; every later one begins on the wearer's. Never on a word said
    // before the last long-press, however late the provider delivers it (D52).
    if (!this.inConversation && end > this.pressedAt && (side === 'wearer' || !this.begun)) {
      this.inConversation = true
      this.begun = true
      this.startedAt = this.clock.now() - agoMs
      this.restartQuiet(agoMs)
    }
    if (this.inConversation) this.transcript?.add({ text, start, end, side })
    this.sentences(text, side, end)
    if (side === 'wearer') {
      if (this.inConversation) this.restartQuiet(agoMs)
      this.otherRun = []
      this.otherCaught.clear()
      this.wearerRun.push(text)
      // D48, D52: a word said before the last long-press, however late the
      // provider delivers it, is no part of the next conversation's run (head-1).
      if (end > this.pressedAt) this.thread.wearer(text)
      // D35: the wearer speaks again, and the thread line goes.
      if (this.threadShowing) this.backToDot()
      // D29: only the wearer giving their own name ("I'm X", "my name is X"), never "meet X" or "X, nice to meet you" (M2).
      for (const { name } of findSelfIntroductions(this.wearerRun)) this.ownNames.add(name.toLowerCase())
      return
    }
    this.wearerRun = []
    if (!this.inConversation) return
    // D35: someone else has taken the floor from a wearer who stopped mid-sentence.
    const line = this.thread.other(start, end)
    if (line !== undefined && this.threadDetection()) this.showThread(line)
    this.otherRun.push(text)
    for (const { name, index, how } of findIntroductionsHow(this.otherRun)) {
      if (this.otherCaught.has(index)) continue
      this.otherCaught.add(index)
      if (this.ownNames.has(name.toLowerCase()) || name.toLowerCase() === this.wearerName) continue
      const heard = this.names.hear(name, this.clock.now(), how)
      this.showLine(heard.line)
      this.nameCaught(heard.line, how)
    }
  }

  /**
   * Gathers the words into sentences, by the provider's punctuation or a
   * change of speaker; each finished sentence of the wearer's is a candidate
   * promise (promises.ts says which are worth a model pass).
   */
  private sentences(text: string, side: Side, end: number): void {
    const mine = side === 'wearer' ? this.wearerSentence : this.otherSentence
    if (side === 'wearer') this.finishOther()
    else this.finishWearer()
    mine.push(text)
    if (side === 'wearer') this.wearerSentenceEnd = end
    if (!/[.!?]$/.test(text)) return
    if (side === 'wearer') this.finishWearer()
    else this.finishOther()
  }

  private finishOther(): void {
    if (this.otherSentence.length === 0) return
    const text = this.otherSentence.splice(0).join(' ')
    const before = this.said.slice()
    this.remember({ who: 'other', text })
    if (this.inConversation && this.detector) this.judgeOwed(text, before)
    if (this.caughtInSentence !== undefined) this.lastCaught = this.caughtInSentence
    this.caughtInSentence = undefined
  }

  private finishWearer(): void {
    if (this.wearerSentence.length === 0) return
    const text = this.wearerSentence.splice(0).join(' ')
    const before = this.said.slice()
    this.remember({ who: 'wearer', text })
    if (this.inConversation && this.detector) this.judgePromise(text, before, this.wearerSentenceEnd)
  }

  private remember(s: Said): void {
    this.said.push(s)
    if (this.said.length > CONTEXT_SENTENCES) this.said.splice(0, this.said.length - CONTEXT_SENTENCES)
  }

  /**
   * One model pass of the wearer's (D89, D90, D47), with D89's three seconds
   * on the clock (risk-2). A promise is held in this conversation's slot, and
   * shown if it came within the three seconds and the conversation is still
   * open; one that came later is held without a line (answer 9).
   */
  private judgePromise(text: string, before: Said[], at: number): void {
    // A sentence with no commitment cue costs no pass, and so no deadline either.
    if (!isCandidate(text)) return
    const promises = this.promises
    const slot = promises.slots.push(undefined) - 1
    promises.times[slot] = at
    const names = this.names.list()
    this.pass(
      promises,
      (signal) => this.detector!.detect(text, before, names, signal),
      (summary, late) => {
        promises.slots[slot] = summary
        if (!late && this.promises === promises) this.showLine(`promised · ${summary}`)
      },
    )
  }

  /**
   * One model pass of someone else's sentence (P5, D91, D26, D113), on the
   * same three seconds. The promiser is named as the sentence ends, by the last
   * name caught before it or its speaker's own "I'm X" in it (never a name
   * the speaker mentions in it, risk-1), and stays unnamed when none has been; a promise is held and
   * shown as `Dev promised · …` or `they promised · …`.
   */
  private judgeOwed(text: string, before: Said[]): void {
    if (!isCandidate(text)) return
    const promises = this.promises
    const slot: OwedSlot = { state: 'out', ...(this.lastCaught !== undefined ? { name: this.lastCaught } : {}) }
    promises.owed.push(slot)
    this.pass(
      promises,
      (signal) => this.detector!.detectOwed(text, before, signal),
      (action, late) => {
        slot.state = 'yes'
        slot.action = action
        if (slot.name === undefined) slot.heldUnnamed = true
        if (!late && this.promises === promises) this.showLine(`${slot.name ?? 'they'} promised · ${action}`)
      },
      () => this.noOwed(promises, slot),
    )
  }

  /**
   * A name is caught (P5, D113): it is the one later owed promises are from,
   * and, given by its owner ("I'm X", "my name is X"), it attaches to the most
   * recent promiser, if that one has no name yet (a pass still out counts; one
   * that said no promise does not). A name given by someone else ("meet X",
   * "this is X", "X, nice to meet you") never names a promiser, neither the
   * one of its own sentence nor an earlier one (risk-1, the human's answer 1):
   * it names only the promisers of sentences said after its own.
   */
  private nameCaught(name: string, how: Introduced): void {
    if (how !== 'self') {
      if (this.otherSentence.length > 0) this.caughtInSentence = name
      else this.lastCaught = name
      return
    }
    this.lastCaught = name
    this.caughtInSentence = undefined
    const last = this.promises.owed.findLast((s) => s.state !== 'no')
    if (last && last.name === undefined) {
      last.name = name
      last.namedLater = true
    }
  }

  /** An owed pass said no promise, or was lost: a name that came after it belongs to the promiser before it, if unnamed (D113). */
  private noOwed(promises: Promises, slot: OwedSlot): void {
    slot.state = 'no'
    if (!slot.namedLater) return
    const before = promises.owed.slice(0, promises.owed.indexOf(slot)).findLast((s) => s.state !== 'no')
    if (before && before.name === undefined) {
      before.name = slot.name
      before.namedLater = true
    }
    slot.name = undefined
    slot.namedLater = false
  }

  /**
   * The machinery of one pass (risk-2): D89's three seconds on the clock,
   * after which the end of its conversation waits for it no longer; its
   * cancellation once the end has handed the promises on; `promised` for an
   * answer that is a promise (`late` once the three seconds have passed),
   * `none` for one that is not, or for a pass lost.
   */
  private pass(
    promises: Promises,
    ask: (signal: AbortSignal) => Promise<string | undefined>,
    promised: (summary: string, late: boolean) => void,
    none: () => void = () => {},
  ): void {
    const abort = new AbortController()
    promises.out.add(abort)
    let late = false
    let leave!: () => void
    const waited = new Promise<void>((resolve) => (leave = resolve))
    promises.inflight.add(waited)
    const left = () => {
      promises.inflight.delete(waited)
      leave()
    }
    const deadline = this.clock.setTimeout(() => {
      late = true
      if (!promises.done) this.onLatePass()
      left()
    }, PROMISE_MS)
    ask(abort.signal)
      .then((summary) => {
        if (summary === undefined) return none()
        if (promises.done) throw new PromisePassError('the promise pass answered after its conversation had ended, so that promise is lost')
        promised(summary, late)
      })
      .catch((error: unknown) => {
        none()
        if (this.closed) return
        this.onModelError(abort.signal.aborted ? new PromisePassError('the conversation ended before the promise pass answered, so that promise is lost') : error)
      })
      .finally(() => {
        this.clock.clearTimeout(deadline)
        promises.out.delete(abort)
        left()
        this.save()
      })
  }

  /** The conversation's promises are final: a pass still out can go nowhere, so it is cancelled. */
  private stopPasses(promises: Promises): void {
    promises.done = true
    for (const abort of promises.out) abort.abort()
  }

  /** The quiet timer starts over: the conversation ends ten minutes after the wearer last spoke (D92). */
  private restartQuiet(agoMs: number): void {
    this.quietUntil = this.clock.now() + QUIET_MS - agoMs
    this.armQuiet(QUIET_MS - agoMs)
  }

  /** The conversation ends `ms` from now, at `quietUntil`, unless the wearer speaks first (D92). */
  private armQuiet(ms: number): void {
    if (this.quietTimer) this.clock.clearTimeout(this.quietTimer)
    this.quietTimer = this.clock.setTimeout(() => {
      this.quietTimer = undefined
      this.endConversation(this.quietUntil)
    }, ms)
  }

  /**
   * The conversation ends: its names clear, its transcript is deleted (D76),
   * its promises go to the phone, and the wearer's next speech begins the
   * next one (D92, D129). `at` is when it ended: now, or the moment its
   * quiet ran out (a restart that found the ten minutes over, P9).
   */
  private endConversation(at = this.clock.now()): void {
    if (this.quietTimer) this.clock.clearTimeout(this.quietTimer)
    this.quietTimer = undefined
    // A sentence cut short by the end, the wearer's or someone else's, is still a candidate.
    this.finishWearer()
    this.finishOther()
    // A span not heard runs to the end at most (D53).
    this.closeGap(at)
    // Snapshot, reset, then the hook: the conversation is over whatever the hook does (fix round, M4).
    // A kept conversation's transcript is read from the store before the store's copy goes (D73, D76).
    const kept = this.keep === 'kept'
    const ended = this.inConversation
      ? {
          startedAt: this.startedAt,
          endedAt: at,
          names: this.names.list(),
          kept,
          transcript: kept ? (this.transcript?.words?.() ?? []) : [],
          gaps: this.gaps,
        }
      : undefined
    const promises = this.promises
    this.promises = noPromises()
    this.inConversation = false
    this.keep = 'none'
    this.gaps = []
    this.deafSince = undefined
    this.lastCaught = undefined
    this.caughtInSentence = undefined
    // An unanswered prompt asked about the conversation that has ended: it goes (D40).
    if (this.promptShowing) this.backToDot()
    this.names.clear()
    this.otherRun = []
    this.otherCaught.clear()
    this.wearerRun = []
    this.thread.clear()
    // D76: nothing of what was said survives the boundary, in the store or here.
    this.wearerSentence = []
    this.otherSentence = []
    this.said = []
    this.judged = []
    if (ended) this.transcript?.delete()
    // The store's state no longer holds a conversation (P9): a restart now finds none to take up.
    this.save()
    if (!ended) {
      this.stopPasses(promises)
      return
    }
    // The promises once every pass still out has answered or reached its
    // deadline (risk-2); at once (on the clock's own reading) when none is.
    // A throw from the hook goes to onEndError, never out of a timer or an
    // unhandled rejection, and nothing is handed on once the session has
    // closed (risk-3).
    const finish = () => {
      this.ending.delete(promises)
      if (promises.done) return
      this.stopPasses(promises)
      if (this.closed) return
      try {
        this.onEnd?.({ ...ended, promises: held(promises), promiseTimes: heldTimes(promises), owed: heldOwed(promises) })
      } catch (error) {
        this.onEndError(error)
      }
    }
    if (promises.inflight.size === 0) return finish()
    this.ending.add(promises)
    void Promise.allSettled(promises.inflight).then(finish)
  }

  private showLine(text: string): void {
    if (!this.hearing || this.closed) return
    this.clearView()
    this.view = { kind: 'line', text }
    this.render()
    this.viewTimer = this.clock.setTimeout(() => this.backToDot(), LINE_MS)
  }

  /** The dropped-thread line: no timer; it stays until the wearer speaks again or taps (D34, D35). */
  private showThread(text: string): void {
    if (!this.hearing || this.closed) return
    this.clearView()
    this.view = { kind: 'line', text }
    this.threadShowing = true
    this.render()
  }

  /** A line or a page goes: the lens comes back to rest (the dot, or an unanswered prompt, D42). */
  private backToDot(): void {
    this.clearView()
    this.toRest()
    this.render()
  }

  /**
   * The view at rest: an unanswered keep prompt while the conversation is
   * open and Catch can hear (D40, D42), else the dot, or no mark while Catch
   * cannot hear (D37). Call after clearView.
   */
  private toRest(): void {
    if (this.hearing && this.inConversation && this.keep === 'asking') {
      this.view = { kind: 'line', text: KEEP_PROMPT }
      this.promptShowing = true
      return
    }
    this.view = this.hearing ? { kind: 'dot' } : { kind: 'deaf' }
  }

  /** Catch hears again (now), or the conversation ends (at `at`): a span not heard is closed and kept for the jogger (D53). */
  private closeGap(at = this.clock.now()): void {
    if (!this.deafSince) return
    if (this.inConversation) this.gaps.push({ at: this.deafSince.at, ms: Math.max(0, at - this.deafSince.clock) })
    this.deafSince = undefined
  }

  private clearView(): void {
    if (this.viewTimer) this.clock.clearTimeout(this.viewTimer)
    this.viewTimer = undefined
    this.threadShowing = false
    this.promptShowing = false
  }

  private render(): void {
    if (this.closed) return
    const key = JSON.stringify(this.view)
    if (key === this.sent) return
    this.sent = key
    this.send(this.view)
  }
}
