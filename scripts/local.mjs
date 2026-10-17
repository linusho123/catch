// `npm run local` (D128): Catch on the build machine, no Fly. It starts the
// server on ws://localhost:8080 and the lens's Vite dev server pointed at it
// with the matching token; then `npm run lens:simulate` opens the Even Hub
// simulator on the lens. The secrets come from the untracked catch/.env, read
// by Node's --env-file-if-exists in the npm script (names in .env.example):
// DEEPGRAM_API_KEY for speech-to-text, CATCH_AUDIO_TOKEN for /audio. The only
// network either process needs is the speech-to-text provider.
import { spawn } from 'node:child_process'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const missing = ['DEEPGRAM_API_KEY', 'CATCH_AUDIO_TOKEN'].filter((name) => !process.env[name])
if (missing.length > 0) {
  console.error(`npm run local: ${missing.join(' and ')} not set. Copy .env.example to .env in catch/ and fill it in.`)
  process.exit(1)
}

const port = process.env.PORT ?? '8080'
const serverUrl = `ws://localhost:${port}`
const children = [
  spawn(process.execPath, ['server/src/main.ts'], { cwd: root, stdio: 'inherit', env: { ...process.env, PORT: port } }),
  spawn(join(root, 'node_modules/.bin/vite'), ['apps/lens'], {
    cwd: root,
    stdio: 'inherit',
    // Vite gives variables already in the environment priority over .env files.
    env: { ...process.env, VITE_CATCH_SERVER: serverUrl, VITE_CATCH_TOKEN: process.env.CATCH_AUDIO_TOKEN },
  }),
]
console.log(`npm run local: server on ${serverUrl}, lens on http://localhost:5173; now run \`npm run lens:simulate\``)

let stopping = false
function stopAll(code) {
  if (stopping) return
  stopping = true
  for (const child of children) if (child.exitCode === null) child.kill('SIGTERM')
  process.exitCode = code
}
for (const child of children) child.on('exit', (code) => stopAll(code ?? 1))
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stopAll(0))
