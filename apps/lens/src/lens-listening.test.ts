import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EvenAppBridge, EvenHubEvent } from '@evenrealities/even_hub_sdk'
import { RECONNECT_MS, startLens, type Lens } from './lens.ts'

// The fix round's answer 3 (P6, D86): every socket the lens opens starts
// muted, and the glasses' microphone opens only when the server says to
// listen, so a lens that reconnects while the wearer has paused Catch never
// reopens the microphone and never sends a frame. The far side is the
// bridge's audioControl calls (what the SDK would tell the Even app) and
// what the socket was sent: the browser's WebSocket is replaced by one the
// test opens, answers and closes.

const sockets: ControlledSocket[] = []
const RealWebSocket = globalThis.WebSocket

class ControlledSocket extends EventTarget {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  readyState = 0
  binaryType = 'blob'
  /** The binary messages (audio frames) this socket was sent. */
  frames = 0
  constructor(_url: string, _protocols?: string | string[]) {
    super()
    sockets.push(this)
  }
  send(data: unknown): void {
    if (typeof data !== 'string') this.frames++
  }
  close(): void {
    if (this.readyState === 3) return
    this.readyState = 3
    this.dispatchEvent(new Event('close'))
  }
  /** The server takes the socket. */
  open(): void {
    this.readyState = 1
    this.dispatchEvent(new Event('open'))
  }
  /** The server tells the lens whether to stream the glasses' audio. */
  listening(on: boolean): void {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ type: 'listening', on }) }))
  }
}

let lens: Lens | undefined
beforeEach(() => {
  sockets.length = 0
  ;(globalThis as { WebSocket: unknown }).WebSocket = ControlledSocket
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})
afterEach(async () => {
  await lens?.stop()
  lens = undefined
  vi.useRealTimers()
  ;(globalThis as { WebSocket: unknown }).WebSocket = RealWebSocket
})

/** A bridge recording every audioControl call, with a hand on the Even app's event stream. */
function stubBridge() {
  const mic: boolean[] = []
  let push: (event: EvenHubEvent) => void = () => {}
  const bridge = {
    createStartUpPageContainer: async () => 0,
    rebuildPageContainer: async () => true,
    audioControl: async (open: boolean) => void mic.push(open),
    shutDownPageContainer: async () => true,
    onEvenHubEvent: (fn: (event: EvenHubEvent) => void) => {
      push = fn
      return () => {}
    },
  } as unknown as EvenAppBridge
  /** One 100 ms frame of glasses audio, as the Even app delivers it. */
  const audio = () => push({ audioEvent: { audioPcm: new Uint8Array(3200) } } as unknown as EvenHubEvent)
  return { bridge, mic, audio }
}

describe('a socket starts muted until the server says to listen (P6, the operator\'s answer 3)', () => {
  it('opens the microphone and sends frames only once the server says to listen', async () => {
    const { bridge, mic, audio } = stubBridge()
    lens = await startLens({ bridge, server: 'ws://catch.test', token: 't' })
    const socket = sockets[0]!
    socket.open()
    audio()
    expect(mic, 'the microphone, before the server has said anything').toEqual([])
    expect(socket.frames, 'frames sent before the server said to listen').toBe(0)
    socket.listening(true)
    expect(mic).toEqual([true])
    audio()
    expect(socket.frames).toBe(1)
  })

  it('never reopens the microphone, nor sends a frame, on a socket that reconnects while Catch is paused', async () => {
    const { bridge, mic, audio } = stubBridge()
    lens = await startLens({ bridge, server: 'ws://catch.test', token: 't' })
    const first = sockets[0]!
    first.open()
    first.listening(true)
    // The wearer swipes down: the server says to stop.
    first.listening(false)
    expect(mic).toEqual([true, false])
    // The socket drops and the lens reconnects, the pause still on.
    first.close()
    vi.advanceTimersByTime(RECONNECT_MS)
    const second = sockets[1]!
    expect(second, 'the lens reconnected').toBeDefined()
    second.open()
    audio()
    expect(mic, 'the microphone reopened as the new socket opened').toEqual([true, false])
    expect(second.frames, 'a frame sent during the pause').toBe(0)
    // A server holding the pause says so at once; the microphone stays shut.
    second.listening(false)
    audio()
    expect(mic).toEqual([true, false])
    expect(second.frames).toBe(0)
    // The resume.
    second.listening(true)
    expect(mic).toEqual([true, false, true])
    audio()
    expect(second.frames).toBe(1)
  })
})
