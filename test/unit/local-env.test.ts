import { describe, expect, it } from 'vitest'
import { LOCAL_LOUDNESS_THRESHOLD_DBFS, localServerEnv } from '../../scripts/local-env.ts'
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
})
