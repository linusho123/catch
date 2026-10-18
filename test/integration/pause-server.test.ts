import { mkdtempSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import WebSocket, { WebSocketServer } from 'ws'
import { pauseFromEnv, startServer, type RunningServer } from '../../server/src/app.ts'
import { deepgram, KEEPALIVE_MS } from '../../server/src/stt/deepgram.ts'
import { audioProtocols } from '../../shared/audio-token.ts'
import type { LensView, ServerMessage } from '../../shared/lens-protocol.ts'
import { encodeFrame } from '../../shared/wire.ts'
import { VirtualClock } from '../harness/clock.ts'
import { pcmAt } from '../harness/player.ts'
import { rows } from '../harness/store-reader.ts'

// P6 on the running server, with the real Deepgram adapter talking to a
// loopback stand-in for Deepgram (nothing leaves the machine): the second
// reviewer's focus, anything heard, held, transcribed or sent to Deepgram
// during a pause. The choice (app.ts): the pause closes the stream with
// Deepgram's CloseStream, so no audio and no KeepAlive goes out while paused,
// and the resume opens a fresh stream whose words are placed from its own
// first audio (M1): a provider's clock counts only the audio it was sent,
// and a pause sends none. With the switch off (the demo build, D130, D133) a
// swipe down at the dot changes nothing on the wire. Read from what the
// stand-in received, what the socket was told, and the store file.

const TOKEN = 'pause-server-test-token-not-a-secret'
const FRAME_S = 0.1

interface Peer {
  socket: WebSocket
  /** Bytes of audio this stream was sent. */
  audio: number
  /** The text messages this stream was sent (KeepAlive, CloseStream). */
  texts: string[]
  closed: boolean
  /**
   * The final words this stream still holds when CloseStream comes: real
   * Deepgram answers CloseStream by sending them, and only then closes.
   */
  flush: { text: string; start: number; end: number }[][]
  /** How many of `flush`'s messages went out before the close. */
  flushed: number
  /** Hold the flush and the close at CloseStream until the test calls `release`. */
  hold?: boolean
  release?: () => void
}

const cleanups: (() => Promise<void> | void)[] = []
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c()
})

/** A loopback Deepgram: records every stream the adapter opens, what it was sent, and lets the test answer words on it. */
async function deepgramStandIn() {
  const peers: Peer[] = []
  const http = createServer()
  const wss = new WebSocketServer({ server: http })
  wss.on('connection', (socket) => {
    const peer: Peer = { socket, audio: 0, texts: [], closed: false, flush: [], flushed: 0 }
    peers.push(peer)
    socket.on('message', (data, isBinary) => {
      if (isBinary) peer.audio += (data as Buffer).byteLength
      else {
        peer.texts.push(String(data))
        // Deepgram answers CloseStream with the final results it still holds, then closes the stream.
        if (JSON.parse(String(data)).type === 'CloseStream') {
          const answer = () => {
            for (const words of peer.flush) {
              say(peer, words)
              peer.flushed++
            }
            socket.close(1000)
          }
          if (peer.hold) peer.release = answer
          else answer()
        }
      }
    })
    socket.on('close', () => (peer.closed = true))
  })
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve))
  cleanups.push(() => {
    for (const c of wss.clients) c.terminate()
    return new Promise<void>((resolve) => wss.close(() => http.close(() => resolve())))
  })
  const say = (peer: Peer, words: { text: string; start: number; end: number }[]) =>
    peer.socket.send(JSON.stringify({ type: 'Results', is_final: true, channel: { alternatives: [{ words: words.map((w) => ({ word: w.text, punctuated_word: w.text, start: w.start, end: w.end, confidence: 1 })) }] } }))
  return { url: `ws://127.0.0.1:${(http.address() as AddressInfo).port}/v1/listen`, peers, say }
}

async function until(what: string, ok: () => boolean, ms = 3000): Promise<void> {
  const deadline = performance.now() + ms
  while (!ok()) {
    if (performance.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 5))
  }
}

