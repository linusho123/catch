import { waitForEvenAppBridge } from '@evenrealities/even_hub_sdk'
import { boot } from './boot.ts'
import { startLens } from './lens.ts'
import { startPhone } from './phone.ts'

// The lens's entry in the Even app's WebView: the real bridge, the hosted
// server, the phone page (phone.ts: the history and the conversation screens,
// D130) and the phone-side status line. The lens itself is lens.ts; boot.ts
// starts it only where the Even app (or the simulator) has put its bridge on
// the page, so the page opened in a plain browser tab is the phone page alone
// and never takes the wearer's /audio session (operator, P5).
//
// The server origin is the ws(s) one whitelisted in app.json; the phone page
// reaches its https twin, whitelisted beside it. VITE_CATCH_SERVER may
// point a local build elsewhere, but never ships in app.json.

const SERVER = (import.meta.env.VITE_CATCH_SERVER as string | undefined) ?? 'wss://catch-g2.fly.dev'
// The shared token /audio requires (the server's CATCH_AUDIO_TOKEN), built in
// from VITE_CATCH_TOKEN in an untracked .env; never committed.
const TOKEN = (import.meta.env.VITE_CATCH_TOKEN as string | undefined) ?? ''

const { phone, lens } = await boot({
  window,
  phoneRoot: document.querySelector<HTMLDivElement>('#phone'),
  status: document.querySelector<HTMLDivElement>('#status'),
  server: SERVER,
  token: TOKEN,
  startPhone,
  startLens,
  waitForBridge: waitForEvenAppBridge,
})

// Back on the page (a conversation may have ended meanwhile): the screen the
// wearer was on, drawn again from the server, never the history in its place.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void phone?.refresh()
})

if (lens) window.addEventListener('beforeunload', () => void lens.stop())
