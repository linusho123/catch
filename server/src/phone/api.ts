import { createHash, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { PHONE_CONVERSATION_PATH, PHONE_DONE_SUFFIX, PHONE_HISTORY_PATH, PHONE_JOGGER_SUFFIX, PHONE_PROMISE_PATH } from '../../../shared/phone-protocol.ts'
import type { DeleteOutcome, History } from './history.ts'

// The phone API (D130): the plugin's phone page reads the history (D100), one
// conversation's screen (D98) and a kept conversation's jogger (D99) from here,
// with GETs, and makes two writes: it ticks a promise off (D39, D133, P7) with
// `PUT /phone/promises/<id>/done`, idempotent: a second tick of the same
// promise answers the same and changes nothing; and it deletes a conversation
// (D134) with `DELETE /phone/conversations/<id>`, which answers the history as
// it now stands, idempotent too: a conversation already deleted is a quiet
// success, and so is another wearer's, which is never touched. It takes the
// same shared token as /audio (CATCH_AUDIO_TOKEN), as `Authorization: Bearer
// <token>` (a fetch can set headers, unlike a browser WebSocket), and reads and
// writes only the conversations of the wearer that token stands for (D79):
// another wearer's promise or conversation is answered 404 to a read or a tick
// and is never touched.

/** The wearer a shared token stands for: the key the server files sessions and conversations under. */
export function wearerOf(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function bearer(req: IncomingMessage): string | undefined {
  const header = req.headers.authorization
  const match = header?.match(/^Bearer (.+)$/)
  return match?.[1]
}

/**
 * Answers a request if it is the phone API's; returns false for any other path.
 * `expected` is the digest of each account's shared token (D79).
 */
export function phoneRoute(
  req: IncomingMessage,
  res: ServerResponse,
  opts: {
    history: History
    expected: readonly Buffer[]
    headers: Record<string, string>
    /** Deletes one of the wearer's conversations, everything with it (D134, app.ts). */
    remove: (wearer: string, id: number) => DeleteOutcome
  },
): boolean {
  const path = new URL(req.url ?? '/', 'http://localhost').pathname
  const tick = path.startsWith(PHONE_PROMISE_PATH)
  if (path !== PHONE_HISTORY_PATH && !path.startsWith(PHONE_CONVERSATION_PATH) && !tick) return false
  const json = (status: number, body: unknown) => {
    res.writeHead(status, { ...opts.headers, 'content-type': 'application/json', 'cache-control': 'no-store' })
    res.end(JSON.stringify(body))
  }
  const rest = path.slice(PHONE_CONVERSATION_PATH.length)
  const jogger = !tick && path.startsWith(PHONE_CONVERSATION_PATH) && rest.endsWith(PHONE_JOGGER_SUFFIX)
  // A conversation's screen is also where it is deleted (D134); the history and the jogger are read only.
  const allowed = tick ? ['PUT'] : path.startsWith(PHONE_CONVERSATION_PATH) && !jogger ? ['GET', 'DELETE'] : ['GET']
  if (!allowed.includes(req.method ?? '')) {
    res.writeHead(405, { ...opts.headers, allow: allowed.join(', ') }).end()
    return true
  }
  const token = bearer(req)
  if (token === undefined || !opts.expected.some((e) => timingSafeEqual(Buffer.from(wearerOf(token), 'hex'), e))) {
    json(401, { error: 'the shared token is missing or wrong' })
    return true
  }
  const wearer = wearerOf(token)
  if (tick) {
    const promise = path.slice(PHONE_PROMISE_PATH.length)
    const id = promise.endsWith(PHONE_DONE_SUFFIX) ? promise.slice(0, -PHONE_DONE_SUFFIX.length) : ''
    const screen = /^\d+$/.test(id) ? opts.history.tick(wearer, Number(id)) : undefined
    if (screen) json(200, screen)
    else json(404, { error: 'no such promise' })
    return true
  }
  if (path === PHONE_HISTORY_PATH) {
    json(200, opts.history.list(wearer))
    return true
  }
  const id = jogger ? rest.slice(0, -PHONE_JOGGER_SUFFIX.length) : rest
  if (!/^\d+$/.test(id)) {
    json(404, { error: 'no such conversation' })
    return true
  }
  if (req.method === 'DELETE') {
    // Another wearer's conversation is refused and untouched, but answered as a missing one is (answer 1):
    // a second token cannot learn from a delete which conversation numbers exist.
    opts.remove(wearer, Number(id))
    json(200, opts.history.list(wearer))
    return true
  }
  const found = jogger ? opts.history.jogger(wearer, Number(id)) : opts.history.conversation(wearer, Number(id))
  if (found) json(200, found)
  else json(404, { error: jogger ? 'no jogger for that conversation' : 'no such conversation' })
  return true
}
