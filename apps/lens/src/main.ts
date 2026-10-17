import { waitForEvenAppBridge } from '@evenrealities/even_hub_sdk'
import { startLens } from './lens.ts'

// The lens's entry in the Even app's WebView: the real bridge, the hosted
// server, and the phone-side status line. The lens itself is lens.ts.
//
// The server origin is the one whitelisted in app.json. VITE_CATCH_SERVER may
// point a local build elsewhere, but never ships in app.json.

const SERVER = (import.meta.env.VITE_CATCH_SERVER as string | undefined) ?? 'wss://catch-g2.fly.dev'
// The shared token /audio requires (the server's CATCH_AUDIO_TOKEN), built in
// from VITE_CATCH_TOKEN in an untracked .env; never committed.
const TOKEN = (import.meta.env.VITE_CATCH_TOKEN as string | undefined) ?? ''

const status = document.querySelector<HTMLDivElement>('#status')

const lens = await startLens({
  bridge: await waitForEvenAppBridge(),
  server: SERVER,
  token: TOKEN,
  onStatus: (text) => {
    if (status) status.textContent = text
  },
})

window.addEventListener('beforeunload', () => void lens.stop())
