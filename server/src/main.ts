import { startServer } from './app.ts'

// Entry point: `npm run server` locally, `node server/src/main.ts` in the Fly
// container (Node strips the types). PORT and CATCH_DB come from fly.toml there;
// CATCH_AUDIO_TOKEN is a Fly secret (locally, from an untracked .env or the shell).
const port = Number(process.env.PORT ?? 8080)
const dbPath = process.env.CATCH_DB ?? 'data/catch.db'
const audioToken = process.env.CATCH_AUDIO_TOKEN ?? ''

const server = await startServer({ port, dbPath, audioToken })
console.log(`catch server listening on :${port}, store at ${dbPath}`)

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void server.close().then(() => process.exit(0))
  })
}
