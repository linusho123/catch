// The lens-to-server audio frame: a fixed 16-byte little-endian header, then
// raw PCM s16le, 16 kHz, mono (one 100 ms G2 frame is 3200 bytes).
//
//   offset 0  u32  seq          frame sequence number, from 0
//   offset 4  f64  captureMs    capture time on the phone's clock (ms)
//   offset 12 u8   speakerRole  0 unknown, 1 self, 2 other (Even SDK's AudioSpeakerRole)
//   offset 13 u8   hasDirection 1 if direction is present, 0 if the SDK gave null
//   offset 14 i16  direction    the SDK's raw direction tag (meaningless when hasDirection is 0)
//
// Shared by apps/lens (encoder) and server (decoder); no runtime imports, so
// both the browser bundle and Node load it as is.

export const HEADER_BYTES = 16

export type SpeakerRole = 'self' | 'other' | 'unknown'

export interface AudioFrame {
  seq: number
  captureMs: number
  speakerRole: SpeakerRole
  direction: number | null
  pcm: Uint8Array
}

const ROLE_CODES: Record<SpeakerRole, number> = { unknown: 0, self: 1, other: 2 }
const ROLES: readonly SpeakerRole[] = ['unknown', 'self', 'other']

export function encodeFrame(frame: AudioFrame): Uint8Array {
  const out = new Uint8Array(HEADER_BYTES + frame.pcm.byteLength)
  const view = new DataView(out.buffer)
  view.setUint32(0, frame.seq, true)
  view.setFloat64(4, frame.captureMs, true)
  view.setUint8(12, ROLE_CODES[frame.speakerRole])
  view.setUint8(13, frame.direction === null ? 0 : 1)
  view.setInt16(14, frame.direction ?? 0, true)
  out.set(frame.pcm, HEADER_BYTES)
  return out
}

export function decodeFrame(bytes: Uint8Array): AudioFrame {
  if (bytes.byteLength < HEADER_BYTES) {
    throw new Error(`audio frame too short: ${bytes.byteLength} bytes, header is ${HEADER_BYTES}`)
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const roleCode = view.getUint8(12)
  const role = ROLES[roleCode]
  if (role === undefined) throw new Error(`audio frame has unknown speaker role code ${roleCode}`)
  return {
    seq: view.getUint32(0, true),
    captureMs: view.getFloat64(4, true),
    speakerRole: role,
    direction: view.getUint8(13) === 1 ? view.getInt16(14, true) : null,
    pcm: bytes.subarray(HEADER_BYTES),
  }
}

/** The server's reply to every audio frame in P0a: how many PCM bytes it received. */
export interface FrameAck {
  type: 'ack'
  seq: number
  bytes: number
}
