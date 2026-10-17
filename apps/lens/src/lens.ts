import {
  TextContainerProperty,
  CreateStartUpPageContainer,
  OsEventTypeList,
  type EvenAppBridge,
} from '@evenrealities/even_hub_sdk'
import { toWireFrame } from './frames.ts'

// Catch's lens, P0a: a blank page with one dim dot, the glasses mic streamed to
// the server as wire frames (shared/wire.ts), and double-tap to exit. Started
// from Even's `asr` template; its speech-to-text stub and API key are gone,
// because the lens never talks to a provider; the server does.
//
// The bridge is passed in: main.ts hands it the Even app's, and the test
// harness hands it the same SDK talking to a recording stand-in for the Even
// app (test/harness/even-host.ts). Everything the glasses show goes through the
// bridge; the lens never draws glasses output any other way.

export interface LensOptions {
  bridge: EvenAppBridge
  /** The server origin, e.g. wss://catch-g2.fly.dev. */
  server: string
  /** The shared token /audio requires; it travels as `?token=` (a browser WebSocket cannot set headers). */
  token: string
  /** The capture clock for each frame's header. */
  now?: () => number
  /** The phone-side status line (a debugging aid on the phone, never the glasses). */
  onStatus?: (text: string) => void
}

export interface Lens {
  /** Settles when /audio opens; rejects, loudly, when the server cannot be reached. */
  readonly connected: Promise<void>
  /** Closes the microphone and the socket; settles once the socket has closed. */
  stop(): Promise<void>
}

function eventTypeOf(envelope?: { eventType?: OsEventTypeList }): OsEventTypeList | null {
  if (!envelope) return null
  // CLICK_EVENT is 0 and protobuf omits zero values, so a tap arrives without eventType.
  return envelope.eventType ?? OsEventTypeList.CLICK_EVENT
}

export async function startLens(opts: LensOptions): Promise<Lens> {
  const { bridge, server } = opts
  const now = opts.now ?? Date.now
  const setStatus = opts.onStatus ?? (() => {})

  // The dot: top right, at the lowest readable brightness. Not yet bound (P1a binds it).
  const dot = new TextContainerProperty({
    xPosition: 536,
    yPosition: 0,
    width: 40,
    height: 40,
    borderWidth: 0,
    paddingLength: 0,
    containerID: 1,
    containerName: 'dot',
    content: '•',
    textColor: 1,
    isEventCapture: 1,
  })
  await bridge.createStartUpPageContainer(new CreateStartUpPageContainer({ containerTotalNum: 1, textObject: [dot] }))

  let seq = 0
  let acked = 0
  const socket = new WebSocket(`${server}/audio?token=${encodeURIComponent(opts.token)}`)
  socket.binaryType = 'arraybuffer'
  const connected = new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve())
    socket.addEventListener('close', () => reject(new Error(`the lens could not open ${server}/audio`)))
  })
  connected.catch(() => {})
  socket.addEventListener('open', () => {
    setStatus(`connected to ${server}`)
    void bridge.audioControl(true)
  })
  socket.addEventListener('message', (msg) => {
    const ack = JSON.parse(String(msg.data)) as { type: string; bytes?: number }
    if (ack.type === 'ack') {
      acked += ack.bytes ?? 0
      setStatus(`connected to ${server} · ${acked} bytes acknowledged`)
    }
  })
  socket.addEventListener('close', () => setStatus(`disconnected from ${server}`))
  socket.addEventListener('error', () => setStatus(`cannot reach ${server}`))

  const closed = new Promise<void>((resolve) => socket.addEventListener('close', () => resolve()))
  let stopped = false
  function stop(): Promise<void> {
    if (!stopped) {
      stopped = true
      void bridge.audioControl(false)
      socket.close()
      unsubscribe()
    }
    return closed
  }

  const unsubscribe = bridge.onEvenHubEvent((event) => {
    const audio = event.audioEvent
    if (audio?.audioPcm && socket.readyState === WebSocket.OPEN) {
      socket.send(toWireFrame(audio, seq++, now()))
    }

    const sysType = eventTypeOf(event.sysEvent)
    const textType = eventTypeOf(event.textEvent)
    // Double-tap is Even's exit, checked at the root so it always works.
    if (sysType === OsEventTypeList.DOUBLE_CLICK_EVENT || textType === OsEventTypeList.DOUBLE_CLICK_EVENT) {
      void bridge.shutDownPageContainer(1)
      return
    }
    if (sysType === OsEventTypeList.SYSTEM_EXIT_EVENT || sysType === OsEventTypeList.ABNORMAL_EXIT_EVENT) {
      void stop()
    }
  })

  return { connected, stop }
}
