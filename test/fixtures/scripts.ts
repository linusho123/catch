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
  /**
   * P4, the jogger's far side: the technical terms said in this line, word for
   * word, that a jogger must set in bold (D24, D99); and, for a question, a
   * word a jogger bullet covering it must carry ("the questions raised").
   * Annotations for the steps only: they never reach the server.
   */
  terms?: string[]
  ask?: string
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

/**
 * P6, D81: quiet()'s opening (so the wearer's promise is judged as in the
 * quiet fixtures), then the wearer silent for four minutes while Dev talks;
 * the scenario pauses at PAUSE_FREEZE.pauseAt for twelve minutes, while the
 * wearer and Sam speak (never heard); after the resume Dev talks on and the
 * wearer says nothing, so the conversation ends six minutes later (D92).
 */
export const PAUSE_FREEZE = { pauseAt: 248, resumeAt: 968 }
const PAUSE_FREEZE_LINES: ScriptLine[] = [
  { at: 0, who: 'wearer', text: 'Hey Dev, how is it going?' },
  { at: 2.5, who: 'Priya', text: "Hi, I'm Priya." },
  { at: 6, who: 'wearer', text: "Dev, I'll send you the deck.", span: 2 },
  ...[28, 78, 128, 178, 228].map((at, i) => ({ at, who: 'Dev', text: DEV_FILLER[i % DEV_FILLER.length]! })),
  // Paused from 248 to 968: none of this is heard.
  { at: 300, who: 'wearer', text: "Sorry, I'll take this call." },
  { at: 420, who: 'Sam', text: "Hi, I'm Sam." },
  { at: 600, who: 'Dev', text: 'The boxes came in.' },
  { at: 900, who: 'wearer', text: 'Okay, back again.' },
  // Listening again from 968: Dev talks on, the wearer says nothing.
  ...[1000, 1100, 1200, 1300].map((at, i) => ({ at, who: 'Dev', text: DEV_FILLER[i % DEV_FILLER.length]! })),
]

/** D62's booth chat, before brisk(): `booth-chat`, and `pause-booth` with a pause inside it (P6). */
const BOOTH_CHAT: ScriptLine[] = [
  { at: 0, who: 'wearer', text: 'Hi, what are you showing here?' },
  { at: 2.5, who: 'Marcus', text: "Hi, I'm Marcus." },
  { at: 15, who: 'Marcus', text: 'This rig maps rooms with lidar.', terms: ['lidar'] },
  { at: 40, who: 'wearer', text: 'How accurate is it?', ask: 'accura' },
  { gap: 1, who: 'Marcus', text: 'About two centimeters, thanks to SLAM.', terms: ['SLAM'] },
  { at: 100, who: 'wearer', text: 'Nice, good luck with it.' },
]

/**
 * P6, D86: the booth chat, kept at second 7 and paused from PAUSE_BOOTH.pauseAt
 * to PAUSE_BOOTH.resumeAt, while Sam introduces himself, the wearer and Sam
 * each make a promise and Marcus names a term; none of it may reach the lens,
 * the held pages or the jogger, which is the booth chat's own.
 */
export const PAUSE_BOOTH = { pauseAt: 18, resumeAt: 36, words: ['Sam', 'specs', 'brochure', 'Jetson'] }
const PAUSE_BOOTH_LINES: ScriptLine[] = [
  ...BOOTH_CHAT.slice(0, 3),
  { at: 21, who: 'Sam', text: "Hi, I'm Sam." },
  { at: 24, who: 'wearer', text: "I'll email you the specs tonight." },
  { at: 28, who: 'Sam', text: "I'll send you the brochure." },
  { at: 31, who: 'Marcus', text: 'It also runs on Jetson boards.' },
  ...BOOTH_CHAT.slice(3),
]

/**
 * P6, D86: a little talk with Dev, paused from PAUSE_RESUME.pauseAt to
 * PAUSE_RESUME.resumeAt (Dev and the wearer talk on, unheard), then heard again.
 */
