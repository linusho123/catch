import { describe, expect, it } from 'vitest'
import { decodeFrame, encodeFrame, HEADER_BYTES } from './wire.ts'

describe('the lens-to-server audio frame', () => {
  it('carries seq, capture time, speaker role, direction and PCM through a round trip', () => {
    const pcm = new Uint8Array(3200).map((_, i) => i % 251)
    const bytes = encodeFrame({ seq: 41, captureMs: 1_760_000_000_123.5, speakerRole: 'self', direction: -3, pcm })
    expect(bytes.byteLength).toBe(HEADER_BYTES + 3200)
    const frame = decodeFrame(bytes)
    expect(frame).toMatchObject({ seq: 41, captureMs: 1_760_000_000_123.5, speakerRole: 'self', direction: -3 })
    expect(Array.from(frame.pcm)).toEqual(Array.from(pcm))
  })

  it('keeps a null direction and an unknown role, as the phone mic and the simulator send them', () => {
    const frame = decodeFrame(encodeFrame({ seq: 0, captureMs: 0, speakerRole: 'unknown', direction: null, pcm: new Uint8Array(2) }))
    expect(frame.direction).toBeNull()
    expect(frame.speakerRole).toBe('unknown')
  })

  it('refuses a frame shorter than its header', () => {
    expect(() => decodeFrame(new Uint8Array(HEADER_BYTES - 1))).toThrow(/too short/)
  })

  it('refuses a speaker role code it does not know', () => {
    const bytes = encodeFrame({ seq: 1, captureMs: 0, speakerRole: 'other', direction: 0, pcm: new Uint8Array(0) })
    bytes[12] = 9
    expect(() => decodeFrame(bytes)).toThrow(/role code 9/)
  })
})
