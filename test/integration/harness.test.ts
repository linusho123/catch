import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { evenBridge, textLines } from '../harness/even-host.ts'
import { harness, HARNESS_TOKEN, type Harness } from '../harness/index.ts'
import { VirtualClock } from '../harness/clock.ts'
import { dbfsOf, FixtureRun } from '../harness/player.ts'
import { find, rows, tables } from '../harness/store-reader.ts'
import type { ServerEvents } from '../../server/src/app.ts'
import { framesFor, loadFixture } from '../fixtures/fixture.ts'

// One smoke test per harness piece, end to end: the real lens on the real SDK
// against the stand-in Even app, the server once for this worker, fixtures on
// the fixture clock, the store read directly.

let h: Harness
beforeAll(async () => {
  h = await harness()
})
afterAll(() => h.close())
/** The listeners this file added; the harness's own (the fixture provider hears every frame, M1) stay. */
const added: [event: 'frame' | 'words', fn: never][] = []
beforeEach(async () => {
  await h.reset()
  for (const [event, fn] of added.splice(0)) h.server.events.off(event, fn)
})

/** Everything the server emits as `event` from now until the end of the test. */
function listen<K extends 'frame' | 'words'>(event: K): ServerEvents[K][0][] {
  const heard: ServerEvents[K][0][] = []
  const fn = ((e: ServerEvents[K][0]) => heard.push(e)) as never
  h.server.events.on(event, fn)
  added.push([event, fn])
  return heard
}

describe('the Even bridge stub', () => {
  it("records the lens's start-up page as the SDK sends it, with brightness and the fixture clock", async () => {
    await h.startLens()
    // P1a: the lens starts with no dot, because it cannot hear until the server says so (D37) ...
    const [first] = h.host.payloads()
    expect(first?.method).toBe('createStartUpPageContainer')
    expect(textLines(first!)).toEqual([{ containerID: 1, containerName: 'blank', content: '', brightness: 1 }])
    expect(first!.at).toBeGreaterThanOrEqual(0)
    expect(first!.at).toBeLessThan(5000)
    // ... and draws the dot when the server, its speech-to-text stream open, says it can.
    for (let i = 0; i < 100 && h.host.payloads().length < 2; i++) await h.clock.sleepUntil(h.clock.now() + 50)
    const second = h.host.payloads()[1]
    expect(second?.method).toBe('rebuildPageContainer')
    expect(textLines(second!)).toEqual([{ containerID: 1, containerName: 'dot', content: '•', brightness: 1 }])
    // The microphone is opened through the same boundary, and is not a payload for the lens.
    expect(h.host.calls.map((c) => c.method)).toContain('audioControl')
  })

  it('stamps every page and text payload with the fixture clock', async () => {
    const { TextContainerUpgrade, RebuildPageContainer, TextContainerProperty } = await import('@evenrealities/even_hub_sdk')
    const bridge = await evenBridge()
    h.clock.advance(1500)
    await bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: 2, containerName: 'line', content: 'Priya' }))
    h.clock.advance(5000)
    const line = new TextContainerProperty({ containerID: 2, containerName: 'line', content: 'held', textColor: 3, xPosition: 0, yPosition: 0, width: 100, height: 40 })
    await bridge.rebuildPageContainer(new RebuildPageContainer({ containerTotalNum: 1, textObject: [line] }))
    await bridge.shutDownPageContainer(1)
    const [upgrade, rebuild, shutdown] = h.host.payloads()
    expect(upgrade!.method).toBe('textContainerUpgrade')
    expect(textLines(upgrade!)[0]).toMatchObject({ content: 'Priya', brightness: undefined })
    expect(upgrade!.at).toBeGreaterThanOrEqual(1500)
    expect(upgrade!.at).toBeLessThan(2500)
    expect(rebuild!.method).toBe('rebuildPageContainer')
    expect(textLines(rebuild!)).toEqual([{ containerID: 2, containerName: 'line', content: 'held', brightness: 3 }])
    expect(rebuild!.at).toBeGreaterThanOrEqual(6500)
    expect(shutdown).toMatchObject({ method: 'shutDownPageContainer', data: { exitMode: 1 } })
    expect(h.host.lastPayload()).toBe(shutdown)
  })
})

