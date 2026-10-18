import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Duplex } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import { WebSocketServer } from 'ws'
import { deepgram, KEEPALIVE_MS, MAX_PENDING_BYTES } from '../../server/src/stt/deepgram.ts'
import { VirtualClock } from '../harness/clock.ts'

// The Deepgram adapter against a loopback stand-in for Deepgram (M7): the URL
// is injected, so nothing here reaches the network.

const cleanups: (() => Promise<void> | void)[] = []
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c()
})

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())))
  return `ws://127.0.0.1:${(server.address() as AddressInfo).port}/v1/listen`
}

/** A stand-in that accepts the socket and hands it to `onConnection`. */
async function standIn(onConnection: (ws: import('ws').WebSocket) => void): Promise<string> {
  const http = createServer()
  const wss = new WebSocketServer({ server: http })
  wss.on('connection', onConnection)
  cleanups.push(() => {
    for (const c of wss.clients) c.terminate()
    return new Promise<void>((resolve) => wss.close(() => resolve()))
  })
  return listen(http)
}

function errors() {
  const seen: Error[] = []
  let notify: () => void = () => {}
  const next = () => new Promise<void>((resolve) => (notify = resolve))
  return { seen, next, onError: (err: unknown) => (seen.push(err as Error), notify()) }
}

