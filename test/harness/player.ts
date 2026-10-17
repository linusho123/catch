import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SpeechToText, SttStream, SttWord } from '../../server/src/stt/types.ts'
import { FIXTURE_DIR, FRAME_SECONDS, framesFor, loadFixture, type Fixture } from '../fixtures/fixture.ts'
import type { VirtualClock } from './clock.ts'
import type { host as evenHost } from './even-host.ts'

// The fixture player. It plays a pre-transcribed fixture on the fixture
// clock along the two paths the real thing takes:
//   - audio: every 100 ms frame goes to the lens through the Even host as the
//     Even app would deliver it (the frame's speakerRole, and PCM at the
//     frame's loudness), and so over /audio to the server;
//   - words: the fixture's own words come out of `stt`, the speech-to-text
//     provider the server is given, each at its end time. No provider runs.
// Under CATCH_REAL_STT=1 the frames carry the fixture's recorded audio
// (`<name>.wav` beside the JSON, 16 kHz mono s16le) and the server's provider
// is the real one, so the words are the provider's; the synthetic fixtures
// have no audio (D126), so that path fails loudly on them.

export const SAMPLE_RATE = 16000
const FRAME_SAMPLES = SAMPLE_RATE * FRAME_SECONDS

/** PCM s16le for one frame whose RMS level is `dbfs` (a square wave: its RMS is its amplitude). */
export function pcmAt(dbfs: number, samples = FRAME_SAMPLES): Uint8Array {
  const amplitude = Math.round(32767 * 10 ** (dbfs / 20))
  const out = new Int16Array(samples)
  for (let i = 0; i < samples; i++) out[i] = (i >> 3) % 2 === 0 ? amplitude : -amplitude
  return new Uint8Array(out.buffer)
}

/** The RMS level of PCM s16le in dBFS. */
export function dbfsOf(pcm: Uint8Array): number {
  const samples = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.byteLength >> 1)
  let sum = 0
  for (const s of samples) sum += (s / 32767) ** 2
  return 10 * Math.log10(sum / samples.length)
}

/** The PCM of a 16 kHz mono s16le WAV. */
export function readWavPcm(path: string): Uint8Array {
  const buf = readFileSync(path)
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error(`${path} is not a WAV file`)
  let format: { channels: number; rate: number; bits: number } | undefined
  for (let at = 12; at + 8 <= buf.length; ) {
    const id = buf.toString('ascii', at, at + 4)
    const size = buf.readUInt32LE(at + 4)
    if (id === 'fmt ') format = { channels: buf.readUInt16LE(at + 10), rate: buf.readUInt32LE(at + 12), bits: buf.readUInt16LE(at + 22) }
    if (id === 'data') {
      if (format?.channels !== 1 || format.rate !== SAMPLE_RATE || format.bits !== 16) {
        throw new Error(`${path} must be 16 kHz mono 16-bit PCM, got ${JSON.stringify(format)}`)
      }
      return new Uint8Array(buf.buffer, buf.byteOffset + at + 8, Math.min(size, buf.length - at - 8))
    }
    at += 8 + size + (size % 2)
  }
  throw new Error(`${path} has no data chunk`)
}

/** The speech-to-text provider the server is given under test: the player's words, never a network call. */
export class FixtureStt implements SpeechToText {
  readonly name = 'fixture'
  private stream: { onWords: (words: SttWord[]) => void; open: boolean } | undefined

  open(onWords: (words: SttWord[]) => void): SttStream {
    const stream = { onWords, open: true }
    this.stream = stream
    return {
      sendPcm() {},
      close: () => {
        stream.open = false
      },
    }
  }

  deliver(words: SttWord[]): void {
    if (!this.stream?.open) throw new Error('no /audio session is open on the server: start the lens before playing a fixture')
    this.stream.onWords(words)
  }
}

interface Item {
  t: number
  /** 0 for an audio frame, 1 for a word: at the same instant the audio is in before its word is. */
  kind: 0 | 1
  play: () => void
}

export interface PlayerDeps {
  clock: VirtualClock
  host: typeof evenHost
  stt: FixtureStt
  realStt?: boolean
}

/**
 * One fixture being played. Fixture second 0 is the clock's reading when
 * the run is made (`harness().play(name)`); `playTo` plays up to a fixture second at the clock's speed,
 * `skipTo` jumps the clock across silence.
 */
export class FixtureRun {
  readonly fixture: Fixture
  readonly epoch: number
  private items: Item[]
  private cursor = 0

  readonly name: string
  private deps: PlayerDeps

  constructor(name: string, deps: PlayerDeps) {
    this.name = name
    this.deps = deps
    this.fixture = loadFixture(name)
    this.epoch = deps.clock.now()
    const real = deps.realStt ?? process.env.CATCH_REAL_STT === '1'
    if (real && deps.clock.speed !== 1) throw new Error('CATCH_REAL_STT=1 plays in real time: the clock must run at speed 1')
    const wav = join(FIXTURE_DIR, `${name}.wav`)
    if (real && !existsSync(wav)) {
      throw new Error(`CATCH_REAL_STT=1 needs recorded audio at ${wav}; ${name} is ${this.fixture.synthetic ? 'synthetic (D126)' : 'missing it'}`)
    }
    const audio = real ? readWavPcm(wav) : undefined
    const bytes = FRAME_SAMPLES * 2
    const frames: Item[] = framesFor(this.fixture).map((f, i) => ({
      t: f.end,
      kind: 0,
      play: () => deps.host.pushAudio(audio ? audio.subarray(i * bytes, (i + 1) * bytes) : pcmAt(f.loudness), f.role),
    }))
    const words: Item[] = real
      ? []
      : this.fixture.words.map(({ text, start, end, speaker }) => ({
          t: end,
          kind: 1,
          play: () => deps.stt.deliver([{ text, start, end, speaker, confidence: 1, isFinal: true }]),
        }))
    this.items = [...frames, ...words].sort((a, b) => a.t - b.t || a.kind - b.kind)
  }

  /** The clock reading at fixture second `t`. */
  at(t: number): number {
    return this.epoch + t * 1000
  }

  /** Fixture seconds for a clock reading (a payload's `at`, a server event's `at`). */
  seconds(at: number): number {
    return (at - this.epoch) / 1000
  }

  /** Plays frames and words up to fixture second `t` (default: the end), at the clock's speed. */
  async playTo(t = Infinity): Promise<void> {
    while (this.cursor < this.items.length && this.items[this.cursor]!.t <= t) {
      const item = this.items[this.cursor++]!
      await this.deps.clock.sleepUntil(this.at(item.t))
      item.play()
    }
    if (Number.isFinite(t)) await this.deps.clock.sleepUntil(this.at(t))
  }

  /** Jumps the clock to fixture second `t` across silence; refuses to skip a word. */
  skipTo(t: number): void {
    const skipped = this.fixture.words.find((w) => w.end > this.seconds(this.deps.clock.now()) && w.end <= t)
    if (skipped) throw new Error(`skipTo(${t}) would skip "${skipped.text}" at ${skipped.end}s; play it instead`)
    while (this.cursor < this.items.length && this.items[this.cursor]!.t <= t) this.cursor++
    this.deps.clock.advance(Math.max(0, this.at(t) - this.deps.clock.now()))
  }
}
