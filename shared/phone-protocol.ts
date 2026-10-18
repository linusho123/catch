// What the server's phone API answers the plugin's phone page (D130): the
// history (D100) and one conversation's screen (D98). Read-only GETs over the
// store, behind the same shared token as /audio, sent as
// `Authorization: Bearer <token>`. No runtime imports, so the browser bundle
// and Node load it as is. Times are milliseconds on the server's clock, like
// Date.now(); the page groups and formats them in the phone's own time zone.
//
// Filled in by the phases that make what it carries: the wearer's promises
// (`you`) in P2a, the keep (`kept`) and the jogger in P4, the promises owed to
// the wearer (`owed`) in P5. Tick-off on the phone is cut (D126, D130), so
// nothing yet sets `done`.

export const PHONE_HISTORY_PATH = '/phone/history'
export const PHONE_CONVERSATION_PATH = '/phone/conversations/'
/** GET /phone/conversations/<id>/jogger: a kept conversation's jogger (D99). */
export const PHONE_JOGGER_SUFFIX = '/jogger'

/** One promise on a conversation's screen. */
export interface PhonePromise {
  id: number
  /** The summary as a command, "Send Dev the deck tonight" (D89). */
  text: string
  done: boolean
}

/** One row of the history: one conversation that produced a promise or a keep (D100). */
export interface HistoryRow {
  id: number
  startedAt: number
  /** The names caught, in the order heard; none is shown as "no name". */
  names: string[]
  /** The wearer's own promises (YOU) not yet done; the owed ones never count (operator answer 2). */
  open: number
  kept: boolean
}

/** GET /phone/history: newest first. */
export interface HistoryResponse {
  /** Every open promise of the wearer's own across the history, for the header (D100). */
  open: number
  conversations: HistoryRow[]
}

/** GET /phone/conversations/<id>: the conversation's screen (D98). */
export interface ConversationResponse {
  id: number
  startedAt: number
  endedAt: number
  names: string[]
  kept: boolean
  /** The wearer's promises, in the order made. */
  you: PhonePromise[]
  /** The promises owed to the wearer, in the order made (P5). */
  owed: PhonePromise[]
  /** Whether a jogger has been written for it: the screen links to it, "Kept conversation ›" (D99). */
  jogger: boolean
}

/** GET /phone/conversations/<id>/jogger: a kept conversation's jogger (D99). */
export interface JoggerResponse {
  id: number
  startedAt: number
  endedAt: number
  /** The names caught, for the header with the length (D99). */
  names: string[]
  /** One flat list, in the order things came up; technical terms set off as `**term**`. */
  bullets: string[]
}
