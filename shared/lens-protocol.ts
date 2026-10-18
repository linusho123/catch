// What the server and the lens say to each other over /audio besides the
// binary audio frames (shared/wire.ts). The server decides what the glasses
// show and when (its clock times every line); the lens draws each view it is
// sent and forwards the wearer's touches. JSON text messages both ways; no
// runtime imports, so the browser bundle and Node load it as is.

import type { FrameAck } from './wire.ts'

/** One thing on the lens. The lens never shows two at once (DESIGN.md: the newest wins). */
export type LensView =
  /** Listening, nothing has slipped: the dim dot, top right (D14). */
  | { kind: 'dot' }
  /** Catch cannot hear: no mark at all (D37). */
  | { kind: 'deaf' }
  /** The wearer paused Catch: a dim dash in the dot's place for as long as the pause lasts, so paused never looks like can't-hear (D86, P6). */
  | { kind: 'dash' }
  /** One catch: a dim line in the lower third, for a second and a half (D17) or, the dropped thread, until cleared (D35). */
  | { kind: 'line'; text: string }
  /**
   * The names page (D43): the held names in the order heard, as many as one
   * page lists (`NAMES_PER_PAGE`; the server scrolls past them, P10); none
   * held is D31's empty page. With automatic thread detection off, `thread` is the
   * wearer's last words, the page's first line, above the names (D120).
   * `promisesHeld` says that, with no names held, promises are (either way,
   * P5): the page is then the names page, its header and its hint to the
   * promises, not D31's `nothing held`.
   */
  | { kind: 'names'; names: string[]; thread?: string; promisesHeld?: true }
  /**
   * The promises page (D43), after the names page on a swipe down: the
   * wearer's own promises in the order made, then those owed to the wearer
   * (P5, D91), each "who does what" (`Dev sends the agenda`, drawn as
   * `owed: Dev sends the agenda`); `no promises yet` when there are none (D112).
   */
  | { kind: 'promises'; you: string[]; owed: string[] }

/**
 * The G2's text line, in pixels: the firmware's LVGL line height is fixed at
 * 27 px (Even's `text-heavy` template). A text container that holds more lines
 * than fit is scrolled by the firmware itself, out of the server's sight, when
 * it takes the touches; so the names page never sends more than fit (P10).
 */
export const LINE_PX = 27

/**
 * How many names one names page lists (P10, D43): as many as fit the names
 * container at the G2's line height, 7 in its 208 px, or 6 in the 168 px
 * under the thread line (D120). Past them a swipe down scrolls to the next
 * page of names, and only at the last name turns to the promises page.
 */
export const NAMES_PER_PAGE = 7
export const NAMES_PER_PAGE_UNDER_THREAD = 6

/** Server to lens. */
export type ServerMessage =
  | FrameAck
  | { type: 'show'; view: LensView }
  | { type: 'error'; message: string }
  /**
   * Whether the lens streams the glasses' audio (P6, D86): `false` while the
   * wearer has paused Catch, so nothing said then leaves the glasses; `true`
   * when the wearer resumes. Each socket starts muted on the lens: the server
   * says `true` as it takes one, unless Catch is paused, so a lens that
   * reconnects during a pause never reopens the microphone.
   */
  | { type: 'listening'; on: boolean }
  /**
   * How the lens draws (readability pass, on the real G2): the text's
   * brightness (the SDK's textColor, 0..4) and where the dot sits. Sent once
   * as the server takes a socket, from CATCH_LENS_BRIGHTNESS, CATCH_DOT_X and
   * CATCH_DOT_Y; a lens that never hears it keeps its defaults, and an older
   * lens ignores it.
   */
  | { type: 'style'; style: LensStyle }

/** The lens's brightness and the dot's top-left corner on the 576 x 288 canvas. */
export interface LensStyle {
  brightness: number
  dot: { x: number; y: number }
}

/**
 * A tap; a long-press ends the conversation now (D52); a swipe down scrolls
 * the names page and, past its last name, turns to the promises page (D43),
 * declines the keep prompt (D40), and, with the pause switched on
 * (CATCH_PAUSE, P6), pauses Catch at the bare dot and resumes it at the dash
 * (D86); a swipe up asks to keep the conversation at the dot (D40) and
 * scrolls a held page back (D43, P10). Double-tap is Even's exit and never
 * leaves the lens.
 */
export type Gesture = 'tap' | 'long-press' | 'swipe-down' | 'swipe-up'

const GESTURES: readonly string[] = ['tap', 'long-press', 'swipe-down', 'swipe-up'] satisfies Gesture[]

/** Lens to server. */
export type LensMessage = { type: 'touch'; gesture: Gesture }

export function parseLensMessage(raw: string): LensMessage | null {
  try {
    const msg = JSON.parse(raw) as Partial<LensMessage>
    if (msg.type === 'touch' && typeof msg.gesture === 'string' && GESTURES.includes(msg.gesture)) return { type: 'touch', gesture: msg.gesture }
  } catch {
    // not JSON: ignored like any other message the server does not know
  }
  return null
}
