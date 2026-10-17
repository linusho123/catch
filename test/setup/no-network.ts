import { Socket as UdpSocket } from 'node:dgram'
import { isIPv4, Socket } from 'node:net'

// Every Vitest project loads this first. A test may open sockets on loopback
// (the harness's server, stand-ins) and nothing else: every TCP connection
// (fetch, WebSocket, ws, http, tls) goes through Socket.prototype.connect, and
// every UDP datagram through dgram's Socket#send or Socket#connect (M3); a
// non-loopback host there fails the socket with an error naming the host,
// which surfaces as the caller's own failure (fetch rejects, a WebSocket emits
// 'error', a UDP send calls back with it), never as a silent hang.
// CATCH_REAL_STT=1 or CATCH_REAL_LLM=1, set by hand to reach the real provider
// or re-record cassettes, lifts the guard.

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

/** Loopback only: the names above, or an IPv4 address in 127/8 (never a DNS name that merely starts with "127.", M2). */
export function isLoopback(host: string | undefined): boolean {
  return host === undefined || LOOPBACK.has(host) || (isIPv4(host) && host.startsWith('127.'))
}

function targetOf(args: unknown[]): { host?: string; path?: string } {
  // net.connect hands connect() its normalized [options, callback] array.
  const first = Array.isArray(args[0]) ? args[0][0] : args[0]
  if (typeof first === 'object' && first !== null) return first as { host?: string; path?: string }
  if (typeof first === 'string' && !/^\d+$/.test(first)) return { path: first }
  return { host: typeof args[1] === 'string' ? args[1] : undefined }
}

/**
 * The address of a dgram send, read the way Node reads it: send(msg, offset,
 * length, port, address, cb) when a port or address follows the length, else
 * send(msg, port, address, cb). No address means loopback (or the address a
 * guarded connect() already allowed).
 */
function udpTargetOf(args: unknown[]): string | undefined {
  const [, , length, port, address] = args
  if (address || (port && typeof port !== 'function')) return typeof address === 'string' ? address : undefined
  return typeof length === 'string' ? length : undefined
}

const refusal = (host: string | undefined) =>
  new Error(`a test tried to reach ${host} over the network; the lanes never do (CATCH_REAL_STT=1 or CATCH_REAL_LLM=1 by hand only)`)

if (process.env.CATCH_REAL_STT !== '1' && process.env.CATCH_REAL_LLM !== '1') {
  const connect = Socket.prototype.connect as (...args: unknown[]) => Socket
  Socket.prototype.connect = function guarded(this: Socket, ...args: unknown[]) {
    const { host, path } = targetOf(args)
    if (path === undefined && !isLoopback(host)) {
      const err = refusal(host)
      process.nextTick(() => this.destroy(err))
      return this
    }
    return connect.apply(this, args)
  } as typeof Socket.prototype.connect

  const send = UdpSocket.prototype.send as (...args: unknown[]) => void
  UdpSocket.prototype.send = function guardedSend(this: UdpSocket, ...args: unknown[]) {
    const host = udpTargetOf(args)
    if (!isLoopback(host)) {
      const err = refusal(host)
      const callback = args.at(-1)
      process.nextTick(() => (typeof callback === 'function' ? callback(err) : this.emit('error', err)))
      return
    }
    send.apply(this, args)
  } as typeof UdpSocket.prototype.send

  const udpConnect = UdpSocket.prototype.connect as (...args: unknown[]) => void
  UdpSocket.prototype.connect = function guardedConnect(this: UdpSocket, ...args: unknown[]) {
    const host = typeof args[1] === 'string' ? args[1] : undefined
    if (!isLoopback(host)) {
      const err = refusal(host)
      process.nextTick(() => this.emit('error', err))
      return
    }
    udpConnect.apply(this, args)
  } as typeof UdpSocket.prototype.connect
}
