import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { httpOrigin } from '../../apps/lens/src/phone.ts'
import { lensServer } from '../../scripts/lens-origins.ts'

// The network whitelist behind `npm run lens:pack` (fix round, M2). The packed
// page reaches the server twice: the lens's WebSocket at the ws(s) origin for
// /audio, and the phone page's fetch at its http(s) twin for /phone (D130).
// Even's whitelist entries are scheme-qualified origins, so both must be in
// app.json, or the real Even app may refuse the phone page's fetch (the
// simulator does not enforce the whitelist). Every entry shares one host
// (operator answer 1): the phone API never rides the WebSocket.

const ROOT = resolve(import.meta.dirname, '../..')
const app = JSON.parse(readFileSync(join(ROOT, 'apps/lens/app.json'), 'utf8'))
const whitelist: string[] = app.permissions.find((p: { name: string }) => p.name === 'network').whitelist

describe('the origins the packed page reaches', () => {
  it('are every one whitelisted in app.json: the ws(s) origin for /audio and its http(s) twin for /phone', () => {
    const { server, error } = lensServer(whitelist)
    expect(error).toBeUndefined()
    expect(server).toBe('wss://catch-g2.fly.dev')
    const reached = [server!, httpOrigin(server!)]
    expect(reached.filter((origin) => !whitelist.includes(origin)), 'reached but not whitelisted').toEqual([])
  })
})

describe('the whitelist rule behind lens:pack', () => {
  it('builds against the one ws(s) entry, with any order of entries', () => {
    expect(lensServer(['https://catch-g2.fly.dev', 'wss://catch-g2.fly.dev'])).toEqual({ server: 'wss://catch-g2.fly.dev' })
    expect(lensServer(['wss://catch-g2.fly.dev'])).toEqual({ server: 'wss://catch-g2.fly.dev' })
  })

  it('refuses a whitelist whose entries do not all share that one host', () => {
    expect(lensServer(['wss://catch-g2.fly.dev', 'https://example.com']).error).toMatch(/one host/)
    expect(lensServer(['wss://catch-g2.fly.dev', 'https://catch-g2.fly.dev:8443']).error).toMatch(/one host/)
  })

  it('refuses a whitelist without exactly one ws(s) server origin', () => {
    expect(lensServer([]).error).toMatch(/exactly one/)
    expect(lensServer(['https://catch-g2.fly.dev']).error).toMatch(/exactly one/)
    expect(lensServer(['wss://catch-g2.fly.dev', 'ws://catch-g2.fly.dev']).error).toMatch(/exactly one/)
  })
})
