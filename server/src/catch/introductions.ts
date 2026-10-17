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

/** Every introduction in one run of another person's words, in order. */
export function findIntroductions(words: readonly string[]): DetectedName[] {
  const found: DetectedName[] = []
  const add = (index: number) => {
    const name = nameAt(words, index)
    if (name !== null && !found.some((f) => f.index === index)) found.push({ name, index })
  }
  for (let i = 0; i < words.length; i++) {
    const w = lower(words[i])
    // "I'm X"
    if (w === "i'm" || w === 'im') add(i + 1)
    // "I am X" is too often "I am going"; only a capitalized non-word after it counts, as with every trigger.
    if (w === 'i' && lower(words[i + 1]) === 'am') add(i + 2)
    // "my name is X", "my name's X"
    if (w === 'my' && lower(words[i + 1]) === 'name' && lower(words[i + 2]) === 'is') add(i + 3)
    if (w === 'my' && lower(words[i + 1]) === "name's") add(i + 2)
    // "this is X"
    if (w === 'this' && lower(words[i + 1]) === 'is') add(i + 2)
    // "meet X" (not "meet you")
    if (w === 'meet') add(i + 1)
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
      add(i)
    }
  }
  return found.sort((a, b) => a.index - b.index)
}