export const PAUSE_RESUME = { pauseAt: 6, resumeAt: 15, unheard: ['parking', 'lot'], heard: ['where', 'fine'] }
const PAUSE_RESUME_LINES: ScriptLine[] = [
  { at: 0, who: 'wearer', text: 'So how was the drive in this morning?' },
  { gap: 1, who: 'Dev', text: 'Not bad, the traffic was light for once.' },
  { at: 9, who: 'Dev', text: 'Anyway, the parking was a mess.' },
  { at: 12, who: 'wearer', text: 'Right, the lot was full.' },
  { at: 17, who: 'wearer', text: 'Sorry, where were we?' },
  { gap: 1, who: 'Dev', text: 'The drive in, it was fine.' },
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

/**
 * P4: brisk speech. The keep and jogger fixtures are long conversations whose
 * every word the player must play at the fixture clock's speed, while only
 * their words (never their timing) reach the model, so their lines are spoken
 * at about six words a second to keep the scenarios cheap.
 */
function brisk(lines: ScriptLine[]): ScriptLine[] {
  return lines.map((l) => {
    const words = l.text.split(/\s+/).length
    return l.span === undefined ? { ...l, span: Math.round((0.12 * words + 0.06 * (words - 1)) * 100) / 100 } : l
  })
}

/**
 * P4, the jogger's three-hour workshop (D74, D116): Dana opens, then one
 * specific every eighteen minutes, each its own technical term, with the
 * wearer answering in a word between them at least every ten minutes so quiet
 * never ends it (D92). Sparse on purpose: every word is played, the silences
 * skipped, so three hours stay cheap.
 */
const WORKSHOP: ScriptLine[] = (() => {
  const specifics: [text: string, term: string][] = [
    ['First, every service runs on Kubernetes.', 'Kubernetes'],
    ['We package each one with Helm charts.', 'Helm charts'],
    ['Traffic between them goes through Istio.', 'Istio'],
    ['New versions ship as canary deployments.', 'canary deployments'],
    ['Metrics are scraped by Prometheus.', 'Prometheus'],
    ['Traces are collected with OpenTelemetry.', 'OpenTelemetry'],
    ['Dashboards live in Grafana.', 'Grafana'],
    ['Secrets are stored in Vault.', 'Vault'],
    ['Each quarter we run chaos engineering drills.', 'chaos engineering'],
    ['Load spikes are handled by horizontal autoscaling.', 'horizontal autoscaling'],
  ]
  const lines: ScriptLine[] = [
    { at: 0, who: 'wearer', text: 'Morning, is this the platform workshop?' },
    { at: 3, who: 'Dana', text: "Hi, I'm Dana. Welcome, let's begin." },
  ]
  specifics.forEach(([text, term], i) => {
    const at = 300 + i * 1080
    lines.push({ at, who: 'Dana', text, terms: [term] })
    lines.push({ gap: 1, who: 'wearer', text: 'Got it.' })
    lines.push({ at: at + 540, who: 'wearer', text: 'Okay.' })
  })
  lines.push({ at: 10_740, who: 'Dana', text: "That's everything, thanks for staying." })
  lines.push({ gap: 1, who: 'wearer', text: 'Thanks, Dana.' })
  return brisk(lines)
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
  // Marcus introduces himself in the new conversation. Brisk (P4): it is
  // played to its twentieth minute, kept, and its jogger written.
  'long-press': brisk([
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
  ]),
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
  // D132, promises.feature row 1: Dev's "meet Priya" names her (D18), her
  // name's line fades, then Priya introduces herself: one person.
  'meet-priya': [
    ...DEV_OPENING,
    { at: 5, who: 'Dev', text: 'Come and meet Priya.' },
    { at: 9, who: 'Priya', text: "Hi, I'm Priya." },
    { at: 14, who: 'wearer', text: 'Anyway, good to see you.' },
  ],

  // P5, promises owed to the wearer (D91, D26, D113, D32). Each has the
  // promise come after any line before it has faded, and the wearer speak
  // again after any line has come and gone.
  // promises.feature row 3: Dev, caught at the start, says "About that deck."
  // and then promises it.
  'owed-deck': [
    ...DEV_OPENING,
    { at: 5, who: 'Dev', text: 'About that deck.' },
    { gap: 0.6, who: 'Dev', text: "I'll send you the deck tonight." },
    { at: 14, who: 'wearer', text: 'Anyway, good to see you.' },
  ],
  // D91: the wearer promises Dev the deck tonight (as in promise-deck), then Dev promises the agenda.
  'owed-agenda': [
    ...DEV_OPENING,
    { at: 5, who: 'Dev', text: 'Are you free tonight?' },
    { gap: 0.6, who: 'wearer', text: "I'll send you the deck tonight." },
    { at: 13, who: 'Dev', text: "I'll send you the agenda." },
    { at: 20, who: 'wearer', text: 'Anyway, good to see you.' },
  ],
  // D26, D113: nobody has introduced themselves when Dev promises the deck;
  // the wearer answers; at second 20 Dev gives his name.
  'owed-unnamed': [
    { at: 0, who: 'wearer', text: 'Morning, how was the trip?' },
    { gap: 0.8, who: 'Dev', text: 'Long, but worth it.' },
    { at: 5, who: 'Dev', text: "I'll send you the deck tonight." },
    { at: 14, who: 'wearer', text: 'Sounds good.' },
    { at: 20, who: 'Dev', text: "By the way, I'm Dev." },
    { gap: 1, who: 'wearer', text: 'Nice to meet you, Dev.' },
  ],
  // D113: two unnamed people promise, Ana the deck, then Dev the slides; then Dev gives his name.
  'owed-two': [
    { at: 0, who: 'wearer', text: 'Morning, everyone.' },
    { at: 2, who: 'Ana', text: "I'll send you the deck tonight." },
    { at: 6, who: 'wearer', text: 'Thanks.' },
    { at: 8, who: 'Dev', text: "I'll send you the slides." },
    { at: 12, who: 'wearer', text: 'Great.' },
    { at: 17, who: 'Dev', text: "By the way, I'm Dev." },
    { gap: 1, who: 'wearer', text: 'Nice to meet you, Dev.' },
  ],
  // holding.feature, the promises page with two promises made and one owed:
  // Dev introduces himself, the wearer promises him the deck and an intro to
  // Sam, Dev promises the agenda.
  'owed-page': [
    ...DEV_OPENING,
    { at: 4, who: 'wearer', text: "Dev, I'll send you the deck." },
    { gap: 1, who: 'wearer', text: "And I'll introduce you to Sam." },
    { gap: 1, who: 'Dev', text: "Great, I'll send you the agenda." },
    { gap: 1, who: 'wearer', text: 'Perfect, thanks.' },
  ],
  // D32: the scenario taps at second 3.5 (Dev's line has faded); while the
  // names page is up, Dev promises the deck.
  'newest-wins': [
    ...DEV_OPENING,
    { at: 5, who: 'Dev', text: "I'll send you the deck." },
    { at: 14, who: 'wearer', text: 'Anyway, good to see you.' },
  ],

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
  // PT, the latency test (test/integration/latency.test.ts): Priya gives her
  // name in the middle of one long continuous turn (no pause a provider could
  // finalize at, for nine seconds); then the wearer promises with no closing
  // punctuation, pauses, and goes on, so only the pause ends the sentence.
  'long-turn': [
    { at: 0, who: 'wearer', text: 'Hey, good to see you again.' },
    {
      gap: 0.8,
      who: 'Priya',
      text: "So we drove down this morning and the traffic was terrible the whole way here but anyway yeah I'm Priya and I run the robotics lab upstairs with a few of the grad students",
    },
    { gap: 0.8, who: 'wearer', text: "Sure I'll send you the deck tonight" },
    { gap: 1.5, who: 'wearer', text: 'Anyway, how long are you in town?' },
    { gap: 0.8, who: 'Priya', text: 'Until Sunday.' },
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

  // P4, keep and the jogger (D40-D42, D54, D24, D62, D74, D116, D53, D99).

  // D41: the wearer and Dev talk; the scenario swipes up at second 3; Dev asks
  // the wearer something at second 5 and they talk on for forty seconds, the
  // wearer finishing every sentence (no thread) and promising nothing.
  'keep-distraction': brisk([
    { at: 0, who: 'wearer', text: 'Morning, Dev.' },
    { gap: 0.6, who: 'Dev', text: 'Morning!' },
    { at: 5, who: 'Dev', text: 'Quick question, when does the new schedule come out?' },
    { gap: 0.8, who: 'wearer', text: 'Next week, as far as I know.' },
    { at: 20, who: 'Dev', text: 'Okay, and does it change the Friday review?' },
    { gap: 0.8, who: 'wearer', text: 'No, that stays at noon.' },
    { at: 38, who: 'Dev', text: 'Good, the team will be glad.' },
    { gap: 0.8, who: 'wearer', text: 'Me too.' },
  ]),
  // D24, D99: a twenty-five-minute call with Ana about joining her lab. The
  // scenario keeps it at second 7 and long-presses at 25:00; the wearer speaks
  // at least every ten minutes, so quiet never ends it (D92). The wearer's
  // promise comes before the last question and term, so a jogger that moved
  // the promise to the end would be out of order (P4 fix round, head-1).
  'lab-call': brisk([
    { at: 0, who: 'wearer', text: 'Hi, thanks for taking the call.' },
    { at: 2.5, who: 'Ana', text: "Hi, I'm Ana." },
    { at: 60, who: 'Ana', text: 'My lab designs proteins with diffusion models.', terms: ['diffusion models'] },
    { at: 90, who: 'wearer', text: 'How do you validate the designs?', ask: 'validate' },
    { gap: 1, who: 'Ana', text: 'We screen them with AlphaFold, then cryo-EM.', terms: ['AlphaFold', 'cryo-EM'] },
    { at: 300, who: 'wearer', text: 'What would my first project be?', ask: 'project' },
    { gap: 1, who: 'Ana', text: 'Extending our equivariant transformer to small molecules.', terms: ['equivariant transformer'] },
    { at: 600, who: 'wearer', text: 'Is there funding for the summer?', ask: 'funding' },
    { gap: 1, who: 'Ana', text: 'Yes, from our NSF grant.' },
    { at: 900, who: 'wearer', text: "I'll send you my transcript by Friday." },
    { at: 1180, who: 'wearer', text: 'What should I read first?', ask: 'read' },
    { gap: 1, who: 'Ana', text: 'Start with our paper on inverse folding.', terms: ['inverse folding'] },
    { gap: 1, who: 'Ana', text: 'Great, talk soon.' },
  ]),
  // D62: a two-minute chat at a booth, kept at second 7, long-pressed at 2:00.
  'booth-chat': brisk(BOOTH_CHAT),
  // P6 (D86, D81): the pause's three scenarios.
  'pause-booth': brisk(PAUSE_BOOTH_LINES),
  'pause-resume': PAUSE_RESUME_LINES,
  'pause-freeze': PAUSE_FREEZE_LINES,
  // D74, D116: a three-hour workshop, kept at second 7, long-pressed at 3:00:00.
  workshop: WORKSHOP,
  // D53: kept at second 4; Catch cannot hear from second 20 to second 260 (the
  // scenario drops the speech-to-text provider and brings it back), and what
  // Marcus says meanwhile is never heard; the scenario long-presses at 300 s.
  'kept-gap': brisk([
    { at: 0, who: 'wearer', text: 'Morning, Marcus.' },
    { at: 6, who: 'Marcus', text: 'We moved the API to GraphQL last month.', terms: ['GraphQL'] },
    { gap: 1, who: 'wearer', text: 'How did the migration go?', ask: 'migration' },
    { at: 100, who: 'Marcus', text: 'The Redis cache was the hard part.' },
    { at: 270, who: 'wearer', text: 'Sorry, I lost you for a bit.' },
    { gap: 1, who: 'Marcus', text: 'No problem. Next we try gRPC streaming.', terms: ['gRPC'] },
    { gap: 1, who: 'wearer', text: 'Sounds good.' },
  ]),
  // P9, D73: a kept conversation, kept at second 7, in which Priya, Dev and
  // Ana introduce themselves and the wearer makes two promises; the wearer
  // last speaks before the restart at 882 s. The Even app is killed at 900 s
  // (fifteen minutes in) and Catch is back at 960 s: what Dev says at 920 s is
  // never heard. The wearer speaks again at 1000 s, after the scenario's taps
  // and swipes, and the scenario long-presses at 1010 s.
  restart: brisk([
    { at: 0, who: 'wearer', text: 'Thanks for making the time, everyone.' },
    { at: 2.5, who: 'Priya', text: "Hi, I'm Priya." },
    { at: 30, who: 'Dev', text: "Hi, I'm Dev." },
    { at: 60, who: 'Priya', text: 'We rank the results with LightGBM.', terms: ['LightGBM'] },
    { gap: 1, who: 'wearer', text: "I'll send you the benchmark numbers tonight." },
    { at: 200, who: 'Ana', text: "Hi, I'm Ana." },
    { at: 300, who: 'wearer', text: 'How do you serve the model?', ask: 'serve' },
    { gap: 1, who: 'Ana', text: 'Behind Triton on two GPUs.', terms: ['Triton'] },
    { at: 600, who: 'wearer', text: "I'll introduce you to Sam." },
    { at: 880, who: 'Dev', text: 'Next quarter the data moves to Snowflake.', terms: ['Snowflake'] },
    { gap: 1, who: 'wearer', text: 'Makes sense.' },
    { at: 920, who: 'Dev', text: 'Our Kubernetes bill doubled in March.' },
    { at: 1000, who: 'wearer', text: 'Sorry, I lost you for a minute.' },
    { gap: 1, who: 'Dev', text: 'No problem. The logs go to Parquet now.', terms: ['Parquet'] },
    { gap: 1, who: 'wearer', text: 'Sounds good.' },
  ]),
  // D100, the history on the phone: three conversations in one day and a
  // bit. Fixture second 0 is yesterday at 4:00 pm (the scenario sets the
  // clock there): Marcus, kept at second 7; quiet ends it at 4:10. Today at
  // 9:05 am (17 h 5 min on) Priya, with a promise; at 2:10 pm (22 h 10 min
  // on) Dev, with a promise; quiet ends each.
  'history-day': brisk([
    { at: 0, who: 'wearer', text: 'Hey, got a minute?' },
    { at: 2.5, who: 'Marcus', text: "Hi, I'm Marcus." },
    { at: 12, who: 'Marcus', text: 'We moved the build to Bazel.', terms: ['Bazel'] },
    { gap: 1, who: 'wearer', text: 'Nice, that should help.' },
    { at: 61_500, who: 'wearer', text: 'Morning, good to see you.' },
    { at: 61_502.5, who: 'Priya', text: "Hi, I'm Priya." },
    { at: 61_506, who: 'wearer', text: "I'll send you the slides." },
    { at: 79_800, who: 'wearer', text: 'Hey, how did it go?' },
    { at: 79_802.5, who: 'Dev', text: "Hi, I'm Dev." },
    { at: 79_806, who: 'wearer', text: "I'll call you on Monday." },
  ]),
}

export const VARIANTS = ['wearer-louder', 'other-louder'] as const
export type Variant = (typeof VARIANTS)[number]

/** Mean word loudness in dBFS per variant; each word gets a deterministic ±1.5 dB jitter. */
export const LOUDNESS: Record<Variant, { wearer: number; other: number }> = {
  'wearer-louder': { wearer: -12, other: -28 },
  'other-louder': { wearer: -26, other: -14 },
}
