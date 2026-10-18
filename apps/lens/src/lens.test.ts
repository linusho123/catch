import { describe, expect, it } from 'vitest'
import { parseLensMessage } from '../../../shared/lens-protocol.ts'
import { containersFor, DIM, NAMES_HEADER, NO_PROMISES, NOTHING_HELD, PAUSED_MARK, PROMISES_HEADER, PROMISES_HINT } from './lens.ts'

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
    const page = containersFor({ kind: 'promises', you: ['send Dev the deck tonight', 'introduce Dev to Sam'], owed: [] })
    const shown = page.filter((c) => (c.content ?? '').trim() !== '').sort((a, b) => (a.yPosition ?? 0) - (b.yPosition ?? 0))
    expect(shown.map((c) => c.content)).toEqual([PROMISES_HEADER, 'send Dev the deck tonight\nintroduce Dev to Sam'])
    for (const c of shown) expect(c.textColor).toBe(DIM)
    expect(page.filter((c) => c.isEventCapture === 1)).toHaveLength(1)
  })

  it('reads `no promises yet` when nothing is promised', () => {
    expect(containersFor({ kind: 'promises', you: [], owed: [] }).map((c) => c.content)).toEqual([PROMISES_HEADER, NO_PROMISES])
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

describe('promises owed to the wearer on the lens (P5, D43, D91)', () => {
  it("lists the owed promises after the wearer's own, each as `owed: …`", () => {
    const page = containersFor({ kind: 'promises', you: ['send Dev the deck tonight'], owed: ['Dev sends the agenda', 'they (1) sends the slides'] })
    expect(page.map((c) => c.content)).toEqual([PROMISES_HEADER, 'send Dev the deck tonight\nowed: Dev sends the agenda\nowed: they (1) sends the slides'])
  })

  it('lists only the owed when the wearer promised nothing, and `no promises yet` only when neither side did', () => {
    expect(containersFor({ kind: 'promises', you: [], owed: ['Dev sends the agenda'] }).map((c) => c.content)).toEqual([PROMISES_HEADER, 'owed: Dev sends the agenda'])
    expect(containersFor({ kind: 'promises', you: [], owed: [] }).map((c) => c.content)).toEqual([PROMISES_HEADER, NO_PROMISES])
  })

  it('draws the names page, header and hint, when no name is held but promises are (not D31\'s nothing held)', () => {
    const page = containersFor({ kind: 'names', names: [], promisesHeld: true })
    const shown = page.filter((c) => (c.content ?? '').trim() !== '').map((c) => c.content)
    expect(shown).toEqual([NAMES_HEADER, PROMISES_HINT])
    expect(page.filter((c) => c.isEventCapture === 1)).toHaveLength(1)
    const threaded = containersFor({ kind: 'names', names: [], promisesHeld: true, thread: '…and the second reason is' })
    expect(threaded.filter((c) => (c.content ?? '').trim() !== '').map((c) => c.content)).toEqual(['…and the second reason is', NAMES_HEADER, PROMISES_HINT])
    expect(containersFor({ kind: 'names', names: [] }).map((c) => c.content)).toEqual([NOTHING_HELD])
  })
})

describe('the pause (P6, D86)', () => {
  it("draws the dash dim in the dot's own box, never the empty box of can't-hear", () => {
    const [dot] = containersFor({ kind: 'dot' })
    const [dash] = containersFor({ kind: 'dash' })
    const [deaf] = containersFor({ kind: 'deaf' })
    expect(dash!.content).toBe(PAUSED_MARK)
    expect(PAUSED_MARK.trim()).not.toBe('')
    expect(dash!.content).not.toBe(dot!.content)
    expect(deaf!.content).toBe('')
    expect(dash!.textColor).toBe(DIM)
    expect([dash!.xPosition, dash!.yPosition, dash!.width, dash!.height]).toEqual([dot!.xPosition, dot!.yPosition, dot!.width, dot!.height])
    expect(dash!.isEventCapture, 'the dash takes the touches, so the second swipe down arrives').toBe(1)
  })
})
