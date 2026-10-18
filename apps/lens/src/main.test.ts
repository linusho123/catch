import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BRIDGE_WAIT_MS, NO_BRIDGE_STATUS } from './boot.ts'

// test-gap-2: the entry itself, not boot() alone. main.ts must hand boot the
// page's own window, so that the page opened in a plain browser tab (no Even
// bridge on it, operator, P5) is the phone page only and never opens /audio.
// The page's globals are stand-ins: a window with no `flutter_inappwebview`,
// a document with the status line and no phone root, and a WebSocket that
// records what was dialled (the far side: "never opens /audio" is read from
// the sockets, not from a flag).

// The SDK reads the Even host's globals as it loads, so the test gives the
// entry a stand-in: in a plain browser tab its waitForEvenAppBridge resolves
// all the same (boot.ts), here to a bridge the lens could draw through. Only
// boot's own check of the window keeps the lens from starting.
vi.mock('@evenrealities/even_hub_sdk', () => ({
  waitForEvenAppBridge: async () => ({
    createStartUpPageContainer: async () => 0,
    rebuildPageContainer: async () => true,
    audioControl: async () => true,
    shutDownPageContainer: async () => true,
    onEvenHubEvent: () => () => {},
  }),
}))

const opened: string[] = []
const saved = { window: globalThis.window, document: globalThis.document, WebSocket: globalThis.WebSocket }

class RecordingSocket extends EventTarget {
  static readonly OPEN = 1
  readyState = 0
  binaryType = 'blob'
  constructor(url: string) {
    super()
    opened.push(url)
  }
  send(): void {}
  close(): void {}
}

const status = { textContent: '' as string | null }

beforeEach(() => {
  opened.length = 0
  status.textContent = ''
  vi.resetModules()
  // Only the page's timers: the module still loads on the real event loop.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const g = globalThis as Record<string, unknown>
  g.WebSocket = RecordingSocket
  g.window = { addEventListener: () => {} }
  g.document = {
    querySelector: (selector: string) => (selector === '#status' ? status : null),
    addEventListener: () => {},
    visibilityState: 'visible',
  }
})

afterEach(() => {
  vi.useRealTimers()
  const g = globalThis as Record<string, unknown>
  g.window = saved.window
  g.document = saved.document
  g.WebSocket = saved.WebSocket
})

describe("the plugin page's entry (main.ts) with no Even bridge on its window", () => {
  it('test-gap-2: hands boot the page\'s own window, so a plain browser tab shows the phone page only and never opens /audio', async () => {
    let loaded = false
    const entry = import('./main.ts').then(() => (loaded = true))
    // The bridge wait, and a little after it: a lens started now would have dialled /audio.
    let waited = 0
    for (let turns = 0; turns < 2000 && !loaded && waited <= BRIDGE_WAIT_MS + 500; turns++) {
      await new Promise((resolve) => setImmediate(resolve))
      if (status.textContent !== '' || opened.length > 0 || vi.getTimerCount() > 0) {
        await vi.advanceTimersByTimeAsync(25)
        waited += 25
      }
    }
    expect(opened.filter((u) => u.includes('/audio')), 'a socket was opened to /audio').toEqual([])
    expect(status.textContent, 'the status line').toBe(NO_BRIDGE_STATUS)
    await entry
  })
})
