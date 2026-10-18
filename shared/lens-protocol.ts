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
  /** One catch: a dim line in the lower third, for a second and a half (D17) or, the dropped thread, until cleared (D35). */
  | { kind: 'line'; text: string }
  /**
   * The names page (D43): the held names in the order heard; none held is
   * D31's empty page. With automatic thread detection off, `thread` is the
   * wearer's last words, the page's first line, above the names (D120).
   */
  | { kind: 'names'; names: string[]; thread?: string }
  /**
   * The promises page (D43), after the names page on a swipe down: the
   * wearer's own promises in the order made, or `no promises yet` when there
   * are none (D112). P5 adds those owed to the wearer, after them.
   */
  | { kind: 'promises'; you: string[] }

/** Server to lens. */
export type ServerMessage =
  | FrameAck
  | { type: 'show'; view: LensView }
  | { type: 'error'; message: string }

/**
 * A tap; a long-press ends the conversation now (D52); a swipe down turns the
 * names page to the promises page (D43). Double-tap is Even's exit and never
 * leaves the lens.
 */
export type Gesture = 'tap' | 'long-press' | 'swipe-down'

const GESTURES: readonly string[] = ['tap', 'long-press', 'swipe-down'] satisfies Gesture[]

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
