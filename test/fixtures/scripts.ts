// The pre-event checklist's fixture scripts (BUILD-PLAN.md), written as lines
// with start times in seconds. No recordings exist (D126), so make-fixtures.ts
// turns each script into SYNTHETIC pre-transcribed word timings, in two
// variants: wearer louder at the mic, and the other person louder.
// `who` is 'wearer' or the person's name; the name never reaches the server,
// only the word's role and the provider label derived from it. A second
// person wearing the same glasses is `wearer:<name>`: the wearer at the mic,
// with a provider label of their own.

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

/** Dev introduces himself; the wearer answers by name. Dev's line has faded by second 4. */
const DEV_OPENING: ScriptLine[] = [
  { at: 0, who: 'Dev', text: "Hi, I'm Dev." },
  { gap: 0.6, who: 'wearer', text: 'Good to meet you, Dev.' },
]

/** P2a: Dev's opening, then at second 5 Dev says `dev`, the wearer answers `wearer`, and speaks again at second 14. */
function promiseScript(dev: string, wearer: string): ScriptLine[] {
  return [
    ...DEV_OPENING,
    { at: 5, who: 'Dev', text: dev },
    { gap: 0.6, who: 'wearer', text: wearer },
    { at: 14, who: 'wearer', text: 'Anyway, good to see you.' },
  ]
}

/** Dev talking on through the wearer's silence (D92: the room's talk never keeps a conversation open). */
const DEV_FILLER = ['The launch went fine.', 'Batch two was late.', 'We need more boxes.', 'Strange weather lately.']

/**
 * D55, D56, D92: the wearer talks with Dev, Priya introduces herself, the
 * wearer promises Dev the deck (ending at second 8 exactly), then says nothing
 * for `silence` seconds while Dev keeps talking, a short line about every 50
 * seconds and once just before the wearer speaks again (short, so the
 * scenario stays cheap: every word is played, the silences skipped).
 */
