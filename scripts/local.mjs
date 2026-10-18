// `npm run local` (D128): Catch on the build machine, no Fly. It starts the
// server on ws://localhost:8080 and the lens's Vite dev server pointed at it
// with the matching token; then `npm run lens:simulate` opens the Even Hub
// simulator on the lens. The secrets come from the untracked catch/.env, read
// by Node's --env-file-if-exists in the npm script (names in .env.example):
// DEEPGRAM_API_KEY for speech-to-text, CATCH_AUDIO_TOKEN for /audio, and the
// optional GEMINI_API_KEY for the promise detector (P2a). The only
// network either process needs is the speech-to-text and model providers.
// The server's near-field threshold defaults to -25 dBFS here, not the
// server's -20, when the .env sets none (local-env.ts: a laptop microphone).
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { localProcesses } from './local-env.ts'

const root = resolve(import.meta.dirname, '..')
const missing = ['DEEPGRAM_API_KEY', 'CATCH_AUDIO_TOKEN'].filter((name) => !process.env[name])
if (missing.length > 0) {
  console.error(`npm run local: ${missing.join(' and ')} not set. Copy .env.example to .env in catch/ and fill it in.`)
  process.exit(1)
}

// The server and the lens dev server, as local-env.ts builds them (tested there).
const { serverUrl, serverEnv, processes } = localProcesses(process.env, root, process.execPath)
const children = processes.map(({ command, args, options }) => spawn(command, args, options))
console.log(
  `npm run local: server on ${serverUrl} (loudness threshold ${serverEnv.CATCH_LOUDNESS_THRESHOLD_DBFS} dBFS), lens on http://localhost:5173; now run \`npm run lens:simulate\``,
)

let stopping = false
function stopAll(code) {
  if (stopping) return
  stopping = true
  for (const child of children) if (child.exitCode === null) child.kill('SIGTERM')
  process.exitCode = code
}
for (const child of children) child.on('exit', (code) => stopAll(code ?? 1))
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stopAll(0))
