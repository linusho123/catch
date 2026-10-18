import { describe, expect, it } from 'vitest'
import { parseLensMessage } from '../../../shared/lens-protocol.ts'
import { containersFor, DIM, NO_PROMISES, NOTHING_HELD, PROMISES_HEADER } from './lens.ts'

// What the lens hands the bridge for one view: the containers as the SDK
// receives them. The features read the same payloads from the bridge stub.

describe('the held page with detection off (D120)', () => {
  it('keeps D31\'s empty page under the thread when nothing is held (head-3)', () => {
    const page = containersFor({ kind: 'names', names: [], thread: '…Lucky. The freeway' })
    const shown = page.filter((c) => (c.content ?? '').trim() !== '').sort((a, b) => (a.yPosition ?? 0) - (b.yPosition ?? 0))
    expect(shown.map((c) => c.content)).toEqual(['…Lucky. The freeway', NOTHING_HELD])
    for (const c of shown) expect(c.textColor).toBe(DIM)
    // The thread first, at the top; the empty page below it, not overlapping.
    const [thread, empty] = shown
    expect(thread!.yPosition).toBe(0)
    expect((thread!.yPosition ?? 0) + (thread!.height ?? 0)).toBeLessThanOrEqual(empty!.yPosition ?? 0)
    // One container takes the touches.
    expect(page.filter((c) => c.isEventCapture === 1)).toHaveLength(1)
  })
})

describe('the promises page (D43, D112)', () => {
  it('draws its header above the promises, one per line, dim, with one container taking the touches', () => {
    const page = containersFor({ kind: 'promises', you: ['send Dev the deck tonight', 'introduce Dev to Sam'] })
    const shown = page.filter((c) => (c.content ?? '').trim() !== '').sort((a, b) => (a.yPosition ?? 0) - (b.yPosition ?? 0))
    expect(shown.map((c) => c.content)).toEqual([PROMISES_HEADER, 'send Dev the deck tonight\nintroduce Dev to Sam'])
    for (const c of shown) expect(c.textColor).toBe(DIM)
    expect(page.filter((c) => c.isEventCapture === 1)).toHaveLength(1)
  })

  it('reads `no promises yet` when nothing is promised', () => {
    expect(containersFor({ kind: 'promises', you: [] }).map((c) => c.content)).toEqual([PROMISES_HEADER, NO_PROMISES])
  })

  it('sends a swipe down to the server as a touch, and nothing it does not know', () => {
    expect(parseLensMessage('{"type":"touch","gesture":"swipe-down"}')).toEqual({ type: 'touch', gesture: 'swipe-down' })
    expect(parseLensMessage('{"type":"touch","gesture":"swipe-left"}')).toBeNull()
  })
})

describe('the keep (D40)', () => {
  it('sends a swipe up to the server as a touch', () => {
    expect(parseLensMessage('{"type":"touch","gesture":"swipe-up"}')).toEqual({ type: 'touch', gesture: 'swipe-up' })
  })
})
