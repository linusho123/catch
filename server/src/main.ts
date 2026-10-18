import { startServer, threadDetectionFromEnv } from './app.ts'
import { liveModel } from './llm/client.ts'
import { splitFromEnv } from './split/split.ts'
import { deepgram } from './stt/deepgram.ts'

// Entry point: `npm run server` (or `npm run local`, D128) on the build
// machine, `node server/src/main.ts` in the Fly container (Node strips the
// types). PORT and CATCH_DB come from fly.toml there; DEEPGRAM_API_KEY and
// CATCH_AUDIO_TOKEN are Fly secrets, and locally come from the untracked
// catch/.env (`node --env-file-if-exists=.env`, see README.md) or the shell.
// CATCH_SPLIT and CATCH_LOUDNESS_THRESHOLD_DBFS choose and tune the split;
// CATCH_WEARER_NAME (optional) is the wearer's name, never caught.
// CATCH_THREAD_DETECTION (on | off, default on) is the operator's D120 switch.
// GEMINI_API_KEY (optional locally) turns on the promise detector; without
// it Catch still hears and catches names, and promises nothing. There is no
// phone push yet, so no notifier: a conversation's promises reach the phone
// through the phone page's history.
const port = Number(process.env.PORT ?? 8080)
const host = process.env.HOST
const dbPath = process.env.CATCH_DB ?? 'data/catch.db'
const audioToken = process.env.CATCH_AUDIO_TOKEN ?? ''
const deepgramKey = process.env.DEEPGRAM_API_KEY ?? ''
if (!deepgramKey) {
  console.error('DEEPGRAM_API_KEY is not set: without speech-to-text Catch cannot hear. Put it in catch/.env (see .env.example).')
  process.exit(1)
}

const split = splitFromEnv()
const wearerName = process.env.CATCH_WEARER_NAME?.trim() || undefined
const threadDetection = threadDetectionFromEnv(process.env.CATCH_THREAD_DETECTION)
const geminiKey = process.env.GEMINI_API_KEY?.trim() ?? ''
const model = geminiKey ? liveModel({ apiKey: geminiKey }) : undefined
const server = await startServer({ port, host, dbPath, audioToken, split, wearerName, threadDetection, model, stt: deepgram(deepgramKey) })
console.log(
  `catch server listening on :${port} (/audio, /health), split ${split.name}, thread detection ${threadDetection ? 'on' : 'off'}, promises ${model ? 'on' : 'off (no GEMINI_API_KEY)'}, store at ${dbPath}`,
)
// A lost speech-to-text stream is retried every second; say why, once per outage.
let deaf = false
server.events.on('sttError', ({ error }) => {
  if (!deaf) console.error(`speech-to-text lost, retrying: ${(error as Error)?.message ?? String(error)}`)
  deaf = true
})
server.events.on('words', () => {
  deaf = false
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void server.close().then(() => process.exit(0))
  })
}
