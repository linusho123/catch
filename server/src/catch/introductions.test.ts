import { describe, expect, it } from 'vitest'
import { findIntroductions, findSelfIntroductions } from './introductions.ts'
import { HeldNames, REPEATED_NAME_WINDOW_MS } from './held-names.ts'
import { SCRIPTS } from '../../../test/fixtures/scripts.ts'

const names = (text: string) => findIntroductions(text.split(/\s+/)).map((d) => d.name)

describe('the introduction detector', () => {
  it.each([
    ["Hi, I'm Priya.", ['Priya']],
    ['My name is Marcus.', ['Marcus']],
    ['This is Dana.', ['Dana']],
    ['You should meet Sam.', ['Sam']],
    ['Dana, nice to meet you.', ['Dana']],
    ["Hi, I'm Priya. My name is Marcus.", ['Priya', 'Marcus']],
    ["I'm Priya's sister.", ['Priya']],
    ["My name's Marcus.", ['Marcus']],
  ])('finds the name in %j', (text, expected) => {
    expect(names(text)).toEqual(expected)
  })

  it.each([
    "I'm going to the store.",
    "I'm fine, thanks.",
    'This is great.',
    'Nice to meet you.',
    'Hi, nice to meet you.',
    "I'm Sorry about that.",
    'Sorry, can I ask a quick question about the cost part first?',
    'Morning!',
  ])('finds no name in %j', (text) => {
    expect(names(text)).toEqual([])
  })

  it('tells the speaker\'s own name from a name given to someone else (M2)', () => {
    const self = (text: string) => findSelfIntroductions(text.split(/\s+/)).map((d) => d.name)
    expect(self("Hi, I'm Linus.")).toEqual(['Linus'])
    expect(self('I am Linus.')).toEqual(['Linus'])
    expect(self('My name is Linus.')).toEqual(['Linus'])
    expect(self("My name's Linus.")).toEqual(['Linus'])
    expect(self('Meet Dev.')).toEqual([])
    expect(self('This is Dana.')).toEqual([])
    expect(self('Priya, nice to meet you.')).toEqual([])
    expect(self("Meet Dev. I'm Linus.")).toEqual(['Linus'])
  })

  it('points at the word that carries each name, so a growing run is not caught twice', () => {
    expect(findIntroductions(['Hi,', "I'm", 'Priya.', 'My', 'name', 'is', 'Marcus.'])).toEqual([
      { name: 'Priya', index: 2 },
      { name: 'Marcus', index: 6 },
    ])
  })

  it('finds nothing in the three minutes of small talk, the cut-off dialogue or the promises but "Dev"', () => {
    for (const script of ['small-talk', 'cut-off']) {
      for (const line of SCRIPTS[script]!) expect(names(line.text), line.text).toEqual([])
    }
    expect(SCRIPTS.promises!.flatMap((l) => names(l.text))).toEqual(['Dev'])
  })
})

describe('the held names (D87, D88, D57)', () => {
  it('lists names in the order heard', () => {
    const held = new HeldNames()
    for (const [i, n] of ['Priya', 'Marcus', 'Dana'].entries()) held.hear(n, i * 1000)
    expect(held.list()).toEqual(['Priya', 'Marcus', 'Dana'])
  })

  it('numbers a repeated name inside two minutes of its first appearance, and lists a later one once', () => {
    const held = new HeldNames()
    expect(held.hear('Priya', 0)).toEqual({ line: 'Priya', added: true })
    expect(held.hear('Priya', 60_000)).toEqual({ line: 'Priya (2)', added: true })
    expect(held.hear('Priya', REPEATED_NAME_WINDOW_MS)).toEqual({ line: 'Priya (3)', added: true })
    expect(held.hear('Priya', REPEATED_NAME_WINDOW_MS + 1)).toEqual({ line: 'Priya', added: false })
    expect(held.list()).toEqual(['Priya', 'Priya (2)', 'Priya (3)'])
  })

  // D132 (amends D87): introduced, then introducing, is one person.
  it("lists a name once when someone's \"meet X\" is followed by X's own introduction inside the window (D132)", () => {
    const held = new HeldNames()
    expect(held.hear('Dev', 0, 'self')).toEqual({ line: 'Dev', added: true })
    expect(held.hear('Priya', 5000, 'meet')).toEqual({ line: 'Priya', added: true })
    expect(held.hear('Priya', 9000, 'self'), 'Priya herself, shown again, listed once').toEqual({ line: 'Priya', added: false })
    // A second "I'm Priya" inside the window is a second person again (D87).
    expect(held.hear('Priya', 20_000, 'self')).toEqual({ line: 'Priya (2)', added: true })
    expect(held.list()).toEqual(['Dev', 'Priya', 'Priya (2)'])
  })

  it('keeps D87 for every other repeat inside the window: meet then meet, self then self, "this is X" then self (D132)', () => {
    for (const [first, then] of [
      ['meet', 'meet'],
      ['self', 'self'],
      ['other', 'self'],
      ['self', 'meet'],
    ] as const) {
      const held = new HeldNames()
      held.hear('Priya', 0, first)
      expect(held.hear('Priya', 4000, then), `${first} then ${then}`).toEqual({ line: 'Priya (2)', added: true })
    }
  })

  it('takes the window as two minutes, from the ruling', () => {
    expect(REPEATED_NAME_WINDOW_MS).toBe(120_000)
  })
})
