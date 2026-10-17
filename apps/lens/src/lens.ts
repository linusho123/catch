import {
  TextContainerProperty,
  CreateStartUpPageContainer,
  RebuildPageContainer,
  OsEventTypeList,
  type EvenAppBridge,
} from '@evenrealities/even_hub_sdk'
import type { LensMessage, LensView, ServerMessage } from '../../../shared/lens-protocol.ts'
import { toWireFrame } from './frames.ts'

// Catch's lens: the glasses mic streamed to the server as wire frames
// (shared/wire.ts), each view the server sends drawn on the glasses
// (shared/lens-protocol.ts), and the wearer's taps sent back. The lens judges
// nothing and times nothing; the server decides what shows and for how long.
// The one thing the lens decides alone is that it cannot hear: while the
// server is unreachable there is no dot (D37), and it keeps trying to reach it.
// Double-tap is Even's exit. Started from Even's `asr` template; its
// speech-to-text stub and API key are gone, because the lens never talks to a
// provider; the server does.
//
// The bridge is passed in: main.ts hands it the Even app's, and the test
// harness hands it the same SDK talking to a recording stand-in for the Even
// app (test/harness/even-host.ts). Everything the glasses show goes through the
// bridge; the lens never draws glasses output any other way.

/** The G2 canvas, in pixels. */
export const CANVAS = { width: 576, height: 288 } as const

/**
 * The lowest readable text brightness (the SDK's `textColor`, 0..4, where 0 is
 * fully dim). Every mark and every catch is drawn at it (D14).
 */
export const DIM = 1

/** How long the lens waits before trying the server again after losing it. */
export const RECONNECT_MS = 2000

export interface LensOptions {
  bridge: EvenAppBridge
  /** The server origin, e.g. wss://catch-g2.fly.dev or ws://localhost:8080. */
  server: string
  /** The shared token /audio requires; it travels as `?token=` (a browser WebSocket cannot set headers). */
  token: string
  /** The capture clock for each frame's header. */
  now?: () => number
  /** The phone-side status line (a debugging aid on the phone, never the glasses). */
  onStatus?: (text: string) => void
}

export interface Lens {
  /** Settles when /audio first opens; rejects, loudly, when the server cannot be reached. */
  readonly connected: Promise<void>
  /** Closes the microphone and the socket and stops reconnecting; settles once the socket has closed. */
  stop(): Promise<void>
}

function eventTypeOf(envelope?: { eventType?: OsEventTypeList }): OsEventTypeList | null {
  if (!envelope) return null
  // CLICK_EVENT is 0 and protobuf omits zero values, so a tap arrives without eventType.
  return envelope.eventType ?? OsEventTypeList.CLICK_EVENT
}

function text(containerID: number, containerName: string, content: string, box: { x: number; y: number; w: number; h: number }) {
  return new TextContainerProperty({
    xPosition: box.x,
    yPosition: box.y,
    width: box.w,
    height: box.h,
    borderWidth: 0,
    paddingLength: 0,
    containerID,
    containerName,
    content,
    textColor: DIM,
    // The one container on every page takes the touches, so tap and double-tap always arrive.
    isEventCapture: 1,
  })
}

/** Top right, where the dot lives; with no dot (D37) the same box stays, empty, to take the touches. */
const DOT_BOX = { x: CANVAS.width - 40, y: 0, w: 40, h: 40 }
/** The lower third (D17). */
const LINE_BOX = { x: 0, y: 208, w: CANVAS.width, h: 64 }
const PAGE_BOX = { x: 0, y: 0, w: CANVAS.width, h: CANVAS.height }

/** The names page with no names yet (D31's words; P1b finishes the page). */
export const NOTHING_HELD = 'this conversation · nothing held'

/** The containers that draw one view. Exactly one thing at a time. */
export function containersFor(view: LensView): TextContainerProperty[] {
  switch (view.kind) {
    case 'dot':
      return [text(1, 'dot', '•', DOT_BOX)]
    case 'deaf':
      return [text(1, 'blank', '', DOT_BOX)]
    case 'line':
      return [text(2, 'line', view.text, LINE_BOX)]
    case 'names':
      return [text(3, 'names', view.names.length > 0 ? view.names.join('\n') : NOTHING_HELD, PAGE_BOX)]
  }
}

export async function startLens(opts: LensOptions): Promise<Lens> {
  const { bridge, server } = opts
  const now = opts.now ?? Date.now
  const setStatus = opts.onStatus ?? (() => {})

  // Until the server says Catch can hear, there is no dot (D37).
  let drawn = JSON.stringify({ kind: 'deaf' } satisfies LensView)
  const firstPage = containersFor({ kind: 'deaf' })
  await bridge.createStartUpPageContainer(new CreateStartUpPageContainer({ containerTotalNum: firstPage.length, textObject: firstPage }))
  function draw(view: LensView): void {
    const key = JSON.stringify(view)
    if (key === drawn) return
    drawn = key
    const page = containersFor(view)
    void bridge.rebuildPageContainer(new RebuildPageContainer({ containerTotalNum: page.length, textObject: page }))
  }

  let seq = 0
  let acked = 0
  let stopped = false
  let socket: WebSocket | undefined
  let retry: ReturnType<typeof setTimeout> | undefined
  let closed: Promise<void> = Promise.resolve()

  let settleFirst: { resolve: () => void; reject: (err: Error) => void } | undefined
  const connected = new Promise<void>((resolve, reject) => (settleFirst = { resolve, reject }))
  connected.catch(() => {})

  function connect(): void {
    retry = undefined
    if (stopped) return
    const ws = new WebSocket(`${server}/audio?token=${encodeURIComponent(opts.token)}`)
    ws.binaryType = 'arraybuffer'
    socket = ws
    closed = new Promise<void>((resolve) => ws.addEventListener('close', () => resolve()))
    ws.addEventListener('open', () => {
      settleFirst?.resolve()
      settleFirst = undefined
      setStatus(`connected to ${server}`)
      void bridge.audioControl(true)
    })
    ws.addEventListener('message', (msg) => {
      const message = JSON.parse(String(msg.data)) as ServerMessage
      if (message.type === 'ack') {
        acked += message.bytes
        setStatus(`connected to ${server} · ${acked} bytes acknowledged`)
      } else if (message.type === 'show') {
        draw(message.view)
      }
    })
    ws.addEventListener('error', () => setStatus(`cannot reach ${server}`))
    ws.addEventListener('close', () => {
      settleFirst?.reject(new Error(`the lens could not open ${server}/audio`))
      settleFirst = undefined
      if (socket === ws) socket = undefined
      // Without the server Catch cannot hear: the dot goes (D37) until it answers again.
      draw({ kind: 'deaf' })
      setStatus(`disconnected from ${server}`)
      if (!stopped) retry = setTimeout(connect, RECONNECT_MS)
    })
  }
  connect()

  function sendToServer(message: LensMessage): void {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
  }

  function stop(): Promise<void> {
    if (!stopped) {
      stopped = true
      if (retry) clearTimeout(retry)
      retry = undefined
      void bridge.audioControl(false)
      socket?.close()
      unsubscribe()
    }
    return closed
  }

  const unsubscribe = bridge.onEvenHubEvent((event) => {
    const audio = event.audioEvent
    if (audio?.audioPcm && socket?.readyState === WebSocket.OPEN) {
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
      return
    }
    // A tap goes to the server, which knows what is showing and what it means there.
    if (textType === OsEventTypeList.CLICK_EVENT || sysType === OsEventTypeList.CLICK_EVENT) {
      sendToServer({ type: 'touch', gesture: 'tap' })
    }
  })

  return { connected, stop }
}
