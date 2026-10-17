# Catch lens (Even Hub plugin)

Started from Even's `asr` template (`npx degit even-realities/evenhub-templates/asr`), SDK bumped to 0.0.16. The template's speech-to-text stub and `VITE_STT_API_KEY` are gone: the lens streams the glasses mic to the Catch server (`wss://catch-g2.fly.dev/audio`, the one origin in `app.json`) and draws what the server sends. In P0a that is a blank page with one dim dot.

Commands run from `catch/`:

- `npm run lens:dev`, then `npm run lens:simulate`: the Even Hub simulator on the Vite dev server. `VITE_CATCH_SERVER=ws://localhost:8080 npm run lens:dev` points a local build at a local server (never in `app.json`).
- `npm run lens:build`: `apps/lens/dist/`.
- `npm run lens:pack`: `catch.ehpk` for Even Beta.

Files: `src/main.ts` (bridge, the dot, the socket, exit), `src/frames.ts` (an SDK audio event to a wire frame, with `speakerRole` and `direction`), `../../shared/wire.ts` (the frame format).
