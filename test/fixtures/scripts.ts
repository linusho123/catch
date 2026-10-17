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

/** The wearer opens, Priya introduces herself at second 3, the wearer answers. */
const PRIYA_OPENING: ScriptLine[] = [
  { at: 0, who: 'wearer', text: 'Hi, good to see you.' },
  { at: 3, who: 'Priya', text: "Hi, I'm Priya." },
  { gap: 2.5, who: 'wearer', text: 'Nice to meet you.' },
]

/** Turns with Dev, about a second apart, until three minutes have passed. */
const SMALL_TALK_TURNS: [who: string, text: string][] = [
  ['wearer', 'So how was the drive in this morning?'],
  ['Dev', 'Not bad, the traffic was light for once.'],
  ['wearer', 'Lucky. The freeway was a parking lot for me.'],
  ['Dev', 'It always is on Fridays, people leave early.'],
  ['wearer', 'Fair enough. Did you catch the game last night?'],
  ['Dev', 'Only the second half, but it was a good one.'],
  ['wearer', 'The last few minutes were wild.'],
  ['Dev', 'I could not believe that final shot.'],
  ['wearer', 'Me neither, the whole room was shouting.'],
  ['Dev', 'We watched it at a bar downtown, it was packed.'],
  ['wearer', 'Which one, the place on Fourth Street?'],
  ['Dev', 'That one, they have the big screens now.'],
  ['wearer', 'I keep meaning to go there.'],
  ['Dev', 'The food is better than it used to be.'],
  ['wearer', 'Good to know, the old menu was rough.'],
  ['Dev', 'They changed the cook last spring.'],
  ['wearer', 'That explains the tacos.'],
  ['Dev', 'Right, the tacos are the best thing there now.'],
]

const SMALL_TALK: ScriptLine[] = (() => {
  const lines: ScriptLine[] = []
  // The turns run in order, round and round: 45 of them run just past three minutes.
  for (let i = 0; i < 45; i++) {
    const [who, text] = SMALL_TALK_TURNS[i % SMALL_TALK_TURNS.length]!
    lines.push(i === 0 ? { at: 0, who, text } : { gap: 1, who, text })
  }
  return lines
})()

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

  // P1a. The scenarios below need a conversation already under way, the
  // wearer having spoken, before the moment they are about.

  // D29 mid-conversation: the wearer gives their own name after the conversation has begun.
  'own-name-midway': [
    { at: 0, who: 'wearer', text: 'Morning, everyone.' },
    { gap: 0.8, who: 'Priya', text: 'Morning!' },
    { at: 4, who: 'wearer', text: "Hi, I'm Linus." },
    { gap: 0.8, who: 'Priya', text: 'Nice to meet you.' },
  ],
  // D17: one introduction, then the wearer answers after the line has faded.
  priya: [
    ...PRIYA_OPENING,
    { at: 10, who: 'wearer', text: 'So how do you know the hosts?' },
  ],
  // D88: the same words from someone else 90 seconds after Priya's.
  'priya-again-90s': [...PRIYA_OPENING, { at: 93, who: 'Priya-2', text: "Hi, I'm Priya." }, { gap: 1, who: 'wearer', text: 'Oh, two of you.' }],
  // D88: the same words three minutes after Priya's, outside the two-minute window.
  'priya-again-3min': [
    ...PRIYA_OPENING,
    { at: 100, who: 'wearer', text: 'Anyway, where were we?' },
    { at: 183, who: 'Priya-2', text: "Hi, I'm Priya." },
    { gap: 1, who: 'wearer', text: 'Welcome back.' },
  ],
  // D88: a second Priya 60 seconds after the first, a third 30 seconds after that.
  'priya-thrice': [
    ...PRIYA_OPENING,
    { at: 63, who: 'Priya-2', text: "Hi, I'm Priya." },
    { at: 93, who: 'Priya-3', text: "Hi, I'm Priya." },
    { gap: 1, who: 'wearer', text: 'Three of you!' },
  ],
  // D57: Priya re-introduces herself ten minutes later to someone who just joined; Marcus keeps her first in the order heard.
  'priya-reintroduced': [
    { at: 0, who: 'wearer', text: 'Hi everyone, good to see you all.' },
    { at: 3, who: 'Priya', text: "Hi, I'm Priya." },
    { gap: 0.8, who: 'Marcus', text: 'My name is Marcus.' },
    { gap: 0.8, who: 'wearer', text: 'Nice to meet you both.' },
    { at: 300, who: 'wearer', text: 'So what brings everyone here today?' },
    { at: 590, who: 'wearer', text: 'Oh, here comes someone new.' },
    { at: 603, who: 'Priya', text: "I'm Priya." },
    { gap: 1, who: 'wearer', text: 'And this is where we sit.' },
  ],
  // D129, the demo opener: the teammate introduces herself before the wearer has said anything.
  'demo-opener': [
    { at: 0.5, who: 'Priya', text: "Hi, I'm Priya." },
    { gap: 1.5, who: 'wearer', text: 'Nice to meet you.' },
  ],
  // M1: the speech-to-text stream drops at 1.5 s and comes back at about
  // 11.5 s (the test plays the outage); Dev and the wearer speak meanwhile,
  // untranscribed. Then the wearer gives their own name and Priya introduces
  // herself. The reopened stream times its words from about 11.5 s: left
  // there, the wearer's name would land on Dev's quiet words and Priya's on
  // the wearer's loud ones.
  'linus-after-outage': [
    { at: 0, who: 'wearer', text: 'Morning, everyone.' },
    { at: 2, who: 'Dev', text: 'Morning! Sorry, I have to step out.' },
    { at: 5, who: 'wearer', text: 'Sure, see you at lunch then.' },
    { at: 14.5, who: 'wearer', text: "Hi, I'm Linus." },
    { at: 17, who: 'Priya', text: "Hi, I'm Priya." },
    { gap: 1, who: 'wearer', text: 'Nice to meet you.' },
  ],
  // D14, D16, D37: three minutes of talk with Dev in which nobody introduces
  // themselves, the wearer makes no promise, and nobody cuts the wearer off.
  'small-talk': SMALL_TALK,
}

export const VARIANTS = ['wearer-louder', 'other-louder'] as const
export type Variant = (typeof VARIANTS)[number]

/** Mean word loudness in dBFS per variant; each word gets a deterministic ±1.5 dB jitter. */
export const LOUDNESS: Record<Variant, { wearer: number; other: number }> = {
  'wearer-louder': { wearer: -12, other: -28 },
  'other-louder': { wearer: -26, other: -14 },
}
