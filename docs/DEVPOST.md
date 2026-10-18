# Devpost — Catch (paste-ready)

Fields Devpost asks for, in order. Replace anything in [brackets].

---

**Project name:** Catch

**Elevator pitch (≤200 characters):**
Smart glasses that stay dark until you slip, then hand back what you were about to lose: the name you just heard, the promise you just made, the sentence you were cut off in.

**Challenge:** Even Realities (select it) · **Even Hub app name:** `Catch`

**Links:**
- Code: https://github.com/linusho123/catch
- Demo video: [YouTube link]
- How to try it: the README's "For judges and testers", and the one-page [touch guide](https://github.com/linusho123/catch/blob/main/docs/GESTURES.md)

---

## Inspiration

You forget someone's name five seconds after the handshake. You promise "I'll send you that tonight" and it's gone by the elevator. Someone cuts in, you answer them, and you've lost your second point. You can't glance at your phone mid-conversation without being rude. But the G2 sits in your line of sight, and its microphones sit at your mouth.

## What it does

Catch is **one interaction: it holds what you were about to lose.** Most of the time the lens shows a single dim dot. When something slips, it shows one dim line for a moment, then lets it go:

- **A name:** someone says "Hi, I'm Priya" → `Priya`.
- **A promise you make:** "I'll send you the deck tonight" → `promised · send Priya the deck tonight`.
- **A promise made to you:** "I'll send you the agenda" → `Dev promised · sends the agenda`.
- **The dropped thread:** you stop mid-sentence and someone takes the floor → your last words, `…and the second reason is`, wait until you speak again.

Tap to see the names held; swipe down for the promises; swipe up and tap to keep a conversation; swipe down at the dot to end it. On the phone, Catch's page in the Even app lists your conversations with their promises (tick them off, add one by hand) and, for a kept conversation, a **jogger**: the key points in order, technical terms in bold.

**Quiet by design:** the idle state is one dot at low brightness. There are no notifications, no sounds and no menus. Nothing survives a conversation unless it produced a promise or you kept it; the transcript is deleted when the conversation ends.

## How we built it

- **Even Hub plugin** (TypeScript, Vite, Even Hub SDK 0.0.16): streams the G2's microphone to the server, with Even's per-frame speaker role, and draws what the server sends. The same page is Catch's phone screen in the Even app.
- **Server** (TypeScript on Node, SQLite, on Fly.io): **Deepgram nova-3** streaming speech-to-text, with smart formatting and name keyterms; **Gemini 3.5 Flash-Lite** for promises (inside three seconds) and the jogger (a draft, then a tidy pass checked so it never adds anything that wasn't said).
- **Spec first.** Before the event we wrote the behaviour as Gherkin feature files and a ruled decision docket. During the event every phase went through a pipeline: a builder agent, two independent reviewers, a head reviewer running mutation probes, a fix round with failing tests first, and a gate. Tests never touch the network: fixtures are word timings on a virtual clock, and model calls replay recorded answers.

## Challenges we ran into

- **No glasses until the last morning.** We were waitlisted for a loaner, so everything was built against the Even Hub simulator and a laptop mic, where "whose voice is it?" is a guess by loudness.
- **The real G2 surprised us.** Long-press belongs to the Even OS, so "end the conversation" moved to a swipe down. The glasses' own speaker role worked far better than loudness. Font size is fixed by the firmware, so brightness became the readability lever, tunable from the server without a new build.
- **"Someone cut you off" vs. a normal turn.** It has to tell a real interruption from your pause to think, an "mm-hm", and a normal hand-over: two to three seconds of someone else's continuous speech during your pause.

## Accomplishments we're proud of

- It works on a real G2: names, promises both ways, the dropped thread, keep and the jogger.
- About 1,550 tests, all offline, including mutation probes that had to turn each scenario red.
- Privacy that's built in: transcripts are deleted when the conversation ends and scrubbed from the database file.

## What we learned

[Your words. For example: how much "quiet" matters on a face-worn display, and how different real hardware is from a simulator.]

## What's next

Phone notifications, a pause gesture for the demo build, better name recognition in loud rooms, and tuning on more voices.

## Built with

typescript, node.js, vite, even-hub-sdk, deepgram, gemini, sqlite, fly.io, vitest, gherkin

---

**Disclosure (keep in the submission):** the specification was written before the event; all code was written during it. The code was written by AI coding agents (Claude) directed and reviewed by us, which every commit records as a co-author. Gemini runs on the free tier, under which Google may use the content sent to improve its models.
