import { describe, expect, it } from 'vitest'
import { containersFor, DIM, NOTHING_HELD } from './lens.ts'

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
