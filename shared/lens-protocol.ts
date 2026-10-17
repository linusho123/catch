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
  /** One catch: a dim line in the lower third for a second and a half (D17). */
  | { kind: 'line'; text: string }
  /** The held names, in the order heard (the minimal page P1b finishes). */
  | { kind: 'names'; names: string[] }

/** Server to lens. */
export type ServerMessage =
  | FrameAck
  | { type: 'show'; view: LensView }
  | { type: 'error'; message: string }

export type Gesture = 'tap'

/** Lens to server. */
export type LensMessage = { type: 'touch'; gesture: Gesture }

export function parseLensMessage(raw: string): LensMessage | null {
  try {
    const msg = JSON.parse(raw) as Partial<LensMessage>
    if (msg.type === 'touch' && msg.gesture === 'tap') return { type: 'touch', gesture: 'tap' }
  } catch {
    // not JSON: ignored like any other message the server does not know
  }
  return null
}