async function setup(pause: boolean) {
  const dg = await deepgramStandIn()
  const clock = new VirtualClock(1e-6)
  const dbPath = join(mkdtempSync(join(tmpdir(), 'catch-pause-')), 'catch.db')
  const server: RunningServer = await startServer({ port: 0, host: '127.0.0.1', dbPath, audioToken: TOKEN, clock, stt: deepgram('key', { url: dg.url, clock }), pause })
  cleanups.push(() => server.close())
  const frames: number[] = []
  server.events.on('frame', ({ frame }) => frames.push(frame.seq))
  const connect = async (lens: string) => {
    const socket = new WebSocket(`${server.url.replace(/^http/, 'ws')}/audio?lens=${lens}`, audioProtocols(TOKEN))
    cleanups.push(() => socket.terminate())
    const views: LensView[] = []
    const listening: boolean[] = []
    const acks: number[] = []
    socket.on('message', (data) => {
      const msg = JSON.parse(String(data)) as ServerMessage
      if (msg.type === 'show') views.push(msg.view)
      if (msg.type === 'listening') listening.push(msg.on)
      if (msg.type === 'ack') acks.push(msg.seq)
    })
    await new Promise<void>((resolve, reject) => (socket.once('open', () => resolve()), socket.once('error', reject)))
    return { socket, views, listening, acks }
  }
  let seq = 0
  /** Frames from second `from` to second `to` of the lens's capture clock, wearer-loud. */
  const send = (lens: { socket: WebSocket }, from: number, to: number) => {
    const sent: number[] = []
    for (let t = from + FRAME_S; t <= to + 1e-9; t += FRAME_S) {
      sent.push(seq)
      lens.socket.send(encodeFrame({ seq: seq++, captureMs: Math.round(t * 1000), speakerRole: 'unknown', direction: null, pcm: pcmAt(-12) }))
    }
    return sent
  }
  const touch = (lens: { socket: WebSocket }) => lens.socket.send(JSON.stringify({ type: 'touch', gesture: 'swipe-down' }))
  return { dg, clock, dbPath, server, frames, connect, send, touch }
}

const lastView = (views: LensView[]) => views.at(-1)

