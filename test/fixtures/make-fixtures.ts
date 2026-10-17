import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { FIXTURE_DIR, type Fixture, type FixtureWord } from './fixture.ts'
import { LOUDNESS, SCRIPTS, VARIANTS, type ScriptLine, type Variant } from './scripts.ts'

// Writes the synthetic word-timing fixtures from scripts.ts: `npm run fixtures`.
// Deterministic: the unit suite regenerates them in memory and compares with
// the committed files, so a fixture is never edited by hand.

const WORD_GAP = 0.06

/** Deterministic jitter in [-1.5, 1.5] dB from a string (FNV-1a, then a murmur3 finalizer). */
function jitter(key: string): number {
  let h = 2166136261
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619)
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  h ^= h >>> 16
  return ((h >>> 0) / 0xffffffff) * 3 - 1.5
}

const round = (n: number, places = 3) => Math.round(n * 10 ** places) / 10 ** places

function wordsOf(line: ScriptLine, at: number, variant: Variant, speaker: number, lineIndex: number): FixtureWord[] {
  const tokens = line.text.split(/\s+/)
  const natural = tokens.map((t) => 0.18 + 0.045 * t.replace(/[^\p{L}\p{N}]/gu, '').length)
  const total = natural.reduce((a, b) => a + b, 0) + WORD_GAP * (tokens.length - 1)
  const scale = line.span ? (line.span - WORD_GAP * (tokens.length - 1)) / (total - WORD_GAP * (tokens.length - 1)) : 1
  const role = line.who === 'wearer' ? 'wearer' : 'other'
  let t = at
  return tokens.map((text, i) => {
    const dur = natural[i]! * scale
    const word: FixtureWord = {
      text,
      start: round(t),
      end: round(t + dur),
      role,
      loudness: round(LOUDNESS[variant][role] + jitter(`${variant}:${lineIndex}:${i}`), 1),
      speaker,
    }
    t += dur + WORD_GAP
    return word
  })
}

export function buildFixture(script: string, variant: Variant): Fixture {
  const lines = SCRIPTS[script]
  if (!lines) throw new Error(`no fixture script named ${script}`)
  // Diarization labels in order of first appearance, as the provider assigns them.
  const labels = new Map<string, number>()
  const words: FixtureWord[] = []
  lines.forEach((line, i) => {
    if (!labels.has(line.who)) labels.set(line.who, labels.size)
    const previousEnd = words.at(-1)?.end ?? 0
    const at = line.at ?? previousEnd + (line.gap ?? 0)
    if (at < previousEnd) throw new Error(`${script} line ${i} starts at ${at}s, before the previous line ends at ${previousEnd}s`)
    words.push(...wordsOf(line, round(at), variant, labels.get(line.who)!, i))
  })
  return { fixture: 1, synthetic: true, script, variant, lines, words }
}

export function fixtureFileName(script: string, variant: Variant): string {
  return `${script}.${variant}.json`
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const script of Object.keys(SCRIPTS)) {
    for (const variant of VARIANTS) {
      const file = join(FIXTURE_DIR, fixtureFileName(script, variant))
      writeFileSync(file, JSON.stringify(buildFixture(script, variant), null, 2) + '\n')
      console.log(`wrote ${file}`)
    }
  }
}
