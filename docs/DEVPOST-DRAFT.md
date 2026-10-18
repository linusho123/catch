# Devpost draft — Catch (paste and edit)

**Name:** Catch  ·  **Even Hub app name:** Catch  ·  **Challenge:** Even Realities (select it)

## Inspiration
You forget a name five seconds after the handshake. You promise something mid-conversation and it's gone by the elevator. Someone cuts you off and you lose the second reason. You can't glance at a phone mid-sentence without being seen; the G2 sits in your line of sight and its mic sits at your mouth.

## What it does
Catch is one interaction: **it holds what you were about to lose**. It stays dark (one dim dot) until a slip, shows one dim line, and lets it go:
- **A name:** "Hi, I'm Priya" → `Priya`.
- **A promise you make:** "I'll send you the deck tonight" → `promised · send … the deck tonight`.
- **The dropped thread:** you stop mid-sentence and someone takes the floor → `…and the second reason is` waits until you speak again.
Tap to see the names held; swipe down for your promises; long-press to end the conversation. Promises appear afterwards on Catch's own page in the Even app.

## How we built it
- Even Hub plugin (TypeScript, Vite, SDK 0.0.16) streams glasses audio to a TypeScript/Node server on Fly.io.
- Deepgram nova-3 streaming speech-to-text with word timings; Gemini Flash (`gemini-3.5-flash-lite`) detects commitments within three seconds.
- Wearer-versus-others split behind one interface: the SDK's per-frame speaker role, loudness, or the provider's speaker labels.
- The behaviour was specified before the event as Gherkin feature files (45 scenarios) and a ruled docket; during the event every phase went through a pipeline of a builder agent, two independent reviewers, a head reviewer running mutation probes, a fix round with failing-tests-first, and a gate. Tests never call the network: fixtures are pre-transcribed word timings on a virtual clock, model calls replay recorded cassettes.

## Challenges
- We were waitlisted for a G2 loaner, so everything was built and checked on the Even Hub simulator; off the glasses, loudness decides whose voice is whose.
- "Someone cut you off" has to be told apart from a normal turn, a pause to think, and an "mm-hm": two to three seconds of someone else's continuous speech during your pause.

## Accomplishments
- Quiet by design: the idle state is one dot at the lowest brightness; every line is dim and fades.
- Nothing survives a conversation unless it produced a promise; the transcript is deleted at the end.

## What we learned / What's next
- [your words]
- Next: promises owed to you, keep-a-conversation with a jogger summary, pause, restart persistence.

## Built with
TypeScript, Even Hub SDK, Vite, Node.js, SQLite, Deepgram, Gemini, Fly.io, Vitest, Gherkin

## Try it
Install via the Even Hub Beta (send us your Even account email), or run it on the simulator: see `catch/README.md` in the repo.
