// What the server's phone API answers the plugin's phone page (D130): the
// history (D100) and one conversation's screen (D98), read with GETs over the
// store, and two writes, a promise ticked off (D39, D133, P7) and a
// conversation deleted (D134), all behind the
// same shared token as /audio, sent as `Authorization: Bearer <token>`. No runtime imports, so the browser bundle
// and Node load it as is. Times are milliseconds on the server's clock, like
// Date.now(); the page groups and formats them in the phone's own time zone.
//
// Filled in by the phases that make what it carries: the wearer's promises
// (`you`) in P2a, the keep (`kept`) and the jogger in P4, the promises owed to
// the wearer (`owed`) in P5, and `done` by a tick on the phone page (P7, D133).

export const PHONE_HISTORY_PATH = '/phone/history'
/** POST: ends the wearer's open conversation now, as a long-press does (D52); the Even OS keeps long-press on the real G2. Answers `{ ended }`. */
export const PHONE_END_PATH = '/phone/end'
/**
 * GET /phone/conversations/<id>: the conversation's screen.
 * DELETE /phone/conversations/<id>: deletes it, everything with it (D134),
 * and answers the history as it now stands (a HistoryResponse). Idempotent:
 * one already deleted answers the same and changes nothing. Another wearer's
 * is answered 404 and never touched.
 */
export const PHONE_CONVERSATION_PATH = '/phone/conversations/'
/** GET /phone/conversations/<id>/jogger: a kept conversation's jogger (D99). */
export const PHONE_JOGGER_SUFFIX = '/jogger'
/** POST `{ name }` to a conversation's path plus this: a name added by hand (D135). */
export const PHONE_NAMES_SUFFIX = '/names'
/** POST `{ side: 'you' | 'owed', text }` to a conversation's path plus this: a promise added by hand (D135). */
export const PHONE_PROMISES_SUFFIX = '/promises'
/** The longest name or promise a hand can add. */
export const MAX_ADDED_LENGTH = 300
/**
 * PUT /phone/promises/<id>/done: ticks one of the wearer's promises off (D39),
 * YOU or OWED TO YOU, and answers that conversation's screen as it now stands
 * (a ConversationResponse). Idempotent: a promise already ticked answers the
 * same, and nothing ever unticks one. A promise that is not the token's
 * wearer's is answered 404, like one that does not exist.
 */
export const PHONE_PROMISE_PATH = '/phone/promises/'
export const PHONE_DONE_SUFFIX = '/done'

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
