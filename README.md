# Catch — build tree

The contract is `features/` (feature files, fence, ledger, DESIGN.md, docket); the plan is `docs/BUILD-PLAN.md`. Everything below is the build's.

| Path | What lives there |
|---|---|
| `apps/lens/` | The Even Hub plugin (see its README). |
| `server/src/` | The server: `app.ts` (HTTP `/health`, WebSocket `/audio`, one session per wearer keyed by the shared token so a lost socket loses nothing (D79), one speech-to-text stream per socket, reopened when lost), `catch/` (`session.ts`: words lined up with frames, the split, the conversation and its end (ten minutes of the wearer's silence, or a long-press), what the lens shows and for how long; `introductions.ts`: names by pattern; `held-names.ts`: the order heard and the two-minute rule), `store.ts` (SQLite), `stt/` (the speech-to-text interface; `deepgram.ts`), `split/` (wearer versus others: speaker-role, loudness, provider labels), `llm/` (the Gemini adapter, two pinned ids). |
| `shared/wire.ts`, `shared/lens-protocol.ts` | The lens-to-server audio frame; the views the server sends the lens and the taps it sends back. |
| `test/fixtures/` | Synthetic word-timing fixtures (D126): `scripts.ts` is the source, `npm run fixtures` writes the JSON, `npm run fixtures:print -- <name>` prints one. |
| `test/harness/` | The test harness (P0b), one per test worker via `harness()`: `even-host.ts` (the Even bridge stub: the real SDK posting to a stand-in Even app that records every page and text payload, brightness included, on the fixture clock), `clock.ts` (the fixture clock, 20× wall time, `advance` across silence), `player.ts` (fixture frames through the lens and fixture words out of the server's speech-to-text seam), `notifications.ts` (the phone's OS), `store-reader.ts` (the SQLite file read directly), `model.ts` (the model client on cassettes). |
| `test/cassettes/` | Model cassettes, one JSON per model id and prompt hash; replayed in the lanes, recorded by hand with `CATCH_REAL_LLM=1`. |
| `test/setup/no-network.ts` | Loaded by every Vitest project: nothing but loopback is reachable unless `CATCH_REAL_STT=1` or `CATCH_REAL_LLM=1`. |
| `test/unit/`, `**/*.test.ts` | Vitest project `unit`. |
| `test/integration/` | Vitest project `integration` (real sockets and files; full lane only). |
| `test/features.test.ts`, `test/steps/` | gherkin-node-test over `features/`, with the wip register; one definer per bound feature (`names.steps.ts`, `staying-dark.steps.ts`, `holding.steps.ts`), sharing `lens-world.ts`, which reads every "the wearer sees" from the bridge stub's record. |
| `scripts/lane.mjs` | The two lanes. |
| `scripts/pack-lens.mjs` | `npm run lens:pack`: `catch.ehpk` for Even Beta, pointed at `wss://catch-g2.fly.dev` with the shared token built in. |

Lanes: `npm run test:fast` (oxlint, one typecheck, unit, the feature files in `FEATURES`, all when unset) inside a phase; `npm test` (feature lint, oxlint, one typecheck, every Vitest project, all of `features/`) at the gate. `npm run test:fast -- --realtime` runs the fixture clock at real time for timing probes; `test/integration/lane-timing.test.ts` (full lane) proves the fast lane passes in under a minute. `npm run manifest` writes and stages `run-manifest.ndjson`. `npm run validate` is the scope lint.

## Run Catch on this machine (D128)

Nothing needs Fly. Copy `.env.example` to `.env` in `catch/` (untracked) and fill in `DEEPGRAM_API_KEY` and `CATCH_AUDIO_TOKEN` (any long random string; it is the shared token `/audio` demands). Then, in two terminals:

    npm run local          # the server on ws://localhost:8080, the lens dev server on http://localhost:5173 pointed at it
    npm run lens:simulate  # the Even Hub simulator on the lens, with the laptop mic as the glasses mic

`npm run local` reads `.env` with Node's `--env-file-if-exists`, starts `server/src/main.ts`, and starts Vite with `VITE_CATCH_SERVER=ws://localhost:8080` and `VITE_CATCH_TOKEN` set to the same `CATCH_AUDIO_TOKEN`, so the two always match. The only network it needs is Deepgram. The simulator shows the dim dot top right once the server's Deepgram stream is open (no dot means Catch cannot hear: no key, no network, or the server is down); when someone else says "Hi, I'm Priya", `Priya` shows in the lower third for a second and a half, and a click (tap) shows the names page (`this conversation 1/2`, the names in the order heard, `↓ promises` at the foot) for five seconds, or `this conversation · nothing held`. A long-press ends the conversation; so do ten minutes in which the wearer says nothing. Off the glasses the split is loudness (D126): the wearer is whoever is loud at the mic, so the person introducing themselves should speak from a step or two away. `http://localhost:5173/glyphs.html` in the simulator is the glyph check. The simulator does not hold the lens to `app.json`'s network whitelist (checked 2026-10-17, simulator 0.9.5): `ws://localhost:8080` is not in it and connects.

## Even Beta: the package and installing it (testers)

`npm run lens:pack` builds `catch.ehpk` in `catch/`, always pointed at the hosted server `wss://catch-g2.fly.dev` (the one origin in `app.json`), whatever a local `.env` says. It builds the shared token in from `VITE_CATCH_TOKEN`: put `VITE_CATCH_TOKEN=<the CATCH_AUDIO_TOKEN value>` in the untracked `apps/lens/.env.local` first; without it `lens:pack` stops before building, naming `VITE_CATCH_TOKEN` and `apps/lens/.env.local`. `CATCH_ALLOW_NO_TOKEN=1 npm run lens:pack` builds one without the token, only to check that the package builds: the server refuses it, so never upload that one. The `.ehpk` is never committed. Uploading it to Even Hub as a Beta build and managing the Beta group are the operator's (Even Hub's developer site); there is no loaner G2, so the phone-side checks (lock and resume, permission denial, double-tap exit) are run by the operator once a G2 is in hand.

What a tester does to install Catch from the Beta:

1. Have an iPhone with the Even app 2.2.10 or later, signed in to an Even account, with G2 paired to it.
2. Send the operator the email of that Even account; the operator adds it to Catch's Beta group in Even Hub.
3. Accept the invitation, then install **Catch** from Even Hub in the Even app and open it. Allow the glasses microphone when asked.
4. No account or key of your own is needed: the shared token is inside the package. The hosted server must be up (`fly status -a catch-g2`, the operator's).

Using it: a dim dot top right means Catch is listening (no dot: it cannot hear, so check the phone's network). When someone says "Hi, I'm Priya", `Priya` shows dimly in the lower third for a second and a half. Tap to see the names held in this conversation (five seconds, or tap again); long-press to end the conversation; double-tap is Even's exit. The split is loudness (D126): the person introducing themselves should be a step or two away, quieter than you.

## Server and Fly

Server: `npm run server` locally (reads `.env` the same way; `PORT`, `CATCH_DB`, `CATCH_SPLIT`, `CATCH_LOUDNESS_THRESHOLD_DBFS`, the optional `CATCH_WEARER_NAME` (the wearer's name, never caught, whatever the split decides), and the required `CATCH_AUDIO_TOKEN`, the shared token `/audio` demands; the lens builds in the same value as `VITE_CATCH_TOKEN`); on Fly, `fly deploy` from this directory (`fly.toml`, `Dockerfile`; the store on the `catch_data` volume at `/data/catch.db`; secrets `DEEPGRAM_API_KEY`, `GEMINI_API_KEY`, `CATCH_AUDIO_TOKEN`, optionally `CATCH_WEARER_NAME`). The lanes never reach the network: the real provider and the real model run only by hand, behind `CATCH_REAL_STT=1` (the harness gives the server Deepgram, plays a fixture's recorded `<name>.wav` in real time, and fails loudly on the synthetic fixtures, which have none) and `CATCH_REAL_LLM=1` (records cassettes).
