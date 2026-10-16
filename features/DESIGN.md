# DESIGN — Catch

The orienting document for the agent that builds Catch, with the human as secondary reader. Highest altitude only: what Catch is, the shape it must keep, and the constraints the build must not cross. Every constraint carries `ruled` (the visionary's, citing the docket entry that fixed it) or `chosen` (the agent's own call). The feature files bind; this document explains. Nobody edits it outside a discussion: the agent holds the pen, every change appends a changelog line naming the ruling that sanctioned it, a `ruled` constraint changes only by the visionary's reversal, and a `chosen` one still takes a discussion. A change with no changelog line is drift.

## Identity

- Catch is an Even G2 app that stays dark while the wearer talks with people and, at the moment they would otherwise lose it, holds one thing on the lens: the name someone just told them, the promise they just made, or the sentence they were in the middle of when cut off. It exists so the wearer stays in the conversation instead of trying to remember. [ruled: D1, D2]
- It is the team's entry for the Even Realities challenge at LA Hacks AI 2026, built from the event's start: finished and demoable at every hour mark after hour four, with a ratified cut order for when the time runs out. [ruled: D118]
- Quiet by design: nothing on the lens but a dim dot unless something has just slipped; one dim line, lower third, a second and a half, then dark. Every catch is shown at the lowest readable brightness, because brightness is the only lever Catch has over what others might glimpse. [ruled: D14]

## Shape

- Four parts: the lens app (an Even Hub plugin running in the Even app's WebView on the phone, driving the glasses' containers and receiving their mic and touch events); a server that hears, judges and writes; a native SwiftUI iPhone app for the phone screens; and a Preact website for computers with the same screens. [ruled: D102, D103]
- The lens is the only surface during a conversation; the phone and the website are the surfaces after it. Nothing done on the phone shows on the lens. [ruled: D61]
- The server is where speech-to-text, the loud-versus-quiet split, the catch detectors, the joggers and the stores live; the lens app streams audio up and draws what comes down. [chosen]
- One wearer per account: a pair of glasses delivers to exactly one phone. [ruled: D79]
- Catch hears English only. [ruled: D78]

## The lens, exactly

- Idle: a single dim dot at the lowest brightness, top right. No dot means Catch cannot hear; a dim dash means the wearer paused it. [ruled: D14]
- Gestures, with two meanings each depending on what is showing: tap opens the held page when only the dot shows and clears any line otherwise; long-press ends the conversation now; swipe up asks to keep the conversation when only the dot shows and scrolls back on a page; swipe down pauses or resumes when only the dot shows, declines the keep prompt, turns the names page to promises, and scrolls. Double-tap is Even's exit. [ruled: D34, D40, D43, D86, D92]
- The held page: names in the order heard, scrolling past twenty, then the promises page, the wearer's own first, then those owed; the page dismisses on a tap or after five seconds. [ruled: D43]
- With automatic cut-off detection switched off by the operator, a tap on the bare dot opens the held page with the wearer's last six words as its first line, so the thread can still be asked for. [ruled: D120]
- The lens never shows two things at once: the newest wins; an unanswered keep prompt returns after the line that displaced it. [ruled: D32, D40]
- The thread is the wearer's most recent continuous run of speech, last six words, never reaching back across someone else's turn. [ruled: D48]
- Glyphs: the dot, the dash, the ellipsis, the middle dot and the down arrow must be confirmed on the real lens font before the demo; Even drops missing glyphs silently. [chosen]

## Conversations

- A conversation ends after ten minutes in which the wearer does not speak, whatever anyone else says, or at once on a long-press; at either end the names clear and the promises go to the phone. A pause freezes the conversation and its timer. [ruled: D92]
- Catch tells the wearer from everyone else by loudness, the mic sitting by the wearer's mouth, or, where loudness does not separate them on the real glasses, by the speech-to-text provider's speaker labels used only for "the wearer or not". It never knows which other person is speaking; every ruling that names another person rests on a name having been caught. [ruled: D119]
- Wearer-versus-others is a near-field energy split by default, with the provider's speaker labels behind the same interface as the fallback, never voice identification; which one runs is the operator's call after the hour-one test on the real glasses, recorded here. The dropped thread's "someone else takes the floor" is continuous other-speech of two to three seconds during the wearer's pause. [chosen]
- A repeated name is a second person only within two minutes; later it is a re-introduction. A timing rule, since identity is out of reach. [ruled: D87]

## The phone and the website

- Three screens and nothing else: a history of conversations newest first, grouped by day, each row with names, time, open count and a kept mark; one screen per conversation with YOU and OWED TO YOU lists, tick boxes, and a link to the jogger; the jogger as one flat list of bullets with the technical terms in bold and the missed-time line where it fell. [ruled: D98, D99, D100]
- The phone receives one notification per conversation that produced promises, written as commands, with a second line for promises owed; a long list is cut off with an ellipsis and opens in full. Promises wait for an unreachable phone however long it takes. [ruled: D28, D38]
- The website is a full second surface with the same three screens and tick-off, on the owner's `webdev_ref` Preact stack (Preact, Vite, TypeScript, Zod, Tailwind); notifications stay on the phone. The screen scenarios are outlines over a surface column, so the website is bound and tested, not assumed. [ruled: D103, D115]
- The native app is a preference, protected as a ruling, not a requirement the build must reconstruct. [ruled: D105]

