import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { AUDIO_PROTOCOL, audioProtocols, offeredTokens, TOKEN_PROTOCOL_PREFIX, tokenFromProtocol, tokenProtocol } from './audio-token.ts'

// PH (a): the shared token travels as a WebSocket subprotocol, never in the
// URL. A subprotocol must be an HTTP token (RFC 6455, RFC 7230 tchar), so the
// token is carried base64url-encoded behind `catch.`; the operator's rotated
// token (openssl rand -base64 32) has + / = in it, and must come back whole.

/** RFC 7230 tchar: what one Sec-WebSocket-Protocol value may be made of. */
const HTTP_TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/

describe('the shared token as a WebSocket subprotocol (PH)', () => {
  it.each([
    ['an openssl rand -base64 32 value, with + / and =', 'q+3/Zk9xP0aB7cD/Ee+FfGgHh1Ii2Jj3Kk4Ll5Mm6N0='],
    ['plain base64 padding', 'ab=='],
    ['only the characters an HTTP token refuses', '+/=,; "'],
    ['a value that is not ASCII', 'tökén-✓'],
    ['the throwaway test tokens', 'test-token-not-a-secret'],
  ])('round-trips %s, through a value that is an HTTP token', (_what, token) => {
    const protocol = tokenProtocol(token)
    expect(protocol.startsWith(TOKEN_PROTOCOL_PREFIX)).toBe(true)
    expect(protocol).toMatch(HTTP_TOKEN)
    expect(protocol).not.toContain(token)
    expect(tokenFromProtocol(protocol)).toBe(token)
  })

  it('round-trips a hundred random base64 tokens of the rotated length', () => {
    for (let i = 0; i < 100; i++) {
      const token = randomBytes(32).toString('base64')
      const protocol = tokenProtocol(token)
      expect(protocol).toMatch(HTTP_TOKEN)
      expect(tokenFromProtocol(protocol)).toBe(token)
    }
  })

  it('offers a plain protocol first, for the server to echo, and the token protocol after it', () => {
    expect(audioProtocols('s3cret')).toEqual([AUDIO_PROTOCOL, tokenProtocol('s3cret')])
    expect(AUDIO_PROTOCOL).toMatch(HTTP_TOKEN)
    expect(AUDIO_PROTOCOL.startsWith(TOKEN_PROTOCOL_PREFIX)).toBe(false)
  })

  it('reads the tokens out of a Sec-WebSocket-Protocol header, skipping anything it cannot decode', () => {
    const a = tokenProtocol('first+/=')
    const b = tokenProtocol('second')
    expect(offeredTokens(`${AUDIO_PROTOCOL}, ${a},${b}`)).toEqual(['first+/=', 'second'])
    expect(offeredTokens(undefined)).toEqual([])
    expect(offeredTokens('')).toEqual([])
    expect(offeredTokens(AUDIO_PROTOCOL)).toEqual([])
    // Not base64url, a length no encoding gives, not UTF-8: none of them is a token.
    expect(tokenFromProtocol('catch.ab+c')).toBeUndefined()
    expect(tokenFromProtocol('catch.abcde')).toBeUndefined()
    expect(tokenFromProtocol('catch.__8')).toBeUndefined()
    expect(tokenFromProtocol('other.YWI')).toBeUndefined()
    expect(offeredTokens('catch.ab+c, catch.abcde, other')).toEqual([])
  })
})