describe('pause on the running server (P6), the Deepgram adapter on a loopback stand-in', () => {
  it('closes the Deepgram stream at the pause, sends it nothing more, discards the frames that still come, and opens a fresh stream at the resume', async () => {
    const { dg, clock, dbPath, frames, connect, send, touch } = await setup(true)
    const lens = await connect('one')
    await until('the dot', () => lastView(lens.views)?.kind === 'dot')
    // Every socket starts muted on the lens; the server says to listen at once (the operator's answer 3).
    expect(lens.listening, 'the lens told to listen as it connects').toEqual([true])
    expect(dg.peers).toHaveLength(1)
    const first = dg.peers[0]!
    // Heard: frames to Deepgram, and a word that lands in the transcript.
    const before = send(lens, 0, 1)
    await until('the frames acknowledged', () => before.every((s) => lens.acks.includes(s)))
    await until('the audio at Deepgram', () => first.audio === before.length * 3200)
    dg.say(first, [{ text: 'Morning.', start: 0.2, end: 0.6 }])
    await until('"Morning." in the store', () => rows(dbPath, 'transcript').length === 1)
    // What Deepgram still holds when the pause closes the stream (the fix round's honesty-2, risk-1): "Late.", said
    // before the swipe (it ends inside the second of audio sent), and "Secret.", timed after the audio that was sent.
    first.flush = [[{ text: 'Late.', start: 0.7, end: 0.95 }], [{ text: 'Secret.', start: 1.5, end: 1.9 }]]

    // The pause: the lens told to stop, `paused`, the stream closed with CloseStream.
    touch(lens)
    await until('the lens told to stop listening', () => lens.listening.length === 2)
    expect(lens.listening).toEqual([true, false])
    await until('`paused`', () => lens.views.some((v) => v.kind === 'line' && v.text === 'paused'))
    await until('the stream closed', () => first.closed)
    expect(first.texts.map((t) => JSON.parse(t).type), 'CloseStream, and nothing else').toEqual(['CloseStream'])
    expect(first.flushed, 'the closed stream answered with the words it held').toBe(2)
    // Said before the swipe, delivered after it: still judged and transcribed (risk-1, the operator's answer 4).
    await until('"Late." in the store', () => rows(dbPath, 'transcript').length === 2)
    const audioAtPause = first.audio

    // While paused: frames that still arrive are discarded, unacknowledged, sent nowhere; minutes pass with no KeepAlive and no new stream.
    const acksAtPause = lens.acks.length
    const during = send(lens, 1, 3)
    await until('the frames reached the server', () => during.every((s) => frames.includes(s)))
    clock.advance(10 * KEEPALIVE_MS)
    clock.advance(LINE_MS_PLUS)
    await new Promise((r) => setTimeout(r, 50))
    expect(lens.acks.length, 'frames acknowledged while paused').toBe(acksAtPause)
    expect(first.audio, 'audio sent to Deepgram while paused').toBe(audioAtPause)
    expect(dg.peers, 'a stream opened while paused').toHaveLength(1)
    expect(first.texts.filter((t) => JSON.parse(t).type === 'KeepAlive'), 'a KeepAlive sent while paused').toEqual([])
    expect(lastView(lens.views), 'the dash').toEqual({ kind: 'dash' })
    // A word the closing stream answered from past the pause ("Secret.") is never transcribed.
    expect(rows(dbPath, 'transcript').map((r) => r.text)).toEqual(['Morning.', 'Late.'])

    // The resume: the lens told to listen, a fresh stream, and its words placed from its own first audio.
    touch(lens)
    await until('the lens told to listen', () => lens.listening.length === 3)
    expect(lens.listening).toEqual([true, false, true])
    await until('a fresh stream', () => dg.peers.length === 2)
    const second = dg.peers[1]!
    await new Promise((r) => setTimeout(r, 20))
    const after = send(lens, 20, 21)
    await until('the frames after the resume acknowledged and sent', () => after.every((s) => lens.acks.includes(s)) && second.audio === after.length * 3200)
    // Deepgram's clock for this stream starts at its first audio: second 20 on the lens's.
    dg.say(second, [{ text: 'Back.', start: 0.3, end: 0.7 }])
    await until('"Back." in the store', () => rows(dbPath, 'transcript').length === 3)
    expect(rows(dbPath, 'transcript').map((r) => r.text), '"Secret." never, even after the resume').toEqual(['Morning.', 'Late.', 'Back.'])
    const back = rows(dbPath, 'transcript')[2]!
    expect(back.text).toBe('Back.')
    expect(Number(back.start), 'placed after the pause, where it was said').toBeCloseTo(20.3, 3)
  })

  it('takes from a closing stream that answers only after the resume the words said before the pause, and never one past it (risk-1)', async () => {
    const { dg, dbPath, connect, send, touch } = await setup(true)
    const lens = await connect('one')
    await until('the dot', () => lastView(lens.views)?.kind === 'dot')
    const first = dg.peers[0]!
    const before = send(lens, 0, 1)
    await until('the frames acknowledged and sent', () => before.every((s) => lens.acks.includes(s)) && first.audio === before.length * 3200)
    first.hold = true
    first.flush = [[{ text: 'Late.', start: 0.7, end: 0.95 }], [{ text: 'Secret.', start: 1.5, end: 1.9 }]]
    touch(lens)
    await until('CloseStream at Deepgram', () => first.release !== undefined)
    // The wearer resumes before the closing stream has answered: the session listens again.
    touch(lens)
    await until('a fresh stream', () => dg.peers.length === 2)
    first.release!()
    await until('the closing stream closed', () => first.closed)
    await until('"Late." in the store', () => rows(dbPath, 'transcript').length === 1)
    // Audio after the resume covers the time "Secret." claims, so a word let through would be judged now.
    const after = send(lens, 20, 21)
    await until('the frames after the resume acknowledged', () => after.every((s) => lens.acks.includes(s)))
    expect(rows(dbPath, 'transcript').map((r) => r.text), '"Secret." was said past the pause').toEqual(['Late.'])
  })

  it('tells a lens that joins a paused Catch at once, and opens it no stream until the wearer resumes', async () => {
    const { dg, connect, touch } = await setup(true)
    const one = await connect('one')
    await until('the dot', () => lastView(one.views)?.kind === 'dot')
    touch(one)
    await until('the first stream closed', () => dg.peers[0]!.closed)
    one.socket.close()
    const two = await connect('two')
    await until('the new lens told to stop listening', () => two.listening.length === 1)
    expect(two.listening).toEqual([false])
    await until('the dash', () => lastView(two.views)?.kind === 'dash')
    await new Promise((r) => setTimeout(r, 30))
    expect(dg.peers, 'no stream for a paused Catch').toHaveLength(1)
    touch(two)
    await until('a stream at the resume', () => dg.peers.length === 2)
    expect(two.listening).toEqual([false, true])
  })

  it('with the switch off, a swipe down at the dot changes nothing: no message, no pause, the stream open and fed', async () => {
    const { dg, connect, send, touch } = await setup(false)
    const lens = await connect('one')
    await until('the dot', () => lastView(lens.views)?.kind === 'dot')
    const shown = lens.views.length
    touch(lens)
    const after = send(lens, 0, 1)
    await until('the frames acknowledged', () => after.every((s) => lens.acks.includes(s)))
    await until('the audio at Deepgram', () => dg.peers[0]!.audio === after.length * 3200)
    expect(lens.listening, 'the lens told to listen as it connected, and never told to stop').toEqual([true])
    expect(lens.views.slice(shown), 'nothing new on the lens: no `paused`, no dash').toEqual([])
    expect(dg.peers[0]!.closed, 'the stream stays open').toBe(false)
    expect(dg.peers).toHaveLength(1)
  })
})

describe('CATCH_PAUSE (P6)', () => {
  it('is off unless set to on, and refuses anything else', () => {
    expect([undefined, '', 'off', ' OFF '].map(pauseFromEnv)).toEqual([false, false, false, false])
    expect(['on', 'On '].map(pauseFromEnv)).toEqual([true, true])
    expect(() => pauseFromEnv('yes')).toThrow(/CATCH_PAUSE must be on or off/)
  })
})

/** Past `paused`'s second and a half (D86), so the dash is showing. */
const LINE_MS_PLUS = 1600
