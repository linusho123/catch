import type { Clock } from '../../shared/clock.ts'

// The Even bridge stub. It is not a fake bridge: the lens runs on the real
// `@evenrealities/even_hub_sdk`, and this module plays the Even app on the
// other side of it, the `flutter_inappwebview` handler every SDK call is
// posted to. So each recorded payload is exactly what the SDK would send the
// glasses (container ids, text, brightness as `textColor`, 0..4), stamped
// with the fixture clock, and nothing the lens does reaches the glasses
// except through it. Events (audio, taps) go the other way through the SDK's
// own `_listenEvenAppMessage`.
//
// The SDK binds to `window` when it is first imported, so this module installs
// the stand-in at import time and loads the SDK (and the lens) only after.
// Import it before anything that imports the SDK.

export const DISPLAY_METHODS = [
  'createStartUpPageContainer',
  'rebuildPageContainer',
  'textContainerUpgrade',
  'shutDownPageContainer',
] as const
export type DisplayMethod = (typeof DISPLAY_METHODS)[number]

export interface BridgeCall {
  /** The fixture clock when the SDK posted the call (ms). */
  at: number
  method: string
  data: Record<string, unknown>
}

export interface Payload extends BridgeCall {
  method: DisplayMethod
}

/** One text container as the glasses were told to draw it. */
export interface TextLine {
  containerID: number
  containerName: string
  content: string
  /** The SDK's `textColor`: the firmware's text brightness, 0..4. Absent when the payload set none. */
  brightness: number | undefined
}

export type SpeakerRoleName = 'self' | 'other' | 'unknown'

interface HostWindow {
  flutter_inappwebview: { callHandler(name: string, message: string): Promise<unknown> }
  _listenEvenAppMessage?: (message: unknown) => void
}

class EvenHost {
  readonly calls: BridgeCall[] = []
  clock: Clock | undefined

  /** Every page and text payload sent for the glasses, in order. */
  payloads(): Payload[] {
    return this.calls.filter((c): c is Payload => (DISPLAY_METHODS as readonly string[]).includes(c.method))
  }

  lastPayload(): Payload | undefined {
    return this.payloads().at(-1)
  }

  /** Clears the record for the next scenario. */
  reset(clock: Clock): void {
    this.calls.length = 0
    this.clock = clock
  }

  /** The Even app pushing an EvenHub event (audio, a tap, a system event) to the plugin. */
  push(type: 'audioEvent' | 'textEvent' | 'sysEvent', jsonData: Record<string, unknown>): void {
    const listen = (globalThis.window as unknown as HostWindow)._listenEvenAppMessage
    if (!listen) throw new Error('the Even SDK has not bound to the stand-in host: import test/harness/even-host.ts before the SDK')
    listen({ type: 'listen_even_app_data', method: 'evenHubEvent', data: { type, jsonData } })
  }

  /**
   * When the frame being pushed now was captured (fixture ms), while its push
   * is handled: `captureClock` reads it, so the lens stamps the frame with the
   * moment the glasses heard it, not with however late a loaded machine got
   * round to the push. The SDK hands the event to the lens synchronously.
   */
  private capturing: number | undefined

  /**
   * One 100 ms glasses audio frame, as the Even app delivers it. `captureMs`
   * is when it was captured (the player gives the frame's end on the fixture
   * clock); without it the lens stamps it with the clock as it handles the push.
   */
  pushAudio(pcm: Uint8Array, speakerRole: SpeakerRoleName = 'unknown', direction: number | null = null, captureMs?: number): void {
    this.capturing = captureMs
    try {
      this.push('audioEvent', { audioPcm: Array.from(pcm), speakerRole, direction })
    } finally {
      this.capturing = undefined
    }
  }

  /** The lens's capture clock: a frame's own capture time while it is being pushed, the fixture clock otherwise. */
  captureClock(clock: Clock): () => number {
    return () => this.capturing ?? clock.now()
  }

  receive(message: string): unknown {
    const { method, data } = JSON.parse(message) as { method: string; data?: Record<string, unknown> }
    this.calls.push({ at: this.clock?.now() ?? Number.NaN, method, data: data ?? {} })
    // createStartUpPageContainer answers a StartUpPageCreateResult; 0 is success.
    return method === 'createStartUpPageContainer' ? 0 : true
  }
}

/** The text containers a page or text payload sets, with their brightness. */
export function textLines(payload: Payload): TextLine[] {
  const objects =
    payload.method === 'textContainerUpgrade'
      ? [payload.data]
      : ((payload.data.textObject as Record<string, unknown>[] | undefined) ?? [])
  return objects.map((o) => ({
    containerID: o.containerID as number,
    containerName: o.containerName as string,
    content: o.content as string,
    brightness: o.textColor as number | undefined,
  }))
}

export const host = new EvenHost()

const target = new EventTarget()
const hostWindow: HostWindow & Pick<EventTarget, 'addEventListener' | 'removeEventListener' | 'dispatchEvent'> = {
  addEventListener: target.addEventListener.bind(target),
  removeEventListener: target.removeEventListener.bind(target),
  dispatchEvent: target.dispatchEvent.bind(target),
  flutter_inappwebview: { callHandler: async (_name: string, message: string) => host.receive(message) },
}
Object.assign(globalThis, {
  // The SDK also reaches for the timers on `window`; those are Node's own.
  window: Object.assign(Object.create(globalThis) as object, hostWindow),
  document: { readyState: 'complete', addEventListener() {}, removeEventListener() {}, querySelector: () => null },
})

// The SDK logs every event it relays; at ten audio frames a fixture second that drowns the run.
for (const level of ['log', 'info', 'debug'] as const) {
  const original = console[level].bind(console)
  console[level] = (...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].startsWith('[EvenAppBridge]')) return
    original(...args)
  }
}

export async function evenBridge() {
  const { waitForEvenAppBridge } = await import('@evenrealities/even_hub_sdk')
  return waitForEvenAppBridge()
}
