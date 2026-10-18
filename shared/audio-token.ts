// How the shared token reaches /audio (PH): as a WebSocket subprotocol, never
// in the URL, where it would sit in the address bar's history, in proxy and
// access logs and in any error that quotes the address. A browser WebSocket
// cannot set headers, but it can offer subprotocols, which travel in the
// handshake's Sec-WebSocket-Protocol header. A subprotocol must be an HTTP
// token (RFC 6455 section 4.1, RFC 7230 tchar), and the token is any string
// (the operator's is `openssl rand -base64 32`, with + / and = in it), so it
// is carried as `catch.` and the base64url of its UTF-8 bytes, unpadded.
//
// The lens offers two: `catch`, which the server echoes (a browser fails a
// handshake whose answer names none of the protocols it offered), and the
// token's. The server's answer so never carries the token. The phone page's
// fetch can set headers, so the phone API keeps `Authorization: Bearer`.
// Shared by the lens (a browser) and the server (Node): it uses only
// TextEncoder, TextDecoder, btoa and atob, which both have.

/** The plain subprotocol the lens offers and the server echoes. */
export const AUDIO_PROTOCOL = 'catch'

/** The prefix of the subprotocol that carries the token. */
export const TOKEN_PROTOCOL_PREFIX = 'catch.'

const BASE64URL = /^[A-Za-z0-9_-]*$/

/** The subprotocol that carries `token`: `catch.` and its base64url. */
export function tokenProtocol(token: string): string {
  let binary = ''
  for (const byte of new TextEncoder().encode(token)) binary += String.fromCharCode(byte)
  return TOKEN_PROTOCOL_PREFIX + btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** What the lens offers when it opens /audio: the plain protocol first, then the token's. */
export function audioProtocols(token: string): [string, string] {
  return [AUDIO_PROTOCOL, tokenProtocol(token)]
}

/** The token one subprotocol carries, or undefined when it carries none it can read. */
export function tokenFromProtocol(protocol: string): string | undefined {
  if (!protocol.startsWith(TOKEN_PROTOCOL_PREFIX)) return undefined
  const encoded = protocol.slice(TOKEN_PROTOCOL_PREFIX.length)
  // Only what tokenProtocol writes: base64url, unpadded, of a length an encoding can have.
  if (!BASE64URL.test(encoded) || encoded.length % 4 === 1) return undefined
  try {
    const binary = atob(encoded.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (encoded.length % 4)) % 4))
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return undefined
  }
}

/** Every token a Sec-WebSocket-Protocol header offers, in order; anything that is not a readable token protocol is skipped. */
export function offeredTokens(header: string | undefined): string[] {
  if (!header) return []
  const tokens: string[] = []
  for (const protocol of header.split(',')) {
    const token = tokenFromProtocol(protocol.trim())
    if (token !== undefined) tokens.push(token)
  }
  return tokens
}