## What survives, and what is deleted

- Nothing survives a conversation except the wearer's promises, the promises made to the wearer, and the conversations the wearer marked; an unkept conversation's transcript and audio are deleted everywhere, the server included, at the boundary. [ruled: D76]
- During a conversation the transcript is held so the jogger can be written and so a restart loses nothing: names, promises, the keep mark and the transcript so far survive an app or phone restart. [ruled: D73]
- For the hackathon the team is trusted as operator and may read what it hosts. [ruled: D77]
- Consent, where the law requires it, is the wearer's job; Catch gives the people the wearer is with no sign they are heard. [ruled: D85]

## Build order and process

- The cut order, earliest built first: staying dark, names, the held page and the conversation boundary with the Even Beta uploaded; the dropped thread; the wearer's own promises and the notification; shipping (the hosted server, the Beta re-upload, thresholds tuned on the real glasses, the demo video, the tester's README, the Devpost entry naming the Even Hub app); the iPhone app's screens; keep and the jogger; promises owed to the wearer; pause; tick-off on the phone; the website; restart persistence; scrolling past twenty names. Anything unbuilt at the last merge is deferred to the fence, not counted as a failure. [ruled: D118]
- The build follows the aBDD workflow: feature files first, `gherkin-node-test` for linting and parsing them, unit tests under the step bindings, and each phase of the phase plan run through the build-pipeline once the plan exists. Every other technology choice (server language, speech-to-text provider, hosting, the model that judges promises and writes joggers) is the build's, within these constraints. [ruled: D106]
- A quick user guide for the touch vocabulary is a deliverable of the build, outside the glasses. [ruled: D72]
- Streaming speech-to-text with word timings, chosen for the best handling of names on the team's own names Saturday morning; a name line within two seconds, a promise line within three. [chosen]
- One model pass per catch for promises (judge, summarize, keep the time word, fill the object from the other person's last sentence) and one per kept conversation for the jogger; names by pattern on the transcript. [chosen]
- The demo day is captured live. The loud-venue backup, in order: a quieter corner; then, as the last resort, a committed fixture played through the real pipeline to the real glasses, said out loud to the judge as a recording and never passed off as live. [chosen]
- The server is TypeScript on Node with SQLite as its one-file store, so lens, server, website and tests share one language, one typecheck and one set of types. During development it runs on the team's laptop, reached over the shared hotspot; the shipping step moves it to a hosted address with TLS, whitelisted in `app.json`, because the Even brief requires a README a tester can follow after the laptop is closed, and because a WebView served over HTTPS may refuse a plain LAN WebSocket. [chosen]
- No live model call in any test: detectors and the jogger writer go through one client with record-and-replay cassettes committed beside the fixtures; a missing cassette fails loudly; re-recording is by hand behind an environment flag. [chosen]
- Two test lanes: a fast lane (oxlint, one incremental typecheck, unit tests, the current phase's feature files) for every agent inside a phase, and a full lane (everything, including the iOS UI tests and the website's browser run) for the gate alone. The suite is never type-checked twice. [chosen]
- Tests never call the real speech-to-text provider: fixtures are pre-transcribed word timings on a virtual clock, with timing bounds asserted on fixture time; the real provider runs only by hand behind an environment flag. The Even bridge stub is in-process and one server serves each test worker. [chosen]

## Changelog

- 2026-10-15 — initial draft (scope interview; docket D1–D108; electives D102, D103, D106, aliased E1–E3; D105 ladders E1 to a preference).
- 2026-10-15 — after the signed read (D110): the seven held candidates ruled as D111–D117; this doc gains the surface-outline constraint (D115). Nothing else changed.
- 2026-10-15 — two `chosen` constraints on test speed (two lanes; pre-transcribed fixtures on a virtual clock), at the visionary's request after the plan was written. No ruled line touched.
- 2026-10-15 — final pre-build review of the plan: TypeScript server with SQLite on the laptop, and model record-and-replay, added as `chosen`; the plan pre-splits P0, P1 and P2 and runs P3 before the iPhone app. No ruled line touched.
- 2026-10-16 — read against the Even Realities challenge brief. N15 and D118–D120 drafted and signed the same day (D121–D124); four lines changed under them: the entry, not the fallback; the cut order; the split's fallback; the tap fallback for the thread. Two `chosen` lines changed after discussion: the server is hosted with TLS by the shipping step; the loud-venue backup gains a disclosed fixture-driven run as the last resort. One `chosen` line gains the split's fallback interface.
