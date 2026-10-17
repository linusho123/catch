import { startServer } from './app.ts'

// Entry point: `npm run server` locally, `node server/src/main.ts` in the Fly
// container (Node strips the types). PORT and CATCH_DB come from fly.toml there.
const port = Number(process.env.PORT ?? 8080)
const dbPath = process.env.CATCH_DB ?? 'data/catch.db'

const server = await startServer({ port, dbPath })
console.log(`catch server listening on :${port}, store at ${dbPath}`)

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void server.close().then(() => process.exit(0))
  })
}
