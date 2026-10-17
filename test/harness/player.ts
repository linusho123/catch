import type { EventEmitter } from 'node:events'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Clock } from '../../shared/clock.ts'
import type { AudioFrame } from '../../shared/wire.ts'
import type { ServerEvents } from '../../server/src/app.ts'
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

/**
 * The speech-to-text provider the server is given under test: the player's
 * words, never a network call. `loseConnection()` and `restore()` play the
 * provider going away and coming back (D37): while it is down every stream
 * the server opens fails, and the words said meanwhile are never transcribed.
 *
 * Like Deepgram, each stream times its words from its own first audio, not
 * from the fixture's start (M1): once `attach`ed to the server's events it
 * knows when the first PCM fed to each stream was captured, and `deliver`
 * moves the fixture's words onto that stream's clock. A reopened stream's
 * words therefore start again near 0, and the server must place them.
 */
export class FixtureStt implements SpeechToText {
  readonly name = 'fixture'
  private stream:
    | {
        onWords: (words: SttWord[]) => void
        onError: (err: unknown) => void
        open: boolean
        pcm: Uint8Array[]
        /** When the first audio this stream heard was captured (its frame's capture stamp); words are timed from that frame's start. */
        firstCaptureMs: number | undefined
        /** Words said before this stream heard any audio, with their run's epoch: given once it hears some. */
        early: { words: SttWord[]; epoch: number }[]
      }
    | undefined
  /** The frame the server is handling now (its 'frame' event comes just before it feeds that frame's PCM to the stream). */
  private lastFrame: AudioFrame | undefined
  private attached = false
  private down = false
  /** Between a dropped stream and the server's next one: words said then are never transcribed. */
  private lost = false
  private readonly clock: Clock | undefined
  /** The clock reading at each stream the server opened that the provider accepted. */
  readonly opened: number[] = []

  constructor(clock?: Clock) {
    this.clock = clock
  }

  /** Every PCM chunk the server fed the latest stream, in order (copies): what the real provider would have heard (M1). */
  get pcm(): readonly Uint8Array[] {
    return this.stream?.pcm ?? []
  }

  /**
   * Hears the server's frames, so each stream knows when its first audio was
   * captured. Without it (a bare unit test) words are delivered on fixture time.
   */
  attach(events: EventEmitter<ServerEvents>): void {
    this.attached = true
    events.on('frame', ({ frame }) => {
      this.lastFrame = frame
    })
  }

  /** Whether the provider is reachable. */
  get reachable(): boolean {
    return !this.down
  }

  open(onWords: (words: SttWord[]) => void, onError: (err: unknown) => void = () => {}, onOpen?: () => void): SttStream {
    if (this.down) {
      // Like a socket that cannot connect: the failure comes back after open() returns.
      queueMicrotask(() => onError(new Error('the speech-to-text provider is unreachable')))
      return { sendPcm() {}, close() {} }
    }
    const stream = { onWords, onError, open: true, pcm: [] as Uint8Array[], firstCaptureMs: undefined as number | undefined, early: [] as { words: SttWord[]; epoch: number }[] }
    this.stream = stream
    this.lost = false
    this.opened.push(this.clock?.now() ?? Number.NaN)
    queueMicrotask(() => {
      if (stream.open) onOpen?.()
    })
    return {
      sendPcm: (pcm) => {
        stream.pcm.push(new Uint8Array(pcm))
        // Where this stream's audio begins: the first PCM it is fed, whose frame the server is handling now.
        if (stream.firstCaptureMs === undefined && this.lastFrame) {
          stream.firstCaptureMs = this.lastFrame.captureMs
          for (const { words, epoch } of stream.early.splice(0)) if (stream.open) this.give(stream, words, epoch)
        }
      },
      close: () => {
        stream.open = false
      },
    }
  }

  /** The provider drops the open stream and refuses new ones until restore(). */
  loseConnection(): void {
    this.down = true
    const stream = this.stream
    if (stream?.open) {
      this.lost = true
      stream.open = false
      stream.onError(new Error('the speech-to-text provider dropped the stream'))
    }
  }

  restore(): void {
    this.down = false
  }

  /** Back to a provider that is up, for the next scenario. */
  reset(): void {
    this.down = false
    this.lost = false
  }

