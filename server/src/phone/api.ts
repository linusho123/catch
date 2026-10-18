import { createHash, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { PHONE_CONVERSATION_PATH, PHONE_HISTORY_PATH, PHONE_JOGGER_SUFFIX } from '../../../shared/phone-protocol.ts'
import type { History } from './history.ts'

// The phone API (D130): the plugin's phone page reads the history (D100), one
// conversation's screen (D98) and a kept conversation's jogger (D99) from here. Read-only: GET only, nothing
// written. It takes the same shared token as /audio (CATCH_AUDIO_TOKEN), as
// `Authorization: Bearer <token>` (a fetch can set headers, unlike a browser
// WebSocket), and answers only with the conversations of the wearer that
// token stands for (D79).

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
  opts: { history: History; expected: readonly Buffer[]; headers: Record<string, string> },
): boolean {
  const path = new URL(req.url ?? '/', 'http://localhost').pathname
  if (path !== PHONE_HISTORY_PATH && !path.startsWith(PHONE_CONVERSATION_PATH)) return false
  const json = (status: number, body: unknown) => {
    res.writeHead(status, { ...opts.headers, 'content-type': 'application/json', 'cache-control': 'no-store' })
    res.end(JSON.stringify(body))
  }
  if (req.method !== 'GET') {
    res.writeHead(405, { ...opts.headers, allow: 'GET' }).end()
    return true
  }
  const token = bearer(req)
  if (token === undefined || !opts.expected.some((e) => timingSafeEqual(Buffer.from(wearerOf(token), 'hex'), e))) {
    json(401, { error: 'the shared token is missing or wrong' })
    return true
  }
  const wearer = wearerOf(token)
  if (path === PHONE_HISTORY_PATH) {
    json(200, opts.history.list(wearer))
    return true
  }
  const rest = path.slice(PHONE_CONVERSATION_PATH.length)
  const jogger = rest.endsWith(PHONE_JOGGER_SUFFIX)
  const id = jogger ? rest.slice(0, -PHONE_JOGGER_SUFFIX.length) : rest
  if (!/^\d+$/.test(id)) {
    json(404, { error: 'no such conversation' })
    return true
  }
  const found = jogger ? opts.history.jogger(wearer, Number(id)) : opts.history.conversation(wearer, Number(id))
  if (found) json(200, found)
  else json(404, { error: jogger ? 'no jogger for that conversation' : 'no such conversation' })
  return true
}
