import { Socket } from 'node:net'

// Every Vitest project loads this first. A test may open sockets on loopback
// (the harness's server, stand-ins) and nothing else: every TCP connection
// (fetch, WebSocket, ws, http, tls) goes through Socket.prototype.connect, and
// a non-loopback host there fails the socket with an error naming the host,
// which surfaces as the caller's own failure (fetch rejects, a WebSocket emits
// 'error'), never as a silent hang. CATCH_REAL_STT=1 or CATCH_REAL_LLM=1, set
// by hand to reach the real provider or re-record cassettes, lifts the guard.

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

export function isLoopback(host: string | undefined): boolean {
  return host === undefined || LOOPBACK.has(host) || host.startsWith('127.')
}

function targetOf(args: unknown[]): { host?: string; path?: string } {
  // net.connect hands connect() its normalized [options, callback] array.
  const first = Array.isArray(args[0]) ? args[0][0] : args[0]
  if (typeof first === 'object' && first !== null) return first as { host?: string; path?: string }
  if (typeof first === 'string' && !/^\d+$/.test(first)) return { path: first }
  return { host: typeof args[1] === 'string' ? args[1] : undefined }
}

if (process.env.CATCH_REAL_STT !== '1' && process.env.CATCH_REAL_LLM !== '1') {
  const connect = Socket.prototype.connect as (...args: unknown[]) => Socket
  Socket.prototype.connect = function guarded(this: Socket, ...args: unknown[]) {
    const { host, path } = targetOf(args)
    if (path === undefined && !isLoopback(host)) {
      const err = new Error(`a test tried to reach ${host} over the network; the lanes never do (CATCH_REAL_STT=1 or CATCH_REAL_LLM=1 by hand only)`)
      process.nextTick(() => this.destroy(err))
      return this
    }
    return connect.apply(this, args)
  } as typeof Socket.prototype.connect
}
