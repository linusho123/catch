# Build plan — Catch

The reviewed contract is `catch/features/`: seven feature files (44 scenarios, 10 outlines), `OUT-OF-SCOPE.md` (the fence), `USER-NEEDS.md` (the ledger), `DESIGN.md` (bounds the build) and `DOCKET.md` (D1–D117, signed at D110; D111–D117 ruled after the read). The feature files bind, `DESIGN.md` bounds, the ledger explains. Written 2026-10-15; **no application code exists or may exist before Saturday, October 17, 12:00 PM PDT.** This plan is the last planning artifact.

Every agent that runs a phase reads this file itself. It is written so that a model with no other context (Opus or Sonnet, cold) can run its phase from this file plus the repository.

## Who runs what

- **Operator:** the human (Linus) in the main Claude Code session. The operator runs `/build-pipeline <phase>` one phase at a time, answers questions, integrates, and gives the go-ahead for the next phase. The operator never builds. **Pre-authorization:** the operator may, in writing in the phase's notes, authorize up to two further phases ("if this ships, continue through P1b and P2a"); the main session still integrates, stores the pointer and reports between them, and stops at the first block, question, or the end of the authorization. This keeps the pipeline moving while the operator sleeps.
- **Models.** Builder, head reviewer and fixer: **Opus** (`claude-opus-5-5`). The two cold reviewers, the verifier's default (the `head` role; override to Sonnet if the operator wants a cheaper verify) and the gate: **Sonnet** (`claude-sonnet-5-5`). **Fable is never a first choice:** it is reserved for a specific problem the operator names (a stuck phase after two block verdicts, or a review the operator asks for by hand), never for a scheduled role. Pass the overrides on every run so the defaults never apply silently:

      /build-pipeline P1 models={"builder":"claude-opus-5-5","reviewer":"claude-sonnet-5-5","head":"claude-opus-5-5","fixer":"claude-opus-5-5","gate":"claude-sonnet-5-5"}

- **Context budget (main session).** The main session holds only verdicts, never diffs or reviews. After every phase it stores a treecontext resume pointer (`treecontext_insert` with `metadata {"kind":"plan","next_session":true,"status":"active"}`, `supersedes: [the previous pointer]`) naming: the phase just merged, its commit, the next phase, and any open questions. **When the session's context use passes 850,000 tokens of its 1,000,000, it writes a chapter summary as the resume pointer and stops**, so the operator can `/clear`; it must not start a phase it cannot finish under 900,000. A fresh session re-orients from `treecontext_status` and continues at the phase the pointer names.
- **Reserved files** (no agent edits them; a needed change goes to the operator as a question): `features/*.feature`, `features/DOCKET.md`, `features/OUT-OF-SCOPE.md`, `features/USER-NEEDS.md`, and every `[ruled: …]` line in `features/DESIGN.md`. The `wip` register only shrinks.

## Process, every phase

1. **Cold builder** (Opus) on branch `pN-<name>` cut from `main`, with this plan as its brief. It builds the phase and nothing beyond it, binds the phase's scenarios with far-side assertions, runs a mutation probe for every newly bound scenario group (break the app so that group must turn red, confirm it does, restore), runs the full suite, commits on the branch. Ambiguity in the contract goes into `openQuestions`, never into a guess.
2. **Two independent cold reviewers** (Sonnet), read-only, neither seeing the other or the builder's report: one on contract fidelity and test honesty (the `/audit` rubric at `~/gitrepos/gherkin-node-test/plugins/audit/skills/audit/rubric.md`), one on the phase's named risk ("Second reviewer's focus" below).
3. **Head reviewer as integrator** (Opus): confirms or rejects every finding against the code, runs its own probes, produces `mustFix`, `questions`, and a verdict (ship / fix / block).
4. **One fix round** (Opus): a failing test before each fix; a surviving probe is fixed by strengthening the binding, never by rewording a scenario. Then a **fresh verifier** checks each fix's test fails before and passes after, and that nothing outside the findings changed.
5. **Gate** (Sonnet runs the commands; exit codes as reported): the phase's gate commands below, in order. A red gate blocks.