describe('the Deepgram adapter, against a loopback stand-in', () => {
  it('says when the stream is open, so the server shows the dot only once Catch can hear (D37)', async () => {
    let peer: import('ws').WebSocket | undefined
    const url = await standIn((ws) => (peer = ws))
    let opened: () => void = () => {}
    const open = new Promise<void>((resolve) => (opened = resolve))
    const stream = deepgram('key', { url }).open(() => {}, () => {}, opened)
    cleanups.push(() => stream.close())
    cleanups.push(() => peer?.terminate())
    await open
  })

  it('hands on interim and final words as Deepgram sends them, and an UtteranceEnd after them (PT)', async () => {
    let peer: import('ws').WebSocket | undefined
    const url = await standIn((ws) => {
      peer = ws
      const results = (isFinal: boolean, words: string[]) =>
        JSON.stringify({ type: 'Results', is_final: isFinal, channel: { alternatives: [{ words: words.map((word, i) => ({ word, start: i * 0.3, end: i * 0.3 + 0.25, confidence: 0.9 })) }] } })
      ws.send(results(false, ['hi']))
      ws.send(results(true, ['hi', 'there']))
      ws.send(JSON.stringify({ type: 'UtteranceEnd', channel: [0, 1], last_word_end: 0.55 }))
    })
    const heard: string[] = []
    let done: () => void = () => {}
    const ended = new Promise<void>((resolve) => (done = resolve))
    const stream = deepgram('key', { url }).open(
      (words) => heard.push(`${words[0]!.isFinal ? 'final' : 'interim'} ${words.map((w) => w.text).join(' ')}`),
      () => {},
      undefined,
      (lastWordEnd) => {
        heard.push(`utterance end ${lastWordEnd}`)
        done()
      },
    )
    cleanups.push(() => stream.close())
    cleanups.push(() => peer?.terminate())
    await ended
    expect(heard).toEqual(['interim hi', 'final hi there', 'utterance end 0.55'])
  })

  it('ends the utterance at a final Deepgram marks speech_final (its endpointing), before any UtteranceEnd after it (PT, operator answer 4)', async () => {
    let peer: import('ws').WebSocket | undefined
    const url = await standIn((ws) => {
      peer = ws
      const results = (isFinal: boolean, speechFinal: boolean, words: string[], from: number) =>
        JSON.stringify({
          type: 'Results',
          is_final: isFinal,
          speech_final: speechFinal,
          channel: { alternatives: [{ words: words.map((word, i) => ({ word, start: from + i * 0.3, end: from + i * 0.3 + 0.25, confidence: 0.9 })) }] },
        })
      // A final cut in continuous speech (not speech_final), then the endpointed one, then Deepgram's own UtteranceEnd.
      ws.send(results(true, false, ['sure', 'i'], 0))
      ws.send(results(true, true, ['send', 'it'], 0.6))
      ws.send(JSON.stringify({ type: 'UtteranceEnd', channel: [0, 1], last_word_end: 1.15 }))
      ws.send(results(true, false, ['next'], 3))
    })
    const heard: string[] = []
    let done: () => void = () => {}
    const ended = new Promise<void>((resolve) => (done = resolve))
    const stream = deepgram('key', { url }).open(
      (words) => {
        heard.push(`final ${words.map((w) => w.text).join(' ')}`)
        if (words[0]!.text === 'next') done()
      },
      () => {},
      undefined,
      (lastWordEnd) => heard.push(`utterance end ${lastWordEnd}`),
    )
    cleanups.push(() => stream.close())
    cleanups.push(() => peer?.terminate())
    await ended
    expect(heard).toEqual(['final sure i', 'final send it', 'utterance end 1.15', 'utterance end 1.15', 'final next'])
  })

  it('reports through onError when Deepgram closes the stream unexpectedly (M7)', async () => {
    const url = await standIn((ws) => setTimeout(() => ws.close(1011, 'idle timeout'), 10))
    const e = errors()
    const stream = deepgram('key', { url }).open(() => {}, e.onError)
    cleanups.push(() => stream.close())
    await e.next()
    expect(e.seen[0]?.message).toMatch(/closed.*1011.*idle timeout/)
  })

  it('reports PCM sent after Deepgram closed instead of discarding it in silence (M7)', async () => {
    const url = await standIn((ws) => ws.close(1000))
    const e = errors()
    const stream = deepgram('key', { url }).open(() => {}, e.onError)
    await e.next()
    e.seen.length = 0
    const again = e.next()
    stream.sendPcm(new Uint8Array(3200))
    await again
    expect(e.seen[0]?.message).toMatch(/dropped 3200 bytes/)
  })

  it('stays quiet when Catch closes the stream itself', async () => {
    let serverSaw = ''
    let opened: () => void = () => {}
    const open = new Promise<void>((resolve) => (opened = resolve))
    const url = await standIn((ws) => {
      opened()
      ws.on('message', (data) => {
        serverSaw = data.toString()
        ws.close(1000)
      })
    })
    const e = errors()
    const closed = new Promise<void>((resolve) => {
      const stream = deepgram('key', { url }).open(() => {}, e.onError)
      void open.then(() => setTimeout(() => stream.close(), 20))
      cleanups.push(() => stream.close())
      setTimeout(resolve, 200)
    })
    await closed
    expect(serverSaw).toContain('CloseStream')
    expect(e.seen).toEqual([])
  })

  it('bounds the audio held before the socket opens, and says when it drops some (M7)', async () => {
    // A stand-in that never answers the upgrade, so the socket stays CONNECTING.
    const http = createServer()
    const held: Duplex[] = []
    http.on('upgrade', (_req, socket: Duplex) => held.push(socket))
    cleanups.push(() => held.forEach((s) => s.destroy()))
    const url = await listen(http)
    const e = errors()
    const stream = deepgram('key', { url }).open(() => {}, e.onError)
    cleanups.push(() => stream.close())
    const chunk = new Uint8Array(3200)
    const chunks = Math.ceil(MAX_PENDING_BYTES / chunk.byteLength)
    for (let i = 0; i < chunks; i++) stream.sendPcm(chunk)
    expect(e.seen).toEqual([])
    stream.sendPcm(chunk)
    expect(e.seen).toHaveLength(1)
    expect(e.seen[0]?.message).toMatch(/before Deepgram opened/)
  })

  describe('KeepAlive through a gap in the audio (PH)', () => {
    /** A stand-in that records what it is sent, in order: `pcm <bytes>` or a text message's type; and a way to wait for one. */
    async function recorder() {
      const seen: string[] = []
      const waiting: { want: string; count: number; resolve: () => void }[] = []
      let peer: import('ws').WebSocket | undefined
      const url = await standIn((ws) => {
        peer = ws
        ws.on('message', (data, isBinary) => {
          seen.push(isBinary ? `pcm ${(data as Buffer).byteLength}` : String((JSON.parse(data.toString()) as { type?: string }).type))
          for (const w of waiting.splice(0)) {
            if (seen.filter((s) => s === w.want).length >= w.count) w.resolve()
            else waiting.push(w)
          }
        })
      })
      cleanups.push(() => peer?.terminate())
      const until = (want: string, count = 1) =>
        seen.filter((s) => s === want).length >= count ? Promise.resolve() : new Promise<void>((resolve) => waiting.push({ want, count, resolve }))
      return { url, seen, until, peer: () => peer }
    }
    /** The clock's timers still set: none once the stream is closed. */
    const timersOn = (clock: VirtualClock) => (clock as unknown as { timers: unknown[] }).timers.length

    it('sends KeepAlive five seconds into a gap, and every five seconds after, and never while audio flows', async () => {
      expect(KEEPALIVE_MS).toBe(5000)
      const clock = new VirtualClock(0.001)
      const r = await recorder()
      let opened: () => void = () => {}
      const open = new Promise<void>((resolve) => (opened = resolve))
      const stream = deepgram('key', { url: r.url, clock }).open(() => {}, () => {}, opened)
      cleanups.push(() => stream.close())
      await open
      // Audio every second for six seconds: no gap of five.
      for (let i = 0; i < 6; i++) {
        stream.sendPcm(new Uint8Array(3200))
        clock.advance(1000)
      }
      // A millisecond short of a gap, then audio again: the marker arrives with no KeepAlive before it.
      stream.sendPcm(new Uint8Array(3200))
      clock.advance(KEEPALIVE_MS - 1)
      stream.sendPcm(new Uint8Array(7))
      await r.until('pcm 7')
      expect(r.seen.filter((s) => s === 'KeepAlive')).toEqual([])
      // Then a gap: one KeepAlive at five seconds, another at ten.
      clock.advance(KEEPALIVE_MS)
      await r.until('KeepAlive')
      clock.advance(KEEPALIVE_MS)
      await r.until('KeepAlive', 2)
      // Audio again, and it stops.
      stream.sendPcm(new Uint8Array(9))
      clock.advance(KEEPALIVE_MS - 1)
      stream.sendPcm(new Uint8Array(11))
      await r.until('pcm 11')
      expect(r.seen.slice(-5)).toEqual(['pcm 7', 'KeepAlive', 'KeepAlive', 'pcm 9', 'pcm 11'])
      expect(r.seen.filter((s) => s === 'KeepAlive')).toHaveLength(2)
    })

    it('stops when Catch closes the stream, and when Deepgram does', async () => {
      const clock = new VirtualClock(0.001)
      const r = await recorder()
      let opened: () => void = () => {}
      const open = new Promise<void>((resolve) => (opened = resolve))
      const stream = deepgram('key', { url: r.url, clock }).open(() => {}, () => {}, opened)
      await open
      clock.advance(KEEPALIVE_MS)
      await r.until('KeepAlive')
      stream.close()
      await r.until('CloseStream')
      expect(timersOn(clock), 'a timer left set after close').toBe(0)
      clock.advance(10 * KEEPALIVE_MS)
      await new Promise((resolve) => setTimeout(resolve, 30))
      expect(r.seen.filter((s) => s === 'KeepAlive')).toHaveLength(1)

      // Deepgram closing the stream stops it too.
      const clock2 = new VirtualClock(0.001)
      const r2 = await recorder()
      const e = errors()
      let opened2: () => void = () => {}
      const open2 = new Promise<void>((resolve) => (opened2 = resolve))
      const stream2 = deepgram('key', { url: r2.url, clock: clock2 }).open(() => {}, e.onError, opened2)
      cleanups.push(() => stream2.close())
      await open2
      expect(timersOn(clock2), 'the KeepAlive timer is set once open').toBe(1)
      r2.peer()?.close(1011, 'gone')
      await e.next()
      expect(timersOn(clock2), 'a timer left set after Deepgram closed').toBe(0)
    })
  })
})
