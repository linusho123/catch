import { createSocket } from 'node:dgram'
import { copyFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { FIXTURE_DIR, framesFor, loadFixture } from '../fixtures/fixture.ts'
import { VirtualClock } from '../harness/clock.ts'
import { NotificationCapture } from '../harness/notifications.ts'
import { dbfsOf, FixtureRun, FixtureStt, pcmAt, readWavPcm } from '../harness/player.ts'
import { isLoopback } from '../setup/no-network.ts'
import { fastForward } from '../steps/lens-world.ts'

/** A 16 kHz mono s16le WAV (or another rate) holding `pcm`, written to `path` or a fresh temp file. */
function wav(rate: number, pcm: Uint8Array, path = join(mkdtempSync(join(tmpdir(), 'catch-wav-')), 'a.wav')): string {
  const head = Buffer.alloc(44)
  head.write('RIFF', 0, 'ascii')
  head.writeUInt32LE(36 + pcm.byteLength, 4)
  head.write('WAVEfmt ', 8, 'ascii')
  head.writeUInt32LE(16, 16)
  head.writeUInt16LE(1, 20)
  head.writeUInt16LE(1, 22)
  head.writeUInt32LE(rate, 24)
  head.writeUInt32LE(rate * 2, 28)
  head.writeUInt16LE(2, 32)
  head.writeUInt16LE(16, 34)
  head.write('data', 36, 'ascii')
  head.writeUInt32LE(pcm.byteLength, 40)
  writeFileSync(path, Buffer.concat([head, pcm]))
  return path
}

describe('the notification capture', () => {
  it('records what the phone received, on the fixture clock, and refuses while the phone is off', async () => {
    const clock = new VirtualClock(1)
    const phone = new NotificationCapture(clock)
    clock.advance(2000)
    expect(await phone.send('account-a', { title: 'Catch', body: 'Send Dev the deck tonight' })).toBe(true)
    expect(await phone.send('account-b', { title: 'Catch', body: 'Call Ana' })).toBe(true)
    phone.reachable = false
    expect(await phone.send('account-a', { title: 'Catch', body: 'Introduce Dev to Sam' })).toBe(false)
    expect(phone.received.map((r) => r.notification.body)).toEqual(['Send Dev the deck tonight', 'Call Ana'])
    expect(phone.received[0]!.at).toBeGreaterThanOrEqual(2000)
    expect(phone.refused.map((r) => r.notification.body)).toEqual(['Introduce Dev to Sam'])
    // Each account's phone shows only what was sent to it (D79).
    expect(phone.phone('account-a').map((r) => r.notification.body)).toEqual(['Send Dev the deck tonight'])
    expect(phone.phone('account-b').map((r) => r.notification.body)).toEqual(['Call Ana'])
  })
})

describe('the fixture audio', () => {
  it('makes PCM at the loudness it is asked for', () => {
    for (const dbfs of [-11, -20, -27.2]) expect(dbfsOf(pcmAt(dbfs))).toBeCloseTo(dbfs, 1)
    expect(dbfsOf(pcmAt(-70))).toBeCloseTo(-70, 0)
    expect(pcmAt(-20).byteLength).toBe(3200)
  })

  it('reads the PCM of a 16 kHz mono WAV and refuses any other format', () => {
    const pcm = pcmAt(-20)
    expect(Array.from(readWavPcm(wav(16000, pcm)))).toEqual(Array.from(pcm))
    expect(() => readWavPcm(wav(44100, pcm))).toThrow(/16 kHz mono/)
  })

  it('has no words to give when no /audio session is open', () => {
    expect(() => new FixtureStt().deliver([])).toThrow(/no \/audio session is open/)
  })

  it('keeps every PCM chunk the server feeds each stream, a fresh record per stream (M1)', () => {
    const stt = new FixtureStt()
    const first = stt.open(() => {})
    first.sendPcm(pcmAt(-20))
    first.sendPcm(pcmAt(-27))
    expect(stt.pcm.map((p) => Math.round(dbfsOf(p)))).toEqual([-20, -27])
    first.close()
    stt.open(() => {}).sendPcm(pcmAt(-11))
    expect(stt.pcm.map((p) => Math.round(dbfsOf(p)))).toEqual([-11])
  })

  it('plays the provider going away and coming back: streams fail while it is down, and words said meanwhile are lost (D37)', async () => {
    const stt = new FixtureStt()
    const seen: string[] = []
    const words: string[] = []
    stt.open((w) => words.push(...w.map((x) => x.text)), (e) => seen.push(`error: ${(e as Error).message}`), () => seen.push('open'))
    await Promise.resolve()
    expect(seen).toEqual(['open'])
    stt.loseConnection()
    expect(seen.at(-1)).toMatch(/dropped the stream/)
    expect(stt.reachable).toBe(false)
    stt.deliver([{ text: 'lost', start: 0, end: 0.2, confidence: 1, speaker: 0, isFinal: true }])
    stt.open(() => {}, (e) => seen.push(`error: ${(e as Error).message}`), () => seen.push('open'))
    await Promise.resolve()
    expect(seen.at(-1)).toMatch(/unreachable/)
    stt.restore()
    stt.open((w) => words.push(...w.map((x) => x.text)), () => {}, () => seen.push('open'))
    await Promise.resolve()
    expect(seen.at(-1)).toBe('open')
    stt.deliver([{ text: 'heard', start: 1, end: 1.2, confidence: 1, speaker: 0, isFinal: true }])
    expect(words).toEqual(['heard'])
  })

  it('refuses, on the real-provider path, a WAV whose length is not the fixture\'s frame count (M7)', () => {
    const name = 'own-name.wearer-louder'
    const dir = mkdtempSync(join(tmpdir(), 'catch-fixtures-'))
    copyFileSync(join(FIXTURE_DIR, `${name}.json`), join(dir, `${name}.json`))
    const count = framesFor(loadFixture(name)).length
    const audio = (frames: number) => Buffer.concat(Array.from({ length: frames }, () => pcmAt(-30)))
    const run = () => new FixtureRun(name, { clock: new VirtualClock(1), host: {} as never, stt: new FixtureStt(), realStt: true, fixtureDir: dir })
    for (const frames of [count - 5, 0, count + 5]) {
      wav(16000, audio(frames), join(dir, `${name}.wav`))
      expect(run).toThrow(new RegExp(`${name}\\.wav holds ${frames}(\\.0)? frames of audio; the fixture has ${count}`))
    }
    for (const frames of [count, count - 1, count + 1]) {
      wav(16000, audio(frames), join(dir, `${name}.wav`))
      expect(run).not.toThrow()
    }
  })
})

describe('skipping across silence', () => {
  it('refuses to skip into the middle of a word, whose frames would be dropped (M6)', () => {
    // A clock that all but stands still, so only skipTo moves it.
    const clock = new VirtualClock(1e-9)
    const run = new FixtureRun('introductions.wearer-louder', { clock, host: {} as never, stt: new FixtureStt() })
    const [first] = run.fixture.words
    expect(first!.start).toBe(0)
    expect(() => run.skipTo((first!.start + first!.end) / 2)).toThrow(new RegExp(`would skip "${first!.text}"`))
    expect(run.seconds(clock.now())).toBeLessThan(0.001)
    run.skipTo(first!.start)
  })
})

// Operator answer 5, the P9 restart scenario's load flake: a loaded machine
// left the clock ahead of the player, its catch-up took the clock past the
// fast-forward's end, and the words left behind were played only after the
// long-press that ended the conversation, so the jogger's prompt (its
// cassette's key) lost "good.". A fast-forward plays every word up to its end
// before it returns, however far the clock has run.
describe('fast-forwarding on a loaded machine', () => {
  it('plays every word said up to its end, and the frame that carries it, even when catching up takes the clock past it', async () => {
    // A synthetic fixture: the restart's last exchange, a second and a half of silence, then the end.
    const said = ['The', 'logs', 'go', 'to', 'Parquet', 'now.', 'Sounds', 'good.']
    const words = said.map((text, i) => ({ text, start: i * 0.3, end: i * 0.3 + 0.25, role: i < 6 ? 'other' : 'wearer', loudness: i < 6 ? -24 : -12, speaker: i < 6 ? 1 : 0 }))
    const dir = mkdtempSync(join(tmpdir(), 'catch-fixtures-'))
    writeFileSync(join(dir, 'loaded.json'), JSON.stringify({ fixture: 'loaded', synthetic: true, script: [], variant: 'wearer-louder', lines: [], words }))
    const clock = new VirtualClock(1e-9)
    const delivered: string[] = []
    const frames: number[] = []
    // Each frame pushed costs the loaded machine half a second of fixture time.
    const host = { pushAudio: (_pcm: unknown, _role: unknown, _dir: unknown, at: number) => (frames.push(at), clock.advance(500)) }
    const stt = { deliver: (ws: { text: string }[]) => delivered.push(...ws.map((x) => x.text)) }
    const run = new FixtureRun('loaded', { clock, host: host as never, stt: stt as never, fixtureDir: dir })
    // The machine stalled: the clock is a second ahead of the player when the fast-forward to the end begins.
    clock.advance(1000)
    const end = 4
    await fastForward({ run, h: { clock } } as never, end)
    expect(delivered, 'every word said before the end, in order, before the fast-forward returns').toEqual(said)
    expect(Math.max(...frames), "the frame that carries the last word's end").toBeGreaterThanOrEqual(run.at(run.frameEnd(words.at(-1)!.end)))
  })
})

// P6's first job, the three-hour workshop's load flake: the frame carrying
// the wearer's "Got it." was still crossing the socket when the fast-forward
// jumped the nine minutes to "Okay.", so the jump ran the clock past the ten
// minutes the wearer's opening line had left, the quiet ended the kept
// conversation before "Got it." was judged, and its jogger's transcript (the
// cassette's key) was cut short. A fast-forward jumps only once the server has
// every word played, on delivery, never on wall time.
describe('fast-forwarding while a frame is still on its way', () => {
  it('jumps a silence only once the server has heard every word played before it', async () => {
    const said = [
      { text: 'Got', start: 0, end: 0.15 },
      { text: 'it.', start: 0.2, end: 0.3 },
      { text: 'Okay.', start: 540, end: 540.2 },
    ]
    const words = said.map((x) => ({ ...x, role: 'wearer', loudness: -12, speaker: 0 }))
    const dir = mkdtempSync(join(tmpdir(), 'catch-fixtures-'))
    writeFileSync(join(dir, 'in-flight.json'), JSON.stringify({ fixture: 'in-flight', synthetic: true, script: [], variant: 'wearer-louder', lines: [], words }))
    const clock = new VirtualClock()
    const waiting: { text: string; end: number }[] = []
    const heard: { text: string; at: number }[] = []
    let run!: FixtureRun
    // The server: each word is heard once the frame carrying its end arrives, ten wall milliseconds after its push.
    const host = {
      pushAudio: (_pcm: unknown, _role: unknown, _dir: unknown, at: number) =>
        setTimeout(() => {
          while (waiting.length > 0 && waiting[0]!.end <= run.seconds(at) + 1e-6) heard.push({ text: waiting.shift()!.text, at: clock.now() })
        }, 10),
    }
    const stt = {
      deliver: (ws: { text: string; end: number }[]) => waiting.push(...ws),
      get holding() {
        return waiting.length
      },
    }
    run = new FixtureRun('in-flight', { clock, host: host as never, stt: stt as never, fixtureDir: dir })
    await fastForward({ run, h: { clock } } as never, 541)
    expect(heard.map((x) => x.text).slice(0, 2), 'the words before the silence').toEqual(['Got', 'it.'])
    for (const x of heard.slice(0, 2)) expect(run.seconds(x.at), `"${x.text}" reached the server only after the jump`).toBeLessThan(10)
  })
})

describe('the network guard', () => {
  it('lets loopback through and nothing else', () => {
    expect(['127.0.0.1', 'localhost', '::1', undefined].every(isLoopback)).toBe(true)
    expect(['api.deepgram.com', 'generativelanguage.googleapis.com', '10.0.0.2'].some(isLoopback)).toBe(false)
    expect(isLoopback('127.0.0.53')).toBe(true)
  })

  it('takes a 127.-prefixed host name for a public name, not loopback (M2)', () => {
    for (const host of ['127.evil.com', '127.0.0.1.nip.io', '1270.0.0.1', '127example.com']) expect(isLoopback(host), host).toBe(false)
  })

  it('refuses a direct socket.connect(port, host) to the network (M4)', async () => {
    for (const args of [[80, '192.0.2.1'], ['80', '192.0.2.1']] as const) {
      const socket = new Socket()
      const error = await new Promise<Error>((resolve) => {
        socket.on('error', resolve)
        socket.connect(...(args as [number, string]))
      })
      expect(error.message).toMatch(/192\.0\.2\.1.*never do/)
    }
  })

  it('stops UDP before it leaves the machine, and lets loopback UDP through (M3)', async () => {
    const out = createSocket('udp4')
    // Bound first: an unbound socket's send is queued and replayed in the short form, which would hide the long form.
    await new Promise<void>((resolve) => out.bind(0, resolve))
    try {
      const short = await new Promise<Error | null>((resolve) => out.send('x', 9, '192.0.2.1', resolve))
      expect(String(short)).toMatch(/192\.0\.2\.1.*never do/)
      const long = await new Promise<Error | null>((resolve) => out.send(Buffer.from('xy'), 0, 1, 9, '192.0.2.1', resolve))
      expect(String(long)).toMatch(/192\.0\.2\.1.*never do/)
    } finally {
      out.close()
    }
    const connected = createSocket('udp4')
    const refused = await new Promise<Error>((resolve) => {
      connected.on('error', resolve)
      connected.connect(9, '192.0.2.1')
    })
    expect(refused.message).toMatch(/192\.0\.2\.1.*never do/)
    connected.close()

    const inbox = createSocket('udp4')
    await new Promise<void>((resolve) => inbox.bind(0, '127.0.0.1', resolve))
    const heard = new Promise<string>((resolve) => inbox.on('message', (m) => resolve(String(m))))
    const local = createSocket('udp4')
    await new Promise<void>((resolve, reject) => local.send('hello', inbox.address().port, '127.0.0.1', (err) => (err ? reject(err) : resolve())))
    expect(await heard).toBe('hello')
    local.close()
    inbox.close()
  })

  it('stops fetch and WebSocket before they leave the machine', async () => {
    const failure = await fetch('https://generativelanguage.googleapis.com/').catch((err: Error) => err)
    expect(String((failure as Error & { cause?: unknown }).cause ?? failure)).toMatch(/never do/)
    const socket = new WebSocket('wss://api.deepgram.com/v1/listen')
    const error = await new Promise<Error>((resolve) => socket.on('error', resolve))
    expect(error.message).toMatch(/api\.deepgram\.com.*never do/)
  })
})

// The fix round's honesty-1: "A second swipe down resumes listening" proves
// the words said after the resume are heard by finding PAUSE_RESUME.heard in
// the store, and "nothing said while paused" by not finding PAUSE_RESUME.unheard.
// A control word said anywhere else in the fixture is found (or missed)
// whether or not the resume works, so each is said only on its own side.
describe('the pause-resume fixture: control words said only where they prove something', () => {
  const said = (fx: ReturnType<typeof loadFixture>, word: string) => fx.words.filter((w) => w.text.toLowerCase().includes(word.toLowerCase()))
  for (const variant of ['wearer-louder', 'other-louder']) {
    it(`each "heard" word is said only after the resume, each "unheard" only during the pause (${variant})`, async () => {
      const { PAUSE_RESUME } = await import('../fixtures/scripts.ts')
      const fx = loadFixture(`pause-resume.${variant}`)
      for (const word of PAUSE_RESUME.heard) {
        expect(said(fx, word).length, `"${word}" is said`).toBeGreaterThan(0)
        expect(said(fx, word).filter((w) => w.start < PAUSE_RESUME.resumeAt).map((w) => [w.text, w.start]), `"${word}" said before the resume`).toEqual([])
      }
      for (const word of PAUSE_RESUME.unheard) {
        expect(said(fx, word).length, `"${word}" is said`).toBeGreaterThan(0)
        expect(said(fx, word).filter((w) => w.start < PAUSE_RESUME.pauseAt || w.end > PAUSE_RESUME.resumeAt).map((w) => [w.text, w.start]), `"${word}" said outside the pause`).toEqual([])
      }
    })
  }
})
