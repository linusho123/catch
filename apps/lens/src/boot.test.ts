import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { EvenAppBridge } from '@evenrealities/even_hub_sdk'
import { AUDIO_PROTOCOL, tokenFromProtocol } from '../../../shared/audio-token.ts'
import { boot, hasEvenBridge } from './boot.ts'
import { startLens } from './lens.ts'
import type { Phone, PhoneOptions } from './phone.ts'

// The plugin's page opened where there is no Even bridge (operator, P5): the
// page served by `npm run local` at http://localhost:5173 in a plain browser
// tab, to look at the phone page. It must show the phone page and nothing
// else: a lens started there opens /audio with the wearer's token, the server
// gives the wearer's session to the newer lens (D79), and the simulator's
// lens loses its audio and its dot. The far side here is the socket: the
// browser's WebSocket is replaced by a recorder for the test, so "never opens
// /audio" is read from what was dialled, not from a flag the page keeps.

const opened: string[] = []
/** The subprotocols each socket offered, beside its URL in `opened`. */
const offered: (string | string[] | undefined)[] = []
const RealWebSocket = globalThis.WebSocket

class RecordingSocket extends EventTarget {
  static readonly OPEN = 1
  readyState = 0
  binaryType = 'blob'
  constructor(url: string, protocols?: string | string[]) {
    super()
    opened.push(url)
    offered.push(protocols)
  }
  send(): void {}
  close(): void {
    this.readyState = 3
    this.dispatchEvent(new Event('close'))
  }
}

beforeEach(() => {
  opened.length = 0
  offered.length = 0
  ;(globalThis as { WebSocket: unknown }).WebSocket = RecordingSocket
})
afterEach(() => {
  ;(globalThis as { WebSocket: unknown }).WebSocket = RealWebSocket
})

/** A bridge the lens can draw through, and how often the page asked for one. */
function stubBridge(): { wait: () => Promise<EvenAppBridge>; asked: () => number } {
  let asked = 0
  const bridge = {
    createStartUpPageContainer: async () => 0,
    rebuildPageContainer: async () => true,
    audioControl: async () => true,
    shutDownPageContainer: async () => true,
    onEvenHubEvent: () => () => {},
  } as unknown as EvenAppBridge
  return {
    wait: () => {
      asked += 1
      return Promise.resolve(bridge)
    },
    asked: () => asked,
  }
}

function phoneStub() {
  const homes: number[] = []
  const startPhone = (_opts: PhoneOptions): Phone =>
    ({ home: async () => void homes.push(1), refresh: async () => {} }) as unknown as Phone
  return { startPhone, homes }
}

const root = { innerHTML: '', addEventListener: () => {} }

describe('the plugin page with no Even bridge (a plain browser tab)', () => {
  it('shows the phone page and never opens /audio', async () => {
    const stub = stubBridge()
    const phone = phoneStub()
    const status = { textContent: '' as string | null }
    const booted = await boot({
      window: {},
      phoneRoot: root,
      status,
      server: 'ws://localhost:8080',
      token: 'wearer-token',
      startPhone: phone.startPhone,
      startLens,
      waitForBridge: stub.wait,
      bridgeWaitMs: 50,
    })
    expect(phone.homes, 'the phone page drew its history').toEqual([1])
    expect(opened.filter((u) => u.includes('/audio')), 'a socket was opened to /audio').toEqual([])
    expect(booted.lens, 'a lens was started').toBeUndefined()
    expect(stub.asked(), 'the page waited for a bridge that is not there').toBe(0)
    expect(status.textContent).toMatch(/no Even bridge/i)
  })

  it('starts the lens where the Even app (or the simulator) has put its bridge on the page', async () => {
    const stub = stubBridge()
    const phone = phoneStub()
    const booted = await boot({
      window: { flutter_inappwebview: { callHandler: async () => null } },
      phoneRoot: root,
      status: null,
      server: 'ws://localhost:8080',
      token: 'wearer-token',
      startPhone: phone.startPhone,
      startLens,
      waitForBridge: stub.wait,
      bridgeWaitMs: 50,
    })
    expect(opened.filter((u) => u.includes('/audio')), 'the lens opened /audio').toHaveLength(1)
    expect(booted.lens).toBeDefined()
    await booted.lens!.stop()
  })

  it('dials /audio with the shared token as a subprotocol, never in its URL (PH)', async () => {
    const token = 'q+3/Zk9xP0aB7cD/Ee+FfGgHh1Ii2Jj3Kk4Ll5Mm6N0='
    const booted = await boot({
      window: { flutter_inappwebview: { callHandler: async () => null } },
      phoneRoot: root,
      status: null,
      server: 'ws://localhost:8080',
      token,
      startPhone: phoneStub().startPhone,
      startLens,
      waitForBridge: stubBridge().wait,
      bridgeWaitMs: 50,
    })
    const i = opened.findIndex((u) => u.includes('/audio'))
    expect(i).toBeGreaterThanOrEqual(0)
    const url = new URL(opened[i]!)
    expect(url.searchParams.has('token')).toBe(false)
    expect(opened[i]).not.toContain(encodeURIComponent(token))
    expect(opened[i]).not.toContain(token)
    const protocols = offered[i] as string[]
    expect(protocols[0]).toBe(AUDIO_PROTOCOL)
    expect(protocols.slice(1).map(tokenFromProtocol)).toEqual([token])
    await booted.lens!.stop()
  })

  it('waits a moment for a bridge the host injects late', async () => {
    const win: { flutter_inappwebview?: unknown } = {}
    setTimeout(() => (win.flutter_inappwebview = { callHandler: async () => null }), 10)
    expect(await hasEvenBridge(win, 200)).toBe(true)
    expect(await hasEvenBridge({}, 30)).toBe(false)
  })
})
