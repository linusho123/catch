import { describe, expect, it } from 'vitest'
import { decodeFrame } from '../../../shared/wire.ts'
import { toWireFrame } from './frames.ts'

describe('the lens audio handler', () => {
  it("forwards the SDK frame's speakerRole and direction with the PCM", () => {
    const pcm = new Uint8Array([1, 2, 3, 4])
    const frame = decodeFrame(toWireFrame({ audioPcm: pcm, speakerRole: 'other', direction: 12 }, 7, 1000))
    expect(frame).toMatchObject({ seq: 7, captureMs: 1000, speakerRole: 'other', direction: 12 })
    expect(Array.from(frame.pcm)).toEqual([1, 2, 3, 4])
  })

  it("forwards the wearer's own 'self' role, the signal meant to lead on a G2 (M4)", () => {
    const frame = decodeFrame(toWireFrame({ audioPcm: new Uint8Array(2), speakerRole: 'self', direction: -3 }, 1, 100))
    expect(frame.speakerRole).toBe('self')
    expect(frame.direction).toBe(-3)
  })

  it('sends unknown and null when the SDK has no role or direction (phone mic, simulator)', () => {
    const frame = decodeFrame(toWireFrame({ audioPcm: new Uint8Array(2), speakerRole: 'unknown', direction: null }, 0, 0))
    expect(frame.speakerRole).toBe('unknown')
    expect(frame.direction).toBeNull()
    expect(decodeFrame(toWireFrame({ audioPcm: new Uint8Array(2) }, 0, 0)).speakerRole).toBe('unknown')
  })
})
