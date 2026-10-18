// The introduction detector: names by pattern on the transcript (DESIGN.md:
// chosen), run only on what someone other than the wearer said, so the
// wearer's own "Hi, I'm Linus" is never a catch (D29). English only (D78).
//
// The patterns are the plan's five: "I'm X", "my name is X", "this is X",
// "meet X", and "X, nice to meet you". A name is one capitalized word that is
// not a common word (the provider capitalizes names and sentence starts;
// "I'm going" or "this is great" never match). The detector is pure: it reads
// one run of another person's words and returns each name with the index of
// the word that carries it, so a caller re-reading a growing run can tell a
// name it has already caught from a new one.

export interface DetectedName {
  /** The name as it goes on the lens: `Priya`. */
  name: string
  /** Index, in the words given, of the word that carries the name. */
  index: number
}

/**
 * How a name was given: by its owner ("I'm X", "my name is X"), by someone
 * else's "meet X", or by someone else otherwise ("this is X", "X, nice to
 * meet you"). D132 reads the first two together.
 */
export type Introduced = 'self' | 'meet' | 'other'

/** Capitalized words that are never a name after a trigger, or before ", nice to meet you". */
const NOT_A_NAME = new Set(
  [
    'a', 'an', 'the', 'and', 'but', 'or', 'so', 'i', 'it', 'its', 'we', 'you', 'he', 'she', 'they', 'me', 'my', 'our', 'your',
    'this', 'that', 'here', 'there', 'just', 'not', 'very', 'really', 'also', 'still', 'back', 'from', 'with', 'in', 'on', 'at',
    'hi', 'hello', 'hey', 'yes', 'yeah', 'yep', 'no', 'nope', 'oh', 'ah', 'um', 'uh', 'well', 'okay', 'ok', 'sure', 'right',
    'nice', 'good', 'great', 'glad', 'happy', 'pleased', 'sorry', 'thanks', 'thank', 'fine', 'cool', 'wow', 'please',
    'everyone', 'everybody', 'all', 'guys', 'folks', 'mm', 'hm', 'mm-hm', 'uh-huh', 'today', 'tonight', 'tomorrow',
  ],
)

const bare = (word: string) => word.replace(/^[^\p{L}]+|[^\p{L}'-]+$/gu, '').replace(/'s$/u, '')

function nameAt(words: readonly string[], i: number): string | null {
  const raw = words[i]
  if (raw === undefined) return null
  const word = bare(raw)
  if (!/^\p{Lu}[\p{L}'-]*$/u.test(word)) return null
  if (NOT_A_NAME.has(word.toLowerCase())) return null
  return word
}

const lower = (w: string | undefined) => (w === undefined ? '' : bare(w).toLowerCase())
const endsSentence = (w: string | undefined) => w !== undefined && /[.!?]$/.test(w)

/** A word lowercased with its trailing punctuation gone but its "'s" kept: "name's" stays "name's". */
const lowerKeepingS = (w: string | undefined) => (w === undefined ? '' : w.toLowerCase().replace(/[^\p{L}']+$/u, ''))

/** Every introduction in one run of another person's words, in order. */
export function findIntroductions(words: readonly string[]): DetectedName[] {
  return detect(words).map(({ name, index }) => ({ name, index }))
}

/** The same, with how each name was given (D132). */
export function findIntroductionsHow(words: readonly string[]): (DetectedName & { how: Introduced })[] {
  return detect(words).map(({ name, index, how }) => ({ name, index, how }))
}

/**
 * Only the introductions in which the speaker gives their own name: "I'm X",
 * "I am X", "my name is X", "my name's X". The wearer's own name (D29) is
 * read from these alone; "meet X", "this is X" and "X, nice to meet you" name
 * someone else (M2).
 */
export function findSelfIntroductions(words: readonly string[]): DetectedName[] {
  return detect(words)
    .filter((d) => d.how === 'self')
    .map(({ name, index }) => ({ name, index }))
}

function detect(words: readonly string[]): (DetectedName & { how: Introduced })[] {
  const found: (DetectedName & { how: Introduced })[] = []
  const add = (index: number, how: Introduced | boolean) => {
    const name = nameAt(words, index)
    if (name !== null && !found.some((f) => f.index === index)) found.push({ name, index, how: how === true ? 'self' : how === false ? 'other' : how })
  }
  for (let i = 0; i < words.length; i++) {
    const w = lower(words[i])
    // "I'm X"
    if (w === "i'm" || w === 'im') add(i + 1, true)
    // "I am X" is too often "I am going"; only a capitalized non-word after it counts, as with every trigger.
    if (w === 'i' && lower(words[i + 1]) === 'am') add(i + 2, true)
    // "my name is X", "my name's X"
    if (w === 'my' && lower(words[i + 1]) === 'name' && lower(words[i + 2]) === 'is') add(i + 3, true)
    if (w === 'my' && lowerKeepingS(words[i + 1]) === "name's") add(i + 2, true)
    // "this is X"
    if (w === 'this' && lower(words[i + 1]) === 'is') add(i + 2, false)
    // "meet X" (not "meet you")
    if (w === 'meet') add(i + 1, 'meet')
    // "X, nice to meet you": X opens the run or a sentence, and carries the comma.
    const opens = i === 0 || endsSentence(words[i - 1])
    if (
      opens &&
      (words[i] ?? '').endsWith(',') &&
      ['nice', 'good', 'great', 'pleased', 'glad'].includes(lower(words[i + 1])) &&
      lower(words[i + 2]) === 'to' &&
      lower(words[i + 3]) === 'meet' &&
      lower(words[i + 4]) === 'you'
    ) {
      add(i, false)
    }
  }
  return found.sort((a, b) => a.index - b.index)
}
