// The pre-event checklist's fixture scripts (BUILD-PLAN.md), written as lines
// with start times in seconds. No recordings exist (D126), so make-fixtures.ts
// turns each script into SYNTHETIC pre-transcribed word timings, in two
// variants: wearer louder at the mic, and the other person louder.
// `who` is 'wearer' or the person's name; the name never reaches the server,
// only the word's role and the provider label derived from it.

export interface ScriptLine {
  /** Start time in seconds from the fixture's start; or */
  at?: number
  /** seconds after the previous line ends. */
  gap?: number
  who: string
  text: string
  /** Force the line's total duration in seconds (a one-second "mm-hm"). */
  span?: number
}

export const SCRIPTS: Record<string, ScriptLine[]> = {
  // Priya, Marcus, Dana; a second Priya inside two minutes; a late re-introduction.
  // The wearer speaks at least every ten minutes, so the conversation never ends (D92).
  introductions: [
    { at: 0, who: 'wearer', text: 'Hi everyone, good to see you all.' },
    { at: 3, who: 'Priya', text: "Hi, I'm Priya." },
    { gap: 0.8, who: 'Marcus', text: 'My name is Marcus.' },
    { gap: 0.8, who: 'wearer', text: 'Nice to meet you both.' },
    { gap: 0.8, who: 'Dana', text: 'Dana, nice to meet you.' },
    { at: 93, who: 'Priya-2', text: "Hi, I'm Priya." },
    { at: 300, who: 'wearer', text: 'So what brings everyone here today?' },
    { at: 595, who: 'wearer', text: 'Oh, here comes someone new.' },
    { at: 610, who: 'Priya', text: "I'm Priya." },
  ],
  // With and without a time word; "I'll think about it"; "Yeah, I'll do it" after a question.
  promises: [
    { at: 0, who: 'Dev', text: "Hi, I'm Dev." },
    { gap: 0.6, who: 'wearer', text: 'Good to meet you, Dev.' },
    { gap: 0.8, who: 'Dev', text: 'Are you free tonight?' },
    { gap: 0.6, who: 'wearer', text: "I'll send you the deck tonight." },
    { gap: 2, who: 'wearer', text: "I'll intro you to Sam." },
    { gap: 1, who: 'Dev', text: 'Would you join the Tuesday meeting?' },
    { gap: 0.6, who: 'wearer', text: "I'll think about it." },
    { gap: 1, who: 'Dev', text: 'Can you send me the budget by Friday?' },
    { gap: 0.6, who: 'wearer', text: "Yeah, I'll do it." },
  ],
  // A real interruption, a normal turn, a one-second "mm-hm", a silent pause.
  'cut-off': [
    { at: 0, who: 'wearer', text: 'There are two reasons for this. The first is cost, and the second reason is' },
    { gap: 0.3, who: 'Dev', text: 'Sorry, can I ask a quick question about the cost part first?' },
    { gap: 0.4, who: 'wearer', text: 'Sure. The second reason is cost.' },
    { gap: 2, who: 'wearer', text: "And that's why we chose it." },
    { gap: 1.5, who: 'Marcus', text: 'That makes sense, we did the same thing last year.' },
    { gap: 1, who: 'wearer', text: 'So the plan for next week is' },
    { gap: 0.4, who: 'Dev', text: 'Mm-hm.', span: 1 },
    { gap: 0.4, who: 'wearer', text: 'to ship the first version on Friday.' },
    { gap: 2, who: 'wearer', text: 'And the second reason is' },
    { gap: 4, who: 'wearer', text: 'speed, mostly.' },
  ],
  // The wearer's own name, which is never caught (D29).
  'own-name': [
    { at: 0, who: 'wearer', text: "Hi, I'm Linus." },
    { gap: 0.8, who: 'Priya', text: 'Nice to meet you.' },
  ],
}

export const VARIANTS = ['wearer-louder', 'other-louder'] as const
export type Variant = (typeof VARIANTS)[number]

/** Mean word loudness in dBFS per variant; each word gets a deterministic ±1.5 dB jitter. */
export const LOUDNESS: Record<Variant, { wearer: number; other: number }> = {
  'wearer-louder': { wearer: -12, other: -28 },
  'other-louder': { wearer: -26, other: -14 },
}
