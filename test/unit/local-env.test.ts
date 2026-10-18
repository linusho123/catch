import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { LOCAL_LOUDNESS_THRESHOLD_DBFS, localProcesses, localServerEnv } from '../../scripts/local-env.ts'
import { DEFAULT_LOUDNESS_THRESHOLD_DBFS } from '../../server/src/split/split.ts'

// `npm run local` (D128) on a laptop microphone (operator, P5): at the server's
// own -20 dBFS the wearer's normal voice on a MacBook Air falls under the
// threshold; -25 separated the wearer at about 30 cm from another voice at
// about 2 m. So the local script gives the server -25 when the wearer's .env
// sets nothing; the server's own default and the fixtures stay at -20.

describe('the server environment `npm run local` starts', () => {
  it('sets CATCH_LOUDNESS_THRESHOLD_DBFS to -25 when it is unset', () => {
    expect(LOCAL_LOUDNESS_THRESHOLD_DBFS).toBe('-25')
    expect(localServerEnv({ CATCH_AUDIO_TOKEN: 't' }, '8080').CATCH_LOUDNESS_THRESHOLD_DBFS).toBe('-25')
  })

  it('treats a blank value (a name-only line copied from .env.example) as unset', () => {
    expect(localServerEnv({ CATCH_LOUDNESS_THRESHOLD_DBFS: '' }, '8080').CATCH_LOUDNESS_THRESHOLD_DBFS).toBe('-25')
    expect(localServerEnv({ CATCH_LOUDNESS_THRESHOLD_DBFS: '  ' }, '8080').CATCH_LOUDNESS_THRESHOLD_DBFS).toBe('-25')
  })

  it('keeps a threshold the .env sets', () => {
    expect(localServerEnv({ CATCH_LOUDNESS_THRESHOLD_DBFS: '-30' }, '8080').CATCH_LOUDNESS_THRESHOLD_DBFS).toBe('-30')
  })

  it('passes the rest of the environment through, with the port', () => {
    const env = localServerEnv({ CATCH_AUDIO_TOKEN: 't', DEEPGRAM_API_KEY: 'k' }, '9090')
    expect(env).toMatchObject({ CATCH_AUDIO_TOKEN: 't', DEEPGRAM_API_KEY: 'k', PORT: '9090' })
  })

  it("leaves the server's own default alone", () => {
    expect(DEFAULT_LOUDNESS_THRESHOLD_DBFS).toBe(-20)
  })

  // test-gap-2: what `npm run local` spawns, not localServerEnv alone (local.mjs spawns exactly these).
  it('test-gap-2: starts the server with that environment, and the lens dev server pointed at it', () => {
    const { serverUrl, processes } = localProcesses({ CATCH_AUDIO_TOKEN: 't', DEEPGRAM_API_KEY: 'k' }, '/repo/catch', '/bin/node')
    expect(serverUrl).toBe('ws://localhost:8080')
    const [server, lens] = processes
    expect(processes).toHaveLength(2)
    expect([server!.command, server!.args, server!.options.cwd]).toEqual(['/bin/node', ['server/src/main.ts'], '/repo/catch'])
    expect(server!.options.env).toMatchObject({ CATCH_LOUDNESS_THRESHOLD_DBFS: '-25', PORT: '8080', CATCH_AUDIO_TOKEN: 't', DEEPGRAM_API_KEY: 'k' })
    expect([lens!.command, lens!.args]).toEqual([join('/repo/catch', 'node_modules/.bin/vite'), ['apps/lens']])
    expect(lens!.options.env).toMatchObject({ VITE_CATCH_SERVER: 'ws://localhost:8080', VITE_CATCH_TOKEN: 't' })
  })

  it('test-gap-2: keeps the .env threshold and port in what it spawns', () => {
    const { serverUrl, processes } = localProcesses({ CATCH_LOUDNESS_THRESHOLD_DBFS: '-30', PORT: '9090' }, '/r', '/bin/node')
    expect(serverUrl).toBe('ws://localhost:9090')
    expect(processes[0]!.options.env).toMatchObject({ CATCH_LOUDNESS_THRESHOLD_DBFS: '-30', PORT: '9090' })
    expect(processes[1]!.options.env.VITE_CATCH_SERVER).toBe('ws://localhost:9090')
  })
})
