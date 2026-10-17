# Catch — build tree

The contract is `features/` (feature files, fence, ledger, DESIGN.md, docket); the plan is `docs/BUILD-PLAN.md`. Everything below is the build's.

| Path | What lives there |
|---|---|
| `apps/lens/` | The Even Hub plugin (see its README). |
| `server/src/` | The server: `app.ts` (HTTP `/health`, WebSocket `/audio`), `store.ts` (SQLite), `stt/` (the speech-to-text interface; `deepgram.ts`), `split/` (wearer versus others: speaker-role, loudness, provider labels), `llm/` (the Gemini adapter, two pinned ids). |
| `shared/wire.ts` | The lens-to-server audio frame. |
| `test/fixtures/` | Synthetic word-timing fixtures (D126): `scripts.ts` is the source, `npm run fixtures` writes the JSON, `npm run fixtures:print -- <name>` prints one. |
| `test/unit/`, `**/*.test.ts` | Vitest project `unit`. |
| `test/integration/` | Vitest project `integration` (real sockets and files; full lane only). |
| `test/features.test.ts` | gherkin-node-test over `features/`, with the wip register; step definers join it as phases bind them. |
| `scripts/lane.mjs` | The two lanes. |

Lanes: `npm run test:fast` (oxlint, one typecheck, unit, the feature files in `FEATURES`, all when unset) inside a phase; `npm test` (feature lint, oxlint, one typecheck, every Vitest project, all of `features/`) at the gate. `npm run manifest` writes and stages `run-manifest.ndjson`. `npm run validate` is the scope lint.

Server: `npm run server` locally (`PORT`, `CATCH_DB`, `CATCH_SPLIT`, `CATCH_LOUDNESS_THRESHOLD_DBFS`, and the required `CATCH_AUDIO_TOKEN`, the shared token `/audio` demands; the lens builds in the same value as `VITE_CATCH_TOKEN`); on Fly, `fly deploy` from this directory (`fly.toml`, `Dockerfile`; the store on the `catch_data` volume at `/data/catch.db`; secrets `DEEPGRAM_API_KEY`, `GEMINI_API_KEY`, `CATCH_AUDIO_TOKEN`). The lanes never reach the network: the real provider and the real model run only by hand, behind `CATCH_REAL_STT=1` and `CATCH_REAL_LLM=1` (both arrive with the P0b harness).
