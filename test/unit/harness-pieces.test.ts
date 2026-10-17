import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { VirtualClock } from '../harness/clock.ts'
import { NotificationCapture } from '../harness/notifications.ts'
import { dbfsOf, FixtureStt, pcmAt, readWavPcm } from '../harness/player.ts'
import { isLoopback } from '../setup/no-network.ts'

describe('the notification capture', () => {
  it('records what the phone received, on the fixture clock, and refuses while the phone is off', async () => {
    const clock = new VirtualClock(1)
    const phone = new NotificationCapture(clock)
    clock.advance(2000)
    expect(await phone.send({ title: 'Catch', body: 'Send Dev the deck tonight' })).toBe(true)
    phone.reachable = false
    expect(await phone.send({ title: 'Catch', body: 'Introduce Dev to Sam' })).toBe(false)
    expect(phone.received.map((r) => r.notification.body)).toEqual(['Send Dev the deck tonight'])
    expect(phone.received[0]!.at).toBeGreaterThanOrEqual(2000)
    expect(phone.refused.map((r) => r.notification.body)).toEqual(['Introduce Dev to Sam'])
  })
})

describe('the fixture audio', () => {
  it('makes PCM at the loudness it is asked for', () => {
    for (const dbfs of [-11, -20, -27.2]) expect(dbfsOf(pcmAt(dbfs))).toBeCloseTo(dbfs, 1)
    expect(dbfsOf(pcmAt(-70))).toBeCloseTo(-70, 0)
    expect(pcmAt(-20).byteLength).toBe(3200)
  })

  it('reads the PCM of a 16 kHz mono WAV and refuses any other format', () => {
    const wav = (rate: number, pcm: Uint8Array) => {
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
      const path = join(mkdtempSync(join(tmpdir(), 'catch-wav-')), 'a.wav')
      writeFileSync(path, Buffer.concat([head, pcm]))
      return path
    }
    const pcm = pcmAt(-20)
    expect(Array.from(readWavPcm(wav(16000, pcm)))).toEqual(Array.from(pcm))
    expect(() => readWavPcm(wav(44100, pcm))).toThrow(/16 kHz mono/)
  })

  it('has no words to give when no /audio session is open', () => {
    expect(() => new FixtureStt().deliver([])).toThrow(/no \/audio session is open/)
  })
})

describe('the network guard', () => {
  it('lets loopback through and nothing else', () => {
    expect(['127.0.0.1', 'localhost', '::1', undefined].every(isLoopback)).toBe(true)
    expect(['api.deepgram.com', 'generativelanguage.googleapis.com', '10.0.0.2'].some(isLoopback)).toBe(false)
  })

  it('stops fetch and WebSocket before they leave the machine', async () => {
    const failure = await fetch('https://generativelanguage.googleapis.com/').catch((err: Error) => err)
    expect(String((failure as Error & { cause?: unknown }).cause ?? failure)).toMatch(/never do/)
    const socket = new WebSocket('wss://api.deepgram.com/v1/listen')
    const error = await new Promise<Error>((resolve) => socket.on('error', resolve))
    expect(error.message).toMatch(/api\.deepgram\.com.*never do/)
  })
})
