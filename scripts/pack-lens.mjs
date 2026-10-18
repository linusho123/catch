// `npm run lens:pack`: catch.ehpk for Even Beta (BUILD-PLAN.md, P1b). The
// lens is built pointed at the one ws(s) origin app.json whitelists
// (wss://catch-g2.fly.dev; its https twin, for the phone page's /phone, is
// whitelisted beside it on the same host: scripts/lens-origins.ts), whatever
// a local .env says, so a build for the
// Beta never ships pointed at a laptop; the shared token /audio demands is
// built in from VITE_CATCH_TOKEN (the server's CATCH_AUDIO_TOKEN), taken from
// the environment or the untracked apps/lens/.env.local, never committed.
// Without it this stops before building (operator answer 6), unless
// CATCH_ALLOW_NO_TOKEN=1 says this machine only checks that the package
// builds. Uploading to Even Hub and the Beta group are the operator's.
import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { lensServer } from './lens-origins.ts'
import { checkLensToken } from './lens-token.ts'

const root = resolve(import.meta.dirname, '..')
const lens = join(root, 'apps/lens')
const app = JSON.parse(readFileSync(join(lens, 'app.json'), 'utf8'))
const origins = app.permissions?.find((p) => p.name === 'network')?.whitelist ?? []
const { server, error: originError } = lensServer(origins)
if (originError) {
  console.error(originError)
  process.exit(1)
}

const { token, error } = checkLensToken(lens, process.env)
if (error) {
  console.error(error)
  process.exit(1)
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
if (!token) {
  console.error(
    '\nlens:pack: CATCH_ALLOW_NO_TOKEN=1: this catch.ehpk carries no token and the server will refuse it. Do not upload it.\n',
  )
} else {
  console.log('lens:pack: the shared token is built in (from VITE_CATCH_TOKEN)')
}
