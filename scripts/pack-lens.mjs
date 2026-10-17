// `npm run lens:pack`: catch.ehpk for Even Beta (BUILD-PLAN.md, P1b). The
// lens is built pointed at the one origin app.json whitelists
// (wss://catch-g2.fly.dev), whatever a local .env says, so a build for the
// Beta never ships pointed at a laptop; the shared token /audio demands is
// built in from VITE_CATCH_TOKEN (the server's CATCH_AUDIO_TOKEN), taken from
// the environment or the untracked apps/lens/.env.local, never committed.
// Without it the package still builds, but cannot reach the server, and this
// says so loudly. Uploading to Even Hub and the Beta group are the operator's.
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const lens = join(root, 'apps/lens')
const app = JSON.parse(readFileSync(join(lens, 'app.json'), 'utf8'))
const origins = app.permissions?.find((p) => p.name === 'network')?.whitelist ?? []
if (origins.length !== 1) {
  console.error(`lens:pack: app.json must whitelist exactly one server origin, found ${JSON.stringify(origins)}`)
  process.exit(1)
}
const [server] = origins

/** VITE_CATCH_TOKEN from the environment, or as Vite would read it from apps/lens/.env.local. */
function token() {
  if (process.env.VITE_CATCH_TOKEN) return process.env.VITE_CATCH_TOKEN
  for (const file of ['.env.production.local', '.env.local', '.env.production', '.env']) {
    const path = join(lens, file)
    if (!existsSync(path)) continue
    const line = readFileSync(path, 'utf8').split('\n').find((l) => /^\s*VITE_CATCH_TOKEN\s*=/.test(l))
    const value = line?.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '')
    if (value) return value
  }
  return ''
}

function run(cmd, args, env = process.env) {
  const { status } = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', env })
  if (status !== 0) process.exit(status ?? 1)
}

// Variables already in the environment win over Vite's .env files.
run(join(root, 'node_modules/.bin/vite'), ['build', 'apps/lens'], { ...process.env, VITE_CATCH_SERVER: server })

const assets = join(lens, 'dist/assets')
const bundle = readdirSync(assets)
  .filter((f) => f.endsWith('.js'))
  .map((f) => readFileSync(join(assets, f), 'utf8'))
  .join('\n')
if (!bundle.includes(server)) {
  console.error(`lens:pack: the built lens does not point at ${server}`)
  process.exit(1)
}
if (/wss?:\/\/(localhost|127\.0\.0\.1)/.test(bundle)) {
  console.error('lens:pack: the built lens points at a local server; a Beta build must point at the hosted one')
  process.exit(1)
}

run(join(root, 'node_modules/.bin/evenhub'), ['pack', 'apps/lens/app.json', 'apps/lens/dist', '--sdk-ver', '0.0.16', '-o', 'catch.ehpk'])

console.log(`lens:pack: catch.ehpk points at ${server}`)
if (!token()) {
  console.error(
    '\nlens:pack: WARNING: VITE_CATCH_TOKEN is not set, so this catch.ehpk carries no token and the server will refuse it.\n' +
      'Do not upload it. Put VITE_CATCH_TOKEN=<the CATCH_AUDIO_TOKEN value> in apps/lens/.env.local and pack again.\n',
  )
} else {
  console.log('lens:pack: the shared token is built in (from VITE_CATCH_TOKEN)')
}
