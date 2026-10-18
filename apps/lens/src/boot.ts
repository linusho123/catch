import type { EvenAppBridge } from '@evenrealities/even_hub_sdk'
import type { Lens, LensOptions } from './lens.ts'
import type { Phone, PhoneOptions } from './phone.ts'

// How the plugin's page starts (main.ts hands it the real pieces): the phone
// page first, which needs only the server; then the lens, but only where an
// Even host has put its bridge on the page. The Even app's WebView and the
// simulator both inject `window.flutter_inappwebview`, the handler every SDK
// call is posted to (the simulator's own script says so:
// `window.flutter_inappwebview = flutterBridge`). A plain browser tab has
// none: the SDK's waitForEvenAppBridge resolves there all the same, and a lens
// started in it opened /audio with the wearer's token, so the server gave the
// wearer's session to that tab (one wearer per account, D79) and the
// simulator's lens lost its audio and its dot (operator, P5). With no bridge
// the page is the phone page only and never opens /audio.

/** How long the page waits for a host that injects its bridge late, before it decides there is none. */
export const BRIDGE_WAIT_MS = 1500

export interface BootOptions {
  /** The page's window: the Even host's bridge is `flutter_inappwebview` on it. */
  window: object
  phoneRoot: PhoneOptions['root'] | null
  /** The phone-side status line. */
  status: { textContent: string | null } | null
  server: string
  token: string
  startPhone: (opts: PhoneOptions) => Phone
  startLens: (opts: LensOptions) => Promise<Lens>
  waitForBridge: () => Promise<EvenAppBridge>
  bridgeWaitMs?: number
}

export interface Booted {
  phone: Phone | undefined
  /** Undefined on a page with no Even bridge: no lens, no /audio. */
  lens: Lens | undefined
}

const present = (win: object) => {
  const host = (win as { flutter_inappwebview?: unknown }).flutter_inappwebview
  return typeof host === 'object' && host !== null
}

/** Whether an Even host has put its bridge on `win`, now or within `ms`. */
export async function hasEvenBridge(win: object, ms = BRIDGE_WAIT_MS): Promise<boolean> {
  for (let waited = 0; !present(win); waited += 25) {
    if (waited >= ms) return false
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  return true
}

export const NO_BRIDGE_STATUS = 'No Even bridge on this page: the phone page only. The glasses run in the Even app or the simulator.'

export async function boot(opts: BootOptions): Promise<Booted> {
  const setStatus = (text: string) => {
    if (opts.status) opts.status.textContent = text
  }
  const phone = opts.phoneRoot ? opts.startPhone({ root: opts.phoneRoot, server: opts.server, token: opts.token }) : undefined
  void phone?.home()
  if (!(await hasEvenBridge(opts.window, opts.bridgeWaitMs))) {
    setStatus(NO_BRIDGE_STATUS)
    return { phone, lens: undefined }
  }
  const lens = await opts.startLens({ bridge: await opts.waitForBridge(), server: opts.server, token: opts.token, onStatus: setStatus })
  return { phone, lens }
}
