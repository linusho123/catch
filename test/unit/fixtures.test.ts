import { describe, expect, it } from 'vitest'
import { fixtureNames, loadFixture } from '../fixtures/fixture.ts'
import { buildFixture, fixtureFileName } from '../fixtures/make-fixtures.ts'
import { DEFAULT_SPEED } from '../harness/clock.ts'
import { SCRIPTS, VARIANTS } from '../fixtures/scripts.ts'

// The synthetic word-timing fixtures (D126): one per script and variant,
// generated from scripts.ts and never edited by hand.

describe('the synthetic fixtures', () => {
  it('exist for every script in both variants, and nothing else is in the directory', () => {
    const expected = Object.keys(SCRIPTS).flatMap((s) => VARIANTS.map((v) => fixtureFileName(s, v).replace(/\.json$/, '')))
    expect(fixtureNames()).toEqual(expected.sort())
  })

  for (const script of Object.keys(SCRIPTS)) {
    for (const variant of VARIANTS) {
      const name = `${script}.${variant}`
      it(`${name} is exactly what make-fixtures.ts writes`, () => {
        expect(loadFixture(name)).toEqual(buildFixture(script, variant))
      })

      it(`${name} gives every word a role, a loudness and timings in order, with no overlap`, () => {
        const fx = loadFixture(name)
        expect(fx.synthetic).toBe(true)
        expect(fx.words.length).toBeGreaterThan(0)
        let previousEnd = 0
        for (const w of fx.words) {
          expect(['wearer', 'other']).toContain(w.role)
          expect(Number.isFinite(w.loudness)).toBe(true)
          expect(w.end).toBeGreaterThan(w.start)
          expect(w.start).toBeGreaterThanOrEqual(previousEnd)
          previousEnd = w.end
        }
        const roles = new Set(fx.words.map((w) => w.role))
        expect(roles.has('wearer')).toBe(true)
        expect(roles.has('other')).toBe(true)
      })

      it(`${name} puts the ${variant === 'wearer-louder' ? 'wearer' : 'other person'} louder on every word`, () => {
        const fx = loadFixture(name)
        const loudest = (role: string) => Math.max(...fx.words.filter((w) => w.role === role).map((w) => w.loudness))
        const quietest = (role: string) => Math.min(...fx.words.filter((w) => w.role === role).map((w) => w.loudness))
        if (variant === 'wearer-louder') expect(quietest('wearer')).toBeGreaterThan(loudest('other'))
        else expect(quietest('other')).toBeGreaterThan(loudest('wearer'))
      })
    }
  }

  it('keeps the script timings the later rulings depend on', () => {
    const intro = loadFixture('introductions.wearer-louder')
    const priyas = intro.words.filter((w) => w.text === 'Priya.')
    expect(priyas).toHaveLength(3)
    // The second Priya inside two minutes (D88), the third ten minutes on (D57).
    expect(priyas[1]!.start - priyas[0]!.start).toBeCloseTo(90, 0)
    expect(priyas[2]!.start - priyas[0]!.start).toBeGreaterThan(600)
    // The one-second "mm-hm" in the cut-off fixture.
    const mmhm = loadFixture('cut-off.other-louder').words.find((w) => w.text === 'Mm-hm.')!
    expect(mmhm.end - mmhm.start).toBeCloseTo(1, 3)
  })

  // head-2: a scenario over two seconds in the fast lane is a finding. The
  // player plays every word at the fixture clock's speed (the silences are
  // skipped, fastForward), so the circle's thirty introductions are spoken
  // briskly, as P4's long fixtures are: all its speech, played at twenty
  // times, takes well under a second of wall time.
  it.each(VARIANTS)('speaks the circle briskly, so its words play in under three quarters of a second (%s)', (variant) => {
    const fx = loadFixture(`circle.${variant}`)
    // A line is a run of one speaker's words with no more than a word gap between them.
    const lines: { start: number; end: number }[] = []
    fx.words.forEach((wd, i) => {
      const prev = fx.words[i - 1]
      if (prev && wd.speaker === prev.speaker && wd.start - prev.end <= 0.2) lines.at(-1)!.end = wd.end
      else lines.push({ start: wd.start, end: wd.end })
    })
    expect(lines, 'the wearer, thirty introductions, the wearer twice').toHaveLength(33)
    const spoken = lines.reduce((sum, l) => sum + (l.end - l.start), 0)
    expect((spoken / DEFAULT_SPEED) * 1000, `${spoken.toFixed(1)} s of speech, in ms of wall time`).toBeLessThan(750)
  })
})
