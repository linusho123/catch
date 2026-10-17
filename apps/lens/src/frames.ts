import { encodeFrame, type SpeakerRole } from '../../../shared/wire.ts'

// One SDK audio event becomes one wire frame: the PCM plus its sequence number,
// capture time, speakerRole and raw direction (Unknown and null from the phone
// mic and the simulator). The lens judges nothing; the server does.

export interface AudioEventLike {
  audioPcm: Uint8Array
  speakerRole?: string
  direction?: number | null
}

function roleOf(raw: string | undefined): SpeakerRole {
  return raw === 'self' || raw === 'other' ? raw : 'unknown'
}

export function toWireFrame(event: AudioEventLike, seq: number, captureMs: number): Uint8Array {
  return encodeFrame({
    seq,
    captureMs,
    speakerRole: roleOf(event.speakerRole),
    direction: event.direction ?? null,
    pcm: event.audioPcm,
  })
}