**Two test lanes, so the suite is not run six times at full cost.** Every agent inside a phase (builder, reviewers' probes, head reviewer, fixer, verifier) runs the **fast lane**, `npm run test:fast`: oxlint, an incremental typecheck, the unit tests, and only the feature files this phase binds (`FEATURES=<files> npm run test:fast`). Only the **gate** runs the **full lane**, `npm test`: everything in TypeScript. The iOS UI tests (`npm run test:ios`, simulator) and the website's Playwright run (`npm run test:web`) are **separate gate commands run only by phases that touch `apps/ios/` or `apps/web/`**; a simulator boot in every gate would cost more than the phases it guards. A probe is run against the fast lane; the gate confirms nothing else regressed. P0 defines both lanes; no later phase may fold the full lane into the fast one.
6. **Integrate** (main session): merge to `main`, push, commit the run manifest, store the treecontext resume pointer, report the verdict and attribution, **stop for the operator's go-ahead**. Never start the next phase unprompted.

Questions for the visionary raised during a phase are put to them before the fix round closes, never answered by an agent.

## Acceptance bars, every phase

- **Far-side assertions.** A "the wearer sees" step binds to what the Even bridge was actually sent for the glasses: the last page or text payload (container ids, text, brightness level) captured at the SDK boundary in the simulator or the test harness, never a flag the app set about itself. "The SDK call returned success" is not the lens showing anything (Even: success means accepted, not displayed). A "the phone shows a notification" step binds to the notification the OS received (the test harness's captured notification request), never to the app's own log. "The team, reading the server, finds no transcript" binds to a direct read of the store, never to the API whose job is to delete.
- **Mutation-checking.** For every bound scenario group a deliberately broken app turns it red; probes are listed in the builder's report and the head reviewer re-runs a sample.
- **Two fixtures for the loud-versus-quiet split.** Every phase that touches the wearer/other split (P1, P2, P3, P5) runs its probes on two audio fixtures: one where the wearer is louder (the normal case) and one where the other person is louder. A binding that goes green only on the first is half-lit.
- **The fence holds.** Nothing in `OUT-OF-SCOPE.md` gets built: no battery work, no speaker identification, no un-keep from the glasses, no names to the phone, no compliance machinery.
- **Numbers come from the rulings.** Two seconds for a name line, three for a promise line, a second and a half of dwell, five seconds of page, ten minutes of the wearer's silence, two minutes for the repeated-name window, thirty seconds or a few minutes for a jogger. A build that needs a different number asks the operator; it does not pick one.
- **Register.** A feature file leaves `wip` only when every scenario in it is bound; outline rows a later phase binds are held by scenario-scoped `wip`. The run manifest (`{"run-manifest":1}`) is committed every phase.
- **No live model calls in tests.** The promise detector, the introduction detector's model fallback and the jogger writer go through one client with **record and replay**: responses are keyed by a hash of the prompt and stored as committed cassettes under `test/cassettes/`; the lanes replay and never call the network; `CATCH_REAL_LLM=1` re-records by hand when a prompt changes, and a missing cassette fails the test loudly instead of calling out. The same rule as the speech-to-text fixtures, for the same reason: a live model in the suite is slow, flaky and costs money on every probe.
- **Tests are cheap by construction.** No scenario calls the real speech-to-text provider: fixtures are **pre-transcribed word-timing JSON** committed beside their audio, and the fixture player feeds words to the server on a **virtual clock** at up to twenty times real time; the two-second and three-second bounds are asserted on fixture time, not wall time. The real provider runs only behind `CATCH_REAL_STT=1`, by hand or nightly, never in a lane. The Even bridge stub is in-process. The server under test starts once per test worker, not once per scenario. A scenario that takes longer than two seconds in the fast lane is a finding for the reviewer with the risk lens.

## Architecture the phases assume (from DESIGN.md; the build's choices are marked)

- `apps/lens/`: the Even Hub plugin (TypeScript + Vite + `@evenrealities/even_hub_sdk`, started from Even's `asr` template). It streams glasses audio to the server over a WebSocket, draws what the server sends (one dim line, pages, the dot, the dash), and forwards touch events. Origins whitelisted in `app.json`; CORS on the server. Packaged as `.ehpk` for Even Beta in P1.
- `server/`: one **TypeScript (Node)** process, chosen here so that lens, server, website and tests share one language, one `tsc -b`, one Vitest and one set of types (Python bought nothing once the Fetch.ai layer was cut; recorded as `chosen` in DESIGN.md). It runs streaming speech-to-text with word timings, the near-field energy split (wearer vs others), the three catch detectors, the conversation state machine, the jogger writer, the store (SQLite, one file) and the notification sender. **It runs on the team's laptop for the whole event**, reached by the phone over the shared hotspot's LAN; a cloud deploy is never on the critical path and is done only if time remains after P8. The speech-to-text provider is chosen before noon Saturday in the providers' web consoles (no code), on recordings of the team's own names.
- `apps/ios/`: native SwiftUI (D102): history, conversation, jogger; notifications; tick-off. Client generated from the server's OpenAPI document.
- `apps/web/`: Preact (D103, `webdev_ref` Blueprint A): the same three screens with tick-off.
- `test/`: gherkin-node-test runs `features/` with step bindings in `steps/`; a lens harness that stubs the Even bridge and records every payload; an audio fixture player; a notification capture; a store reader.

## Pre-event checklist (setup, not code; done before Saturday noon)

- Even Hub developer account; `@evenrealities/evenhub-cli` and the simulator installed; a G2 loaner application ready to file Saturday 9:00–12:00 (one per team).
- Speech-to-text provider accounts for two candidates, keys in a password manager, not in the repo.
- Xcode installed and signed in; the answer to "paid Apple developer account?" known; the team's iPhones on the current iOS.
- A hosted server target reachable from the venue (plus a phone hotspot); the laptop's LAN IP is what the glasses connect to during development.
- This repository cloned on every build machine; `npm run validate` green in `catch/`.
- **Permission allowlist** in the build machine's Claude Code settings (`npm`, `npx`, `node`, `git`, `xcodebuild`, `xcrun simctl`, `swift`, `caffeinate`, the test commands), so no agent stalls on a prompt at 3 a.m. (`/fewer-permission-prompts` or by hand; this is configuration, not code).
- **Caches warmed on the venue's slow Wi-Fi's behalf:** `npm cache` primed by installing the pinned `webdev_ref` Blueprint A set, `vitest`, `gherkin-node-test`, `@evenrealities/even_hub_sdk` and the Even CLI into a scratch directory that is then deleted; Playwright's Chromium downloaded; the iOS simulator runtime downloaded in Xcode; one Xcode build of an empty template project discarded afterwards so the toolchain is exercised.
- **Audio fixtures recorded** (data, not code): the introduction round (Priya, Marcus, Dana, two Priyas within two minutes, a late re-introduction), the promise lines (with and without a time word, "I'll think about it", "Yeah, I'll do it" after a question), the cut-off dialogue (a real interruption, a normal turn, a one-second "mm-hm", a silent pause) and the wearer's own "Hi, I'm Linus", each recorded twice: wearer louder at the mic, and the other person louder. Saved as 16 kHz mono WAV with a one-line script per file. Transcribing them is P0's first job.
- **Two speech-to-text providers compared in their web consoles** on those recordings, winner noted with its retention setting.
- **Pre-decided so P0 never asks:** server in TypeScript; SQLite as the store; the fixture clock; the cassette rule. These are the plan's `chosen` constraints.
- Nothing else: no scaffold, no step files, no Xcode project.

## Schedule

The fallback is triggered when the team abandons the main idea; call that T. The cut order (D104) is the phase order. Hours are agent wall-clock estimates with Opus building; the operator's own time is answering questions and go-aheads.

Phases are sized to stay under the pipeline's 400-changed-line review cap; an oversized diff degrades both reviews and lengthens the fix round, so a small phase is faster than a big one even though it costs a run. P0, P1 and P2 are therefore pre-split into two pipeline runs each, in the same cut-order position.

| Phase | Builds | Hours | Cumulative | Demo-able after? |
|---|---|---|---|---|
| P0a | scaffold, lanes, server skeleton, speech-to-text wired, fixtures transcribed | 1.0 | 1.0 | no |
| P0b | the test harness (bridge stub, fixture clock, cassettes, captures), lane timing proof | 1.0 | 2.0 | no |
| P1a | staying dark and names on the lens | 1.5 | 3.5 | **yes: names alone** |
| P1b | the held page, the conversation boundary, the Even Beta package | 1.25 | 4.75 | yes |
| P2a | own promises, the notification semantics, deletion (server and lens; the harness receives the notification) | 1.5 | 6.25 | yes, on the lens |
| P3 | dropped thread | 1.5 | 7.75 | the full lens demo |
| P2b | the iPhone app: sign-in, history, conversation screen, notifications | 2.0 | 9.75 | the phone demo |
| P4 | keep and the jogger | 1.5 | 11.25 | yes |
| P5 | promises owed to the wearer | 0.75 | 12.0 | yes |
| P6 | pause | 0.5 | 12.5 | yes |
| P7 | tick-off on the phone | 0.5 | 13.0 | yes |
| P8 | the website | 1.5 | 14.5 | yes |
| P9 | restart persistence | 1.0 | 15.5 | yes |
| P10 | scrolling past twenty names | 0.5 | 16.0 | yes |

P3 runs before P2b on purpose: the judges wear the glasses, so the full lens demo (name, promise, thread) is worth more than the phone screens, and P2b's Xcode work must never block it. The hours are agent time; with reviews, fix rounds and the operator's latency, budget **1.5×**. If T is Saturday 20:00: the names demo by about 01:00, the full lens demo by about 06:00, the phone demo by about 09:00; P4–P7 only if the night goes well; P8–P10 are unlikely and are planned for completeness. Whatever is unbuilt at the deadline is recorded under `## Deferred` in `OUT-OF-SCOPE.md` with "(D104, 2026-10-18)" and named in the Devpost as unbuilt. Judging starts 12:30 Sunday; the last merge is 11:00 at the latest, and 11:00–12:00 is the Devpost, the Even Beta upload and the demo rehearsal, not building.

---

## P0a — Scaffold, lanes, server skeleton, speech-to-text

**Contract:** no scenarios bound. Every feature file enters the `wip` register whole.
**Rulings:** D106 (the aBDD workflow), D104 (the order).

**Builds:**
- The repository layout above; `package.json` scripts at the root:
  - `npm run test:fast`: `oxlint`, one incremental typecheck (`tsc --noEmit --incremental` from a single root `tsconfig.json`; project references only if the typecheck passes thirty seconds), the unit tests (`vitest run --project unit`), and gherkin-node-test over the feature files named in `FEATURES` (all of them when unset) with the `wip` register applied. Target: under one minute on a laptop at P1, under two at P10.
  - `npm test`: `npm run lint:features`, the typecheck, every Vitest project, gherkin-node-test over all of `features/`. The gate's lane for every phase.
  - `npm run test:ios` (from P2b; the simulator UI tests) and `npm run test:web` (from P8; the website's `npm run verify` and Playwright), each a gate command only for phases that touch that app.
  - `npm run validate` (unchanged: the scope lint), `npm run manifest` (writes and stages `run-manifest.ndjson`).
  - Vitest never type-checks (esbuild/oxc strip types); `tsc -b` is the one typecheck and runs once per lane. `typescript-eslint` is not installed; if a type-aware lint rule is ever wanted it joins the full lane only. `vitest --changed origin/main` is available to agents for local iteration and is never a lane.
  - A `slowTestThreshold` of 300 ms in the Vitest config, so slow tests are named in every run.
- `apps/lens/` from Even's `asr` template, renamed, building to a `dist/`; the simulator opens it and shows a blank page with one dim dot (this is the only lens output P0 may produce, and it is not yet bound).
- `server/` skeleton in TypeScript: a health endpoint, SQLite opened, and a WebSocket that accepts PCM 16 kHz mono and echoes a byte count. The pre-chosen speech-to-text provider wired behind one interface; **every pre-event fixture recording transcribed once** into committed word-timing JSON beside its WAV, and the word timings of one printed.
- `DESIGN.md` gains `chosen` lines for the server language, the store and the speech-to-text provider, each with a changelog line.

**Far-side checks:** none bound; the gate's exit codes are the evidence.
**Second reviewer's focus:** the lanes. Does `test:fast` really skip `test`'s work; does `test` really run everything; is the typecheck run exactly once per lane?
**Gate:** `npm run test:fast` 0 with its timing printed; `npm test` 0 with every file in `wip`; `npm run validate` 0; `npm run manifest` committed.
**Exit:** a repository a cold builder can extend without asking where anything goes.

## P0b — The test harness

**Contract:** no scenarios bound.
**Rulings:** D106.

**Builds:**
- `test/`: the Even bridge stub that records every `createStartUpPageContainer`, `rebuildPageContainer`, `textContainerUpgrade` and `shutDownPageContainer` payload with a fixture-clock timestamp; a fixture player that feeds **pre-transcribed word-timing JSON** to the server on a virtual clock (default twenty times real time; `--realtime` for timing probes, and PCM audio through the real provider only under `CATCH_REAL_STT=1`); a notification capture; a store reader; one server per test worker. One passing smoke test per harness piece, and one test that proves the fast lane finishes under one minute on the P0 tree.
- The **model client with record and replay**: one function every detector and the jogger writer call; cassettes under `test/cassettes/` keyed by prompt hash; replay in the lanes; a missing cassette fails loudly; `CATCH_REAL_LLM=1` records.

**Far-side checks:** the bridge stub's recorded payloads are the ground truth for every later "the wearer sees" step; P0b proves they are captured with fixture-clock timestamps and brightness.
**Second reviewer's focus:** the harness itself. Can the bridge stub be bypassed (a direct DOM write that the lens never does)? Does the virtual clock preserve the fixture's word timings, so two-second and three-second bounds mean something later? Can a test reach the network at all with both flags unset?
**Expected probes:** none bound; the reviewers check that the harness fails loudly when the server is down and when a cassette is missing.
**Gate:** `npm run test:fast` 0 under one minute; `npm test` 0; `npm run validate` 0; manifest committed.
**Exit:** two lanes whose costs are known, and a harness no later phase needs to extend except with new fixtures and cassettes.

## P1a — Staying dark and names on the lens

**Contract:** `staying-dark.feature` scenarios "Nothing has slipped, so the wearer sees only the dot", "Three minutes of talk with nothing to catch leaves the dot alone", "The dot disappears while Catch cannot hear"; `names.feature` in full (5 scenarios, 1 outline), with the "a tap shows…" steps bound through a minimal names page that P1b finishes.
**Rulings:** D14, D16, D37, D17, D29, D57, D87, D88, D95, D78.

**Builds:**
- The lens: the dot at brightness 1 top right; no dot while the server is unreachable (D37); a one-line catch display in the lower third at low brightness, a second and a half, then the dot; a minimal names list on tap (P1b gives it its header, dismissal and promises page); touch events routed through `isEventCapture` and `onEvenHubEvent`.
- The server: a conversation that begins on the wearer's first speech (the end rules come in P1b); the near-field energy split marking each transcript word wearer or other; the introduction detector on other-speech ("I'm X", "my name is X", "this is X", "meet X", "X, nice to meet you"; a small model call through the cassette client is allowed); own-name exclusion (D29); the two-minute repeated-name rule (D87, D88); the per-conversation held names.
- Glyph check on the real lens when the loaner is in hand: the dot, the middle dot, the down arrow, the ellipsis, the dash. Record which render in `DESIGN.md` (chosen) and substitute ASCII where one does not. If the loaner is not yet available, do it in P1b.

**Far-side checks:** every lens step reads the bridge stub's last payload: text, brightness, container type, and the time between the fixture's introduction and the payload (two seconds). "The wearer sees only the dot" is a payload with the dot and nothing else, held over the whole fixture.
**Second reviewer's focus:** the split and the clock. The own-name exclusion (D29) and the "Priya (2)" rule (D88) on the other-louder fixture; the two-second bound measured from fixture time, not from when the server noticed.
**Expected probes:** a dot drawn at brightness 3; a name line that never fades; a name caught from the wearer's own "I'm Linus"; "Priya (2)" at three minutes; a names list out of order; a server outage that leaves the dot lit.
**Register after P1a:** `names` leaves `wip`; `staying-dark` scenario-scoped `wip`.
**Gate:** `npm test` 0; `npm run validate` 0; manifest committed. (Every later phase's gate is `npm test` 0, `npm run validate` 0, manifest committed, plus what the phase names.)
**Exit:** a judge can put the glasses on, hear "Hi, I'm Priya", see `Priya`, and tap to see the list. This is the first demo.

## P1b — The held page, the conversation boundary, and the Even Beta package

**Contract:** `holding.feature` scenarios "A tap shows the names page", "A held page dismisses on its own" (all rows), "Nothing held shows an empty page", "Quiet ends a conversation at ten minutes" (both rows; the phone column binds in P2a, so this outline stays scenario-scoped `wip` until then), "A long-press ends the conversation now" (the lens half; the phone half in P2a).
**Rulings:** D43 (names page only), D31, D92, D55, D56, D52.

**Builds:**
- The lens: the names page as a list container headed `this conversation 1/2`, dismissed on tap or five seconds; `this conversation · nothing held`; long-press.
- The server: the conversation state machine's end rules (ten minutes without the wearer speaking, or long-press; it freezes under pause in P6); names cleared at the end.
- Even Beta: package `.ehpk`, create the Beta group, install on the team's iPhone, run Even's lock/resume, permission-denial and double-tap-exit checks. **The upload and the phone-side checks are the operator's parallel task, not the builder's**; the gate requires the `.ehpk` to build, nothing more.

**Far-side checks:** the names page is the list container's items in order; the boundary is observed through the next tap's page and, from P2a, the notification.
**Second reviewer's focus:** the clock: the ten-minute boundary measured on the wearer's silence, not the room's (D92); the five-second dismissal on fixture time.
**Expected probes:** a conversation that ends on the room's silence; a tap that opens the page while a line is showing; a page that never dismisses; a long-press that does not clear the names.
**Register after P1b:** `holding` scenario-scoped `wip` for what later phases bind.
**Gate:** as P1a, plus `.ehpk` built.
**Exit:** the names demo with recall and a clean end to the conversation, installable through Even Beta.

## P2a — The wearer's own promises, the notification semantics, and deletion

**Contract:** `promises.feature` scenarios "A catch line appears and fades" (rows 1, 2 and 4 bind now; row 3, Dev's promise, is scenario-scoped `wip` until P5), "A promise with no stated time shows the bare action", "A bare yes takes its object from what Dev just asked", "Thinking about it is not a promise"; `holding.feature` "A swipe down turns to the promises page" (own promises; the owed line in P5), "The promises page with nothing promised", the phone column of "Quiet ends a conversation at ten minutes", the phone half of "A long-press ends the conversation now"; `phone-handoff.feature` scenarios "One notification carries both lines" (first line now; the owed line in P5), "A long list is cut off and opens in full" (the cut-off; "opens in full" binds in P2b), "No promises means no notification", "Notifications wait for an unreachable phone" (the promise half; the kept half in P4), "An unkept conversation's transcript is deleted everywhere", "A shared pair delivers to the account holder's phone". **In this phase "the phone" is the harness's notification capture**, which stands in for the device until P2b; the scenarios are bound against it and re-run unchanged against the real app in P2b.
**Rulings:** D89, D90, D47, D43 (promises page), D112, D117, D51, D114 (promises), D76, D79.

**Builds:**
- The server: the commitment detector on wearer-speech (a cassette-backed model call per candidate utterance: is it a commitment; summary as an imperative with any time or condition kept, "send Dev the deck tonight"; the object filled from the other person's last sentence when the wearer's words lack one, D90); "I'll think about it" is not a commitment (D47); the held promise list; at conversation end, one notification per conversation as commands, cut with an ellipsis when long, queued until the receiver acknowledges (D114); deletion of transcript and audio everywhere at the boundary (D76), with the store reader proving it; one account per pair (D79); the notification sender behind one interface with a harness receiver now and the push path in P2b.
- The lens: `promised · …` lines within three seconds; the promises page after the names page on swipe down; `no promises yet`.

**Far-side checks:** the notification capture holds the exact text; the store reader proves the transcript's absence.
**Second reviewer's focus:** the detector's false positives and the deletion. "I'll think about it", "I would if I could", "I'll do it" after an unrelated sentence; a transcript that survives in a cache, a log, or the speech-to-text provider's retention setting (the reviewer reads the provider's docs and reports the setting).
**Expected probes:** a promise line at four seconds; "I'll think about it" held; the time word dropped; a notification per promise; a notification that arrives with the names in it; a transcript still readable after the boundary; a promise dropped when the receiver is unreachable.
**Register after P2a:** `promises` scenario-scoped `wip` (row 3, D91, D113); `phone-handoff` scenario-scoped `wip` (owed line, tick-off outlines, history outlines, "opens in full").
**Gate:** as P1a.
**Exit:** the judge says "I'll send you that link" and sees `promised · send Priya the link`; the harness shows the notification text the phone will carry.

## P2b — The iPhone app

**Contract:** the iPhone rows of the `<surface>` outlines in `phone-handoff.feature` "The home lists conversations newest first on the <surface>" and "The jogger reads the same on the <surface>" (the jogger row waits for P4), "A conversation with nothing to keep never appears on the phone", the "opens in full" half of "A long list is cut off and opens in full", and the real-device re-run of every P2a notification scenario.
**Rulings:** D98, D100, D102, D105.

**Builds:**
- The iPhone app (SwiftUI): sign-in to the account; the history screen (D100); the conversation screen with YOU (D98; tick boxes drawn but inert until P7); notification handling that opens the conversation screen; the client generated from the server's OpenAPI document with `swift-openapi-generator`. Run on the team's iPhone with free provisioning; the push path (or a polling fallback if free provisioning blocks push) wired to P2a's sender interface.
- `npm run test:ios`: the simulator UI tests, bound against the server's data, never the app's view model.

**Far-side checks:** the iPhone screens are checked by UI test against the server's data; a notification is observed as the OS notification request the test harness captures.
**Second reviewer's focus:** free-provisioning limits (what capability fails, and whether the polling fallback is wired), and the notification opening the right conversation.
**Expected probes:** the history in the wrong order; a notification that opens the home instead of the conversation; a row for a conversation with nothing to keep.
**Register after P2b:** `phone-handoff` scenario-scoped `wip` (owed line, tick-off outlines, website rows, jogger row).
**Gate:** as P1a, plus `npm run test:ios` 0.
**Exit:** ten minutes after the judge's promise (or on a long-press) the phone shows "Send Priya the link".

## P3 — The dropped thread

**Contract:** `dropped-thread.feature` in full (4 scenarios, 1 outline); `staying-dark.feature` "The newest catch replaces a page that is showing".
**Rulings:** D35, D48, D49, D50, D33, D36, D34, D32.

**Builds:**
- The server: clause-end detection on the wearer's run (no terminal punctuation or a rising interim from the speech-to-text; the build picks the signal and records it as `chosen`); the wearer's continuous run (reset when another person takes a turn, D48); the trigger: other-speech continuous for two to three seconds during the wearer's pause (D35); nothing on a normal turn (D33) or on silence (D36); the last six words with an ellipsis; cleared when the wearer speaks.
- The lens: a line that stays (no dwell timer) until cleared by speech or by a tap (D34); newest wins over any page (D32).

**Far-side checks:** the fixture carries the real cut-in timing; the bridge stub's payload shows the six words and the time the line stayed. The thread's words are compared with the fixture's transcript, not with the server's notion of the run.
**Second reviewer's focus:** false triggers and the two fixtures. A back-channel "mm-hm" of one second must not trigger; a polite turn at a second and a half must not; the other-louder fixture must still find the wearer's run; the six-word window across the run boundary (D50).
**Expected probes:** a thread shown on a normal turn; a thread from a one-second interjection; seven words; a run that reaches across Dev's turn; a line that clears on its own after a timeout; a tap that opens the held page instead of clearing the line.
**Register after P3:** `dropped-thread` leaves `wip`.
**Gate:** as P1a.
**Exit:** the full lens demo: name, promise, thread, in one minute, on the real glasses.

## P4 — Keep and the jogger

**Contract:** `kept-conversations.feature` scenarios "A swipe up asks whether to keep the conversation", "A tap keeps the conversation", "A swipe down declines without keeping", "The prompt waits through a distraction", "The prompt returns after a catch line", "Swiping up again shows already kept", "A kept call produces a jogger", "A kept conversation of any length gets a jogger" (all rows), "The jogger admits missed time without saying when"; the kept-notification half of `holding.feature` "A long-press ends the conversation now".
**Rulings:** D40, D41, D42, D54, D24, D62, D74, D53, D99.

**Builds:**
- The lens: swipe up → `keep this conversation?`; tap confirms, swipe down declines; the prompt survives any catch line and returns (D42); `already kept` (D54).
- The server: the keep mark; the jogger at conversation end: one flat list of short bullets in order, technical terms in bold, the wearer's promises among them, no fixed count, a `N minutes not heard` line where a gap fell (D53); within thirty seconds for conversations under an hour, a few minutes for longer (D74); the kept notification, queued like promises.
- The iPhone app: the jogger screen (D99, the iPhone row of "The jogger reads the same on the <surface>") and the "Kept conversation ›" link on the conversation screen.
- Ruled: `kept` for a second and a half on a tap (D111); the kept notification waits for an unreachable phone (D114); thirty seconds under an hour (D116). Bind all three here.

**Far-side checks:** the jogger is read from the notification capture and the store, and compared against the fixture transcript for the presence of the named terms; the gap line's text has no clock time in it.
**Second reviewer's focus:** the jogger's honesty. Does it invent terms the transcript does not contain? Does it bold a term the transcript has? Is the missed-time line present when the fixture has a gap and absent when it does not?
**Expected probes:** a prompt that fades at three seconds; a prompt lost to a catch line; a jogger with headings; a jogger capped at eight bullets; a gap line with "around 2:40"; a jogger that never arrives for a two-minute conversation.
**Register after P4:** `kept-conversations` scenario-scoped `wip` (restart, P9).
**Gate:** as P1a, plus `npm run test:ios` 0.
**Exit:** the lab-call story works end to end on the phone.

## P5 — Promises owed to the wearer

**Contract:** `promises.feature` "A catch line appears and fades" row 3, "Dev's promise is held in the owed list, apart from the wearer's own", "A promise from someone unnamed is held as theirs", "An owed promise takes the name once it is caught"; the owed lines of `holding.feature` "A swipe down turns to the promises page" and `phone-handoff.feature` "One notification carries both lines"; the OWED TO YOU section of the conversation screen.
**Rulings:** D91, D26, D28, D43, D98.

**Builds:** the commitment detector pointed at other-speech; the owed list named by the last caught name or "they"; renaming when a name arrives (D26); the second notification line "Owed to you: …"; the OWED TO YOU section.
**Ruled:** unnamed promisers are numbered and a caught name attaches to the most recent (D113). Bind it here.
**Far-side checks:** as P2, on the other-louder fixture as well.
**Second reviewer's focus:** pronoun flipping ("I'll send you the deck" from Dev must become "Dev sends the deck", never "send Dev the deck") and attribution on the other-louder fixture.
**Expected probes:** Dev's promise in the wearer's list; "they" never renamed; the owed line missing from the notification.
**Register after P5:** `promises` leaves `wip`.
**Gate:** as P1a, plus `npm run test:ios` 0 (the OWED TO YOU section).

## P6 — Pause

**Contract:** `staying-dark.feature` "A swipe down pauses Catch and shows the dash", "A second swipe down resumes listening", "A pause freezes the conversation".
**Rulings:** D86, D81.

**Builds:** swipe down in idle → `paused`, then the dash; nothing heard, held or transcribed while paused (the lens stops sending audio and the server discards anything that arrives); swipe down again → `listening`, the dot; the conversation and its timer frozen for the pause (D81); swipe down keeps its page and prompt meanings.
**Far-side checks:** the bridge stub shows the dash payload; the server's store shows no transcript words during the pause window; the timer is checked by the conversation ending six minutes after resume in the D81 fixture.
**Second reviewer's focus:** the gesture's three meanings. Swipe down on the names page, on the prompt, and in idle must do three different things; a swipe during a catch line must not pause.
**Expected probes:** audio still transcribed while paused; the timer running through the pause; a dash that looks like the cannot-hear state (no mark).
**Register after P6:** `staying-dark` leaves `wip`.
**Gate:** as P1a.

## P7 — Tick-off on the phone

**Contract:** the iPhone rows of the `<surface>` outlines "Ticking off a promise removes it from the conversation's screen on the <surface>" and "An owed promise can be ticked off the same way on the <surface>".
**Rulings:** D39, D98, D115.

**Builds:** tick boxes live; a ticked promise leaves the list and the open count on the history row drops; persisted on the server so the website (P8) agrees.
**Far-side checks:** the server's store after the tick, and the history row's count.
**Second reviewer's focus:** idempotency and offline: a double tap, a tick while the phone is offline, a tick on a promise already ticked from the website.
**Expected probes:** a tick that only hides the row locally; a count that does not drop.
**Register after P7:** `phone-handoff` scenario-scoped `wip` only for the website rows.
**Gate:** as P1a, plus `npm run test:ios` 0.

## P8 — The website

**Contract:** the website rows of the four `<surface>` outlines in `phone-handoff.feature` (D115): tick-off on the conversation screen, owed tick-off, the history, the jogger.
**Rulings:** D103, D104.

**Builds:** `apps/web/` from `webdev_ref` Blueprint A (Preact 10.29.x, Vite 8, TypeScript 6.0.3, Zod 4, Tailwind 4, TanStack Query for the server state; pins from `reference/versions.md`, re-verified first); the three screens with tick-off against the same server; sign-in to the account.
**Far-side checks:** Playwright against the running site with the server's data; a tick on the website visible on the phone.
**Second reviewer's focus:** parity. Every element the phone screens show, the website shows, with the same data; no second source of truth.
**Expected probes:** a tick that does not reach the server; a history in a different order from the phone.
**Register after P8:** `phone-handoff` leaves `wip`.
**Gate:** as P1a, plus `npm run test:web` 0 (the blueprint's `npm run verify` and Playwright).

## P9 — Restart persistence

**Contract:** `kept-conversations.feature` "Everything survives a restart mid-conversation".
**Rulings:** D73.

**Builds:** the conversation's held names, promises, keep mark and transcript so far live on the server from the first word, keyed by account and conversation; the lens, on restart, re-attaches to the open conversation (Even: `localStorage` survives; the WebSocket reconnects); a minute's gap is recorded as not heard.
**Far-side checks:** kill the Even app in the harness mid-fixture, restart, and read the held pages from the bridge stub and the jogger from the capture.
**Second reviewer's focus:** the Android case (the WebView may be reclaimed; state must be server-side, not in memory) and the double-conversation risk: a restart must not start a second conversation.
**Expected probes:** names lost; a fresh conversation after restart; the keep mark lost.
**Register after P9:** `kept-conversations` leaves `wip`.
**Gate:** as P1a.

## P10 — Scrolling past twenty names

**Contract:** `holding.feature` "Thirty names scroll before the promises page".
**Rulings:** D43.

**Builds:** the names page across more than one list container (Even's twenty-item limit), swipe down scrolling to the end before turning to the promises page, swipe up scrolling back.
**Far-side checks:** the bridge stub's sequence of pages under thirty introductions in the fixture.
**Second reviewer's focus:** the swipe's meanings at the page boundary (down at the last name turns; up at the first name does nothing, never pauses).
**Register after P10:** `holding` leaves `wip`; the register is empty.
**Gate:** as P1a.

---

## Open questions from the post-draft pass — all ruled 2026-10-15 (D111–D117)

The visionary accepted every candidate after the signed read; the rulings are in the docket and the feature files already carry them. Listed for the record:

1. `kept` for a second and a half when a tap keeps the conversation (D111; P4).
2. `no promises yet` on the promises page when nothing is promised (D112; P2).
3. Unnamed promisers numbered `they (1)`, `they (2)`; a caught name attaches to the most recent (D113; P5).
4. Every notification waits for an unreachable phone, kept ones included (D114; P4).
5. The screen scenarios are outlines over `<surface>` with iPhone app and website rows (D115; the website rows stay scenario-scoped `wip` until P8).
6. Thirty seconds is the jogger bound for anything under an hour; a few minutes beyond (D116; P4).
7. The notification carries the time word (D117; P2).

Nothing was bound when these were ruled, so no Sanctioned changes entry was needed.

## The demo (rehearsed 11:00 Sunday)

1. The judge wears the G2; the lens shows a dot. A teammate: "Hi, I'm Priya." `Priya`.
2. The judge, prompted by conversation: "I'll send you that link." `promised · send Priya the link`.
3. The judge explains something; the teammate cuts in; `…and the second reason is` waits; the judge picks it up.
4. The judge taps: Priya; swipe down: the promise.
5. The operator long-presses: the phone shows "Send Priya the link"; if P4 landed, the kept jogger of the judge's own minute.

Backup for a loud hall: a quieter corner, not a recording. Have the two-fixture test results on a laptop for the technical-depth question.
