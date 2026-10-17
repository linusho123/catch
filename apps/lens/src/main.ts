import {
  waitForEvenAppBridge,
  TextContainerProperty,
  CreateStartUpPageContainer,
  OsEventTypeList,
} from '@evenrealities/even_hub_sdk'
import { toWireFrame } from './frames'

// Catch's lens, P0a: a blank page with one dim dot, the glasses mic streamed to
// the server as wire frames (shared/wire.ts), and double-tap to exit. Started
// from Even's `asr` template; its speech-to-text stub and API key are gone,
// because the lens never talks to a provider; the server does.
//
// The server origin is the one whitelisted in app.json. VITE_CATCH_SERVER may
// point a local build elsewhere, but never ships in app.json.

const SERVER = (import.meta.env.VITE_CATCH_SERVER as string | undefined) ?? 'wss://catch-g2.fly.dev'
// The shared token /audio requires (the server's CATCH_AUDIO_TOKEN), built in
// from VITE_CATCH_TOKEN in an untracked .env; never committed. A browser
// WebSocket cannot set headers, so it travels as a query parameter.
const TOKEN = (import.meta.env.VITE_CATCH_TOKEN as string | undefined) ?? ''

const status = document.querySelector<HTMLDivElement>('#status')
function setStatus(text: string) {
  if (status) status.textContent = text
}

const bridge = await waitForEvenAppBridge()

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
const socket = new WebSocket(`${SERVER}/audio?token=${encodeURIComponent(TOKEN)}`)
socket.binaryType = 'arraybuffer'
socket.addEventListener('open', () => {
  setStatus(`connected to ${SERVER}`)
  void bridge.audioControl(true)
})
socket.addEventListener('message', (msg) => {
  const ack = JSON.parse(String(msg.data)) as { type: string; bytes?: number }
  if (ack.type === 'ack') {
    acked += ack.bytes ?? 0
    setStatus(`connected to ${SERVER} · ${acked} bytes acknowledged`)
  }
})
socket.addEventListener('close', () => setStatus(`disconnected from ${SERVER}`))
socket.addEventListener('error', () => setStatus(`cannot reach ${SERVER}`))

function eventTypeOf(envelope?: { eventType?: OsEventTypeList }): OsEventTypeList | null {
  if (!envelope) return null
  // CLICK_EVENT is 0 and protobuf omits zero values, so a tap arrives without eventType.
  return envelope.eventType ?? OsEventTypeList.CLICK_EVENT
}

let cleanedUp = false
function cleanup() {
  if (cleanedUp) return
  cleanedUp = true
  void bridge.audioControl(false)
  socket.close()
  unsubscribe()
}

const unsubscribe = bridge.onEvenHubEvent((event) => {
  const audio = event.audioEvent
  if (audio?.audioPcm && socket.readyState === WebSocket.OPEN) {
    socket.send(toWireFrame(audio, seq++, Date.now()))
  }

  const sysType = eventTypeOf(event.sysEvent)
  const textType = eventTypeOf(event.textEvent)
  // Double-tap is Even's exit, checked at the root so it always works.
  if (sysType === OsEventTypeList.DOUBLE_CLICK_EVENT || textType === OsEventTypeList.DOUBLE_CLICK_EVENT) {
    void bridge.shutDownPageContainer(1)
    return
  }
  if (sysType === OsEventTypeList.SYSTEM_EXIT_EVENT || sysType === OsEventTypeList.ABNORMAL_EXIT_EVENT) {
    cleanup()
  }
})

window.addEventListener('beforeunload', cleanup)