  /**
   * Words the fixture says, timed in fixture seconds from the run's `epoch`
   * (a clock reading); the open stream gives them timed from its own first audio.
   */
  deliver(words: SttWord[], epoch?: number): void {
    if (this.down || this.lost) return
    const stream = this.stream
    if (!stream?.open) throw new Error('no /audio session is open on the server: start the lens before playing a fixture')
    if (!this.attached || epoch === undefined) {
      stream.onWords(words)
      return
    }
    // A provider answers only after it hears the audio: a frame still on its way holds the word back.
    if (stream.firstCaptureMs === undefined) stream.early.push({ words, epoch })
    else this.give(stream, words, epoch)
  }

  private give(stream: NonNullable<FixtureStt['stream']>, words: SttWord[], epoch: number): void {
    // The first audio is one of the run's 100 ms frames, so it starts on the
    // fixture's frame grid. The player pushes a frame when the fixture clock
    // reaches the frame's end, and the lens stamps its capture time in that
    // push, a moment later and well before the next frame is due; that moment
    // is not part of the audio, so it is dropped here.
    const frameMs = FRAME_SECONDS * 1000
    const firstEnd = Math.floor((stream.firstCaptureMs! - epoch) / frameMs + 1e-6) * frameMs
    const zero = (firstEnd - frameMs) / 1000
    const onStream = (t: number) => Math.round((t - zero) * 1e6) / 1e6
    stream.onWords(words.map((w) => ({ ...w, start: onStream(w.start), end: onStream(w.end) })))
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
  /** Where the fixture's JSON (and, under CATCH_REAL_STT=1, its WAV) is read from; test/fixtures by default. */
  fixtureDir?: string
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
    const dir = deps.fixtureDir ?? FIXTURE_DIR
    this.fixture = loadFixture(name, dir)
    this.epoch = deps.clock.now()
    const real = deps.realStt ?? process.env.CATCH_REAL_STT === '1'
    if (real && deps.clock.speed !== 1) throw new Error('CATCH_REAL_STT=1 plays in real time: the clock must run at speed 1')
    const wav = join(dir, `${name}.wav`)
    if (real && !existsSync(wav)) {
      throw new Error(`CATCH_REAL_STT=1 needs recorded audio at ${wav}; ${name} is ${this.fixture.synthetic ? 'synthetic (D126)' : 'missing it'}`)
    }
    const audio = real ? readWavPcm(wav) : undefined
    const bytes = FRAME_SAMPLES * 2
    const signals = framesFor(this.fixture)
    // M7: the recording must cover the fixture's frames, give or take the last
    // one; a short or long WAV fails here instead of sending empty frames or
    // being cut off in silence. Within that one frame, the tail is padded with silence.
    if (audio && Math.abs(audio.byteLength / bytes - signals.length) > 1) {
      throw new Error(`${wav} holds ${+(audio.byteLength / bytes).toFixed(1)} frames of audio; the fixture has ${signals.length}: re-record or re-time it`)
    }
    const recorded = (i: number) => {
      const frame = new Uint8Array(bytes)
      frame.set(audio!.subarray(i * bytes, (i + 1) * bytes))
      return frame
    }
    const frames: Item[] = signals.map((f, i) => ({
      t: f.end,
      kind: 0,
      play: () => deps.host.pushAudio(audio ? recorded(i) : pcmAt(f.loudness), f.role),
    }))
    const words: Item[] = real
      ? []
      : this.fixture.words.map(({ text, start, end, speaker }) => ({
          t: end,
          kind: 1,
          play: () => deps.stt.deliver([{ text, start, end, speaker, confidence: 1, isFinal: true }], this.epoch),
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

  /**
   * Jumps the clock to fixture second `t` across silence; refuses to skip any
   * part of a word (M6): a word that overlaps the gap at all would lose the
   * frames that carry its audio.
   */
  skipTo(t: number): void {
    const now = this.seconds(this.deps.clock.now())
    const skipped = this.fixture.words.find((w) => w.start < t && w.end > now)
    if (skipped) throw new Error(`skipTo(${t}) would skip "${skipped.text}" at ${skipped.start}-${skipped.end}s; play it instead`)
    while (this.cursor < this.items.length && this.items[this.cursor]!.t <= t) this.cursor++
    this.deps.clock.advance(Math.max(0, this.at(t) - this.deps.clock.now()))
  }
}
