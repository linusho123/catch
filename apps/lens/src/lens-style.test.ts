import { describe, expect, it } from 'vitest'
import { CANVAS, containersFor, DEFAULT_STYLE, DIM, lensStyle } from './lens.ts'

// Readability pass (operator, on the real G2): the text's brightness and the
// dot's place are the server's to set, so they can be tuned on the glasses
// without a new Beta (DESIGN.md, chosen); the lens keeps safe defaults.
describe('the lens style', () => {
  it('by default draws the dot further right than before, at the top, and every text at DIM', () => {
    const [dot] = containersFor({ kind: 'dot' })
    expect(dot!.xPosition).toBe(CANVAS.width - 24)
    expect(dot!.yPosition).toBe(0)
    expect(dot!.textColor).toBe(DIM)
    expect(DEFAULT_STYLE).toEqual({ brightness: DIM, dot: { x: CANVAS.width - 24, y: 0 } })
  })

  it('draws every container at the style\'s brightness and the dot where the style puts it', () => {
    const style = lensStyle({ brightness: 3, dot: { x: 540, y: 4 } })
    const [dot] = containersFor({ kind: 'dot' }, style)
    expect([dot!.xPosition, dot!.yPosition, dot!.textColor]).toEqual([540, 4, 3])
    expect(containersFor({ kind: 'line', text: 'Priya' }, style).map((c) => c.textColor)).toEqual([3])
    for (const c of containersFor({ kind: 'names', names: ['Priya'] }, style)) expect(c.textColor).toBe(3)
    // The dash takes the dot's place (D86); the empty box of can't-hear too (D37).
    expect(containersFor({ kind: 'dash' }, style)[0]!.xPosition).toBe(540)
    expect(containersFor({ kind: 'deaf' }, style)[0]!.xPosition).toBe(540)
  })

  it('clamps whatever it is sent to the firmware\'s brightness range and the canvas', () => {
    expect(lensStyle({ brightness: 9, dot: { x: 9999, y: -5 } })).toEqual({ brightness: 4, dot: { x: CANVAS.width - 8, y: 0 } })
    expect(lensStyle({ brightness: -1, dot: { x: -3, y: 9999 } })).toEqual({ brightness: 0, dot: { x: 0, y: CANVAS.height - 40 } })
    expect(lensStyle({ brightness: 2.6, dot: { x: 550.4, y: 1.6 } })).toEqual({ brightness: 3, dot: { x: 550, y: 2 } })
    expect(lensStyle(undefined)).toEqual(DEFAULT_STYLE)
  })
})
