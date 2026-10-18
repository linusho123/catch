import { describe, expect, it } from 'vitest'
import { deepgramUrl, keytermsFromEnv } from './deepgram.ts'

// Readability pass (operator, on the real G2): smarter recognition through
// Deepgram's smart formatting and nova-3 keyterm prompting (DESIGN.md, chosen).
describe('Deepgram smart formatting and keyterms', () => {
  it('asks for smart formatting on every stream', () => {
    expect(new URL(deepgramUrl()).searchParams.get('smart_format')).toBe('true')
  })

  it('sends one keyterm parameter per term, and none when there are none', () => {
    expect(new URL(deepgramUrl()).searchParams.getAll('keyterm')).toEqual([])
    expect(new URL(deepgramUrl({ keyterms: ['Priya', 'Linus Ho'] })).searchParams.getAll('keyterm')).toEqual(['Priya', 'Linus Ho'])
  })

  it('reads CATCH_KEYTERMS as a comma list, trimmed, blanks and duplicates dropped, at most 100', () => {
    expect(keytermsFromEnv(undefined)).toEqual([])
    expect(keytermsFromEnv(' Priya , Linus,, Priya ,Dev ')).toEqual(['Priya', 'Linus', 'Dev'])
    expect(keytermsFromEnv(Array.from({ length: 150 }, (_, i) => `t${i}`).join(','))).toHaveLength(100)
  })
})