describe('the fixture player', () => {
  for (const name of ['own-name.wearer-louder', 'own-name.other-louder']) {
    it(`delivers ${name}'s words to the server at their fixture times`, async () => {
      const words = listen('words')
      await h.startLens()
      const run = h.play(name)
      await run.playTo()
      const fx = loadFixture(name)
      expect(words.flatMap((w) => w.words.map((x) => x.text))).toEqual(fx.words.map((w) => w.text))
      for (const [i, heard] of words.entries()) {
        const word = fx.words[i]!
        expect(heard.words[0]).toMatchObject({ start: word.start, end: word.end, speaker: word.speaker, isFinal: true })
        const lateBy = run.seconds(heard.at) - word.end
        expect(lateBy).toBeGreaterThanOrEqual(0)
        expect(lateBy).toBeLessThan(0.5)
      }
    })
  }

  it("sends every 100 ms frame through the lens to the server with the fixture's role and loudness", async () => {
    const frames = listen('frame')
    await h.startLens()
    const run = h.play('own-name.wearer-louder')
    await run.playTo()
    await h.clock.sleepUntil(run.at(4))
    const expected = framesFor(run.fixture)
    expect(frames).toHaveLength(expected.length)
    for (const [i, heard] of frames.entries()) {
      expect(heard.frame.seq).toBe(i)
      expect(heard.frame.speakerRole).toBe(expected[i]!.role)
      expect(dbfsOf(heard.frame.pcm)).toBeCloseTo(expected[i]!.loudness, 0)
      expect(run.seconds(heard.frame.captureMs) - expected[i]!.end).toBeLessThan(0.5)
      expect(heard.at).toBeGreaterThanOrEqual(heard.frame.captureMs)
    }
  })

  it("feeds every frame's PCM into the session's speech-to-text stream, at the fixture's loudness (M1)", async () => {
    await h.startLens()
    const run = h.play('own-name.wearer-louder')
    await run.playTo()
    await h.clock.sleepUntil(run.at(4))
    const expected = framesFor(run.fixture)
    expect(h.stt.pcm).toHaveLength(expected.length)
    for (const [i, pcm] of h.stt.pcm.entries()) {
      expect(pcm.byteLength).toBe(3200)
      expect(dbfsOf(pcm)).toBeCloseTo(expected[i]!.loudness, 0)
    }
  })

  it('jumps the clock across silence and still lands the next word on its fixture time', async () => {
    const words = listen('words')
    await h.startLens()
    const run = h.play('introductions.wearer-louder')
    await run.playTo(15)
    expect(() => run.skipTo(200)).toThrow(/would skip "Hi,"/)
    // M6: a word the jump would land inside is skipped too (its frames before the landing).
    const hi = run.fixture.words.find((w) => w.text === 'Hi,' && w.start >= 90)!
    expect(() => run.skipTo((hi.start + hi.end) / 2)).toThrow(/would skip "Hi,"/)
    run.skipTo(92)
    await run.playTo(95)
    const priya2 = run.fixture.words.find((w) => w.start >= 93)!
    const heard = words.find((w) => w.words[0]!.start === priya2.start)!
    expect(run.seconds(heard.at) - priya2.end).toBeGreaterThanOrEqual(0)
    expect(run.seconds(heard.at) - priya2.end).toBeLessThan(0.5)
  })

  it('fails loudly when no /audio session is open', async () => {
    const lens = await h.startLens()
    await lens.stop()
    await expect(h.play('own-name.wearer-louder').playTo()).rejects.toThrow(/no \/audio session is open/)
  })

  it('refuses the real-provider path on a synthetic fixture (no audio exists, D126), and off real time', () => {
    const deps = { host: h.host, stt: h.stt, realStt: true }
    expect(() => new FixtureRun('own-name.wearer-louder', { ...deps, clock: new VirtualClock(1) })).toThrow(/needs recorded audio.*synthetic \(D126\)/)
    expect(() => new FixtureRun('own-name.wearer-louder', { ...deps, clock: new VirtualClock(20) })).toThrow(/speed 1/)
  })
})

describe('the lens against a server that is down', () => {
  it('fails loudly instead of waiting', async () => {
    const probe = createServer()
    await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve))
    const { port } = probe.address() as AddressInfo
    await new Promise<void>((resolve) => probe.close(() => resolve()))
    const { startLens } = await import('../../apps/lens/src/lens.ts')
    const lens = await startLens({ bridge: await evenBridge(), server: `ws://127.0.0.1:${port}`, token: HARNESS_TOKEN })
    await expect(lens.connected).rejects.toThrow(/could not open/)
    await lens.stop()
  })
})

describe('the store reader', () => {
  it("reads the server's SQLite file directly, every table, every text value", () => {
    expect(tables(h.dbPath)).toContain('meta')
    expect(rows(h.dbPath, 'meta')).toContainEqual({ key: 'schema_version', value: '1' })
    expect(find(h.dbPath, 'Priya')).toEqual([])
    h.server.store.db.exec("CREATE TABLE IF NOT EXISTS probe (note TEXT); INSERT INTO probe VALUES ('Hi, I''m Priya')")
    expect(find(h.dbPath, 'priya')).toEqual([{ table: 'probe', column: 'note', value: "Hi, I'm Priya" }])
    h.server.store.db.exec('DROP TABLE probe')
    expect(() => rows(h.dbPath, 'probe')).toThrow(/no table probe/)
  })
})