function quiet(silence: number): ScriptLine[] {
  const back = 8 + silence
  const lines: ScriptLine[] = [
    { at: 0, who: 'wearer', text: 'Hey Dev, how is it going?' },
    { at: 2.5, who: 'Priya', text: "Hi, I'm Priya." },
    { at: 6, who: 'wearer', text: "Dev, I'll send you the deck.", span: 2 },
  ]
  for (let at = 28, i = 0; at < back - 8; at += 50, i++) lines.push({ at, who: 'Dev', text: DEV_FILLER[i % DEV_FILLER.length]! })
  lines.push({ at: back - 4, who: 'Dev', text: 'Anyway, that is my week.', span: 2 })
  lines.push({ at: back, who: 'wearer', text: 'Sorry, where were we?' })
  return lines
}

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

  // P1b.

  // D43: Priya, Marcus and Dana introduce themselves; the wearer promises Dev
  // the deck and an intro to Sam; Dev promises the agenda (held from P2a).
  'held-page': [
    { at: 0, who: 'wearer', text: 'Hi everyone, good to see you all.' },
    { at: 3, who: 'Priya', text: "Hi, I'm Priya." },
    { gap: 0.8, who: 'Marcus', text: 'My name is Marcus.' },
    { gap: 0.8, who: 'Dana', text: 'Dana, nice to meet you.' },
    { gap: 2, who: 'wearer', text: "Dev, I'll send you the deck." },
    { gap: 1, who: 'wearer', text: "And I'll introduce you to Sam." },
    { gap: 1, who: 'Dev', text: "Great, I'll send you the agenda." },
    { gap: 1, who: 'wearer', text: 'Perfect, thanks.' },
  ],
  // D55 and D56 (as D92 reads them): nine minutes, and ten minutes and one second, of the wearer's silence.
  'quiet-9min': quiet(540),
  'quiet-10min1s': quiet(601),
  // D52: twenty minutes with Dev (the wearer speaks every four minutes, so
  // quiet never ends it), Priya at the start, the promise; the long-press
  // comes at 1200 s. Then Dana introduces herself before the wearer speaks
  // (no conversation is open, so she is not caught), the wearer speaks, and
  // Marcus introduces himself in the new conversation.
  'long-press': [
    { at: 0, who: 'wearer', text: 'Hey Dev, thanks for making the time.' },
    { at: 3, who: 'Priya', text: "Hi, I'm Priya." },
    { gap: 1, who: 'wearer', text: "Dev, I'll send you the deck tonight." },
    { at: 240, who: 'wearer', text: 'So where does the budget stand?' },
    { gap: 1, who: 'Dev', text: 'Still waiting on finance.' },
    { at: 480, who: 'wearer', text: 'And the hiring plan?' },
    { gap: 1, who: 'Dev', text: 'Two more people by spring.' },
    { at: 720, who: 'wearer', text: 'What about the office move?' },
    { gap: 1, who: 'Dev', text: 'Pushed to the summer.' },
    { at: 960, who: 'wearer', text: 'Okay, that helps a lot.' },
    { at: 1190, who: 'wearer', text: 'Anyway, that is all I had.' },
    { at: 1203, who: 'Dana', text: "Hi, I'm Dana." },
    { at: 1209, who: 'wearer', text: 'Oh, hello again.' },
    { at: 1212, who: 'Marcus', text: "Hi, I'm Marcus." },
  ],
  // The operator's P1b carry (a): the wearer gives their name, Priya
  // introduces herself, the lens loses its socket at about 6 s and comes back;
  // then Marcus names the wearer and himself.
  blip: [
    { at: 0, who: 'wearer', text: "Hi, I'm Linus." },
    { at: 2, who: 'Priya', text: "Hi, I'm Priya." },
    { at: 10, who: 'Marcus', text: 'Everyone, this is Linus.' },
    { gap: 0.6, who: 'Marcus', text: "And I'm Marcus." },
    { gap: 1, who: 'wearer', text: 'Good to see you.' },
  ],

  // P3, the dropped thread (D35, D48-D50, D33, D36, D34, D120).

  // D35: Priya introduces herself, Dev asks a question, the wearer starts to
  // answer and stops mid-sentence; Dev cuts in for about six seconds, then
  // nobody speaks for fifteen (the wearer looks back at the lens), and the
  // wearer picks the sentence back up. Also D34's line, and D120's thread
  // with Priya held below it.
  'dropped-thread': [
    { at: 0, who: 'wearer', text: 'Morning, everyone.' },
    { gap: 1, who: 'Priya', text: "Hi, I'm Priya." },
    { gap: 1, who: 'Dev', text: 'So why did you pick this vendor?' },
    { gap: 0.6, who: 'wearer', text: 'There are two reasons for this. The first is cost, and the second reason is' },
    { gap: 0.5, who: 'Dev', text: 'Sorry, can I ask a quick question about the cost part first? How much was it?' },
    { gap: 15, who: 'wearer', text: 'The second reason is cost.' },
  ],
  // D49: "and that's why we chose it", a pause with nobody speaking, "Well, the"; Dev cuts in.
  'thread-continuous': [
    { at: 0, who: 'wearer', text: 'Morning, Dev.' },
    { gap: 0.8, who: 'Dev', text: 'Morning! Why did you go with this one?' },
    { gap: 0.6, who: 'wearer', text: "It was the cheapest, and that's why we chose it." },
    { gap: 1.2, who: 'wearer', text: 'Well, the' },
    { gap: 0.5, who: 'Dev', text: 'Hold on, before you go on, can I ask about the price?' },
    { gap: 15, who: 'wearer', text: 'Sure, go ahead.' },
  ],
  // D50: the same, but Dev says "Makes sense." between, which ends the wearer's run.
  'thread-across-turn': [
    { at: 0, who: 'wearer', text: 'Morning, Dev.' },
    { gap: 0.8, who: 'Dev', text: 'Morning! Why did you go with this one?' },
    { gap: 0.6, who: 'wearer', text: "It was the cheapest, and that's why we chose it." },
    { gap: 0.6, who: 'Dev', text: 'Makes sense.' },
    { gap: 0.6, who: 'wearer', text: 'Well, the' },
    { gap: 0.5, who: 'Dev', text: 'Hold on, before you go on, can I ask about the price?' },
    { gap: 15, who: 'wearer', text: 'Sure, go ahead.' },
  ],
  // D33: the wearer finishes the sentence; Marcus starts a second and a half later and talks for over three seconds.
  'normal-turn': [
    { at: 0, who: 'wearer', text: 'Morning, Marcus.' },
    { gap: 0.8, who: 'Marcus', text: 'Morning! Why did you go with this one?' },
    { gap: 0.6, who: 'wearer', text: "It was the cheapest, and that's why we chose it." },
    { gap: 1.5, who: 'Marcus', text: 'That makes sense, we did the same thing last year with ours.' },
    { gap: 2, who: 'wearer', text: 'Good to hear.' },
  ],
  // D36: the wearer stops mid-sentence to find a word; five minutes pass with nobody speaking; the wearer goes on.
  'thinking-pause': [
    { at: 0, who: 'wearer', text: 'Morning, Dev.' },
    { gap: 0.8, who: 'Dev', text: 'Morning! Why this vendor?' },
    { gap: 0.6, who: 'wearer', text: 'Two reasons. The first is cost, and the second reason is' },
    { gap: 300, who: 'wearer', text: 'speed, mostly.' },
  ],

  // P2a, the wearer's promises (D89, D90, D47): Dev introduces himself, his
  // line has faded by second 5, he says one thing, the wearer answers, and the
  // wearer speaks again at second 14, after any line has come and gone.
  'promise-deck': promiseScript('Are you free tonight?', "I'll send you the deck tonight."),
  'promise-sam': promiseScript('Do you know anyone in hiring?', "I'll intro you to Sam."),
  'promise-budget': promiseScript('Can you send me the budget by Friday?', "Yeah, I'll do it."),
  'think-about-it': promiseScript('Would you join the Tuesday meeting?', "I'll think about it."),

  // P2a, the phone handoff. D117: two promises of the wearer's and one of
  // Dev's, then the wearer says nothing (the scenario lets ten minutes pass).
  handoff: [
    ...DEV_OPENING,
    { at: 5, who: 'Dev', text: 'Are you free tonight?' },
    { gap: 0.6, who: 'wearer', text: "I'll send you the deck tonight." },
    { gap: 2, who: 'wearer', text: "I'll intro you to Sam." },
    { gap: 1, who: 'Dev', text: "Great, I'll send you the agenda." },
  ],
  // D28: five promises of the wearer's and two of Dev's; the scenario ends the conversation.
  'long-list': [
    ...DEV_OPENING,
    { at: 5, who: 'Dev', text: 'Are you free tonight?' },
    { gap: 0.6, who: 'wearer', text: "I'll send you the deck tonight." },
    { gap: 1, who: 'wearer', text: "I'll intro you to Sam." },
    { gap: 1, who: 'wearer', text: "I'll book the room for Thursday." },
    { gap: 1, who: 'wearer', text: "I'll email you the budget." },
    { gap: 1, who: 'wearer', text: "I'll call you on Monday." },
    { gap: 1, who: 'Dev', text: "Great, I'll send you the agenda." },
    { gap: 1, who: 'Dev', text: "And I'll share the notes." },
  ],
  // D51: Priya and Marcus introduce themselves and nobody promises anything; then the wearer says nothing.
  'names-only': [
    { at: 0, who: 'wearer', text: 'Hi everyone, good to see you all.' },
    { at: 3, who: 'Priya', text: "Hi, I'm Priya." },
    { gap: 0.8, who: 'Marcus', text: 'My name is Marcus.' },
    { gap: 0.8, who: 'wearer', text: 'Nice to meet you both.' },
  ],
  // D76: a conversation nobody is named in, with one promise of the wearer's; then the wearer says nothing.
  'one-promise': [
    { at: 0, who: 'wearer', text: 'Morning, how was the trip?' },
    { gap: 0.8, who: 'Ana', text: 'Long, but worth it.' },
    { gap: 0.6, who: 'wearer', text: "Good. I'll book the room for Thursday." },
    { gap: 0.8, who: 'Ana', text: 'Perfect, thanks.' },
  ],
  // D79: two people take turns wearing the one pair (both are the wearer at
  // the mic, `wearer:Ana` being the second), each makes a promise; the
  // scenario ends the conversation.
  'shared-pair': [
    ...DEV_OPENING,
    { at: 5, who: 'wearer', text: "I'll send you the deck tonight." },
    { at: 10, who: 'wearer:Ana', text: "My turn with the glasses. I'll intro you to Sam." },
  ],
}

export const VARIANTS = ['wearer-louder', 'other-louder'] as const
export type Variant = (typeof VARIANTS)[number]

/** Mean word loudness in dBFS per variant; each word gets a deterministic ±1.5 dB jitter. */
export const LOUDNESS: Record<Variant, { wearer: number; other: number }> = {
  'wearer-louder': { wearer: -12, other: -28 },
  'other-louder': { wearer: -26, other: -14 },
}
