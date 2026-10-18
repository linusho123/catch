// The server's environment under `npm run local` (D128): the wearer's .env
// (read by Node's --env-file-if-exists), the port, and one default of the
// local path's own. On a laptop microphone (a MacBook Air, operator, P5) the
// server's -20 dBFS near-field threshold puts the wearer's normal voice under
// it, so nothing the wearer says is the wearer's; -25 separated the wearer at
// about 30 cm from another voice at about 2 m. So `npm run local` gives the
// server -25 when the .env sets no threshold (a blank value, as a name-only
// line copied from .env.example would leave, counts as none). The server's
// own default (split.ts) and the fixtures stay at -20.

import { join } from 'node:path'

/** The near-field threshold `npm run local` uses when the .env sets none. A tuning value for the laptop mic, not a ruling. */
export const LOCAL_LOUDNESS_THRESHOLD_DBFS = '-25'

export function localServerEnv(env: NodeJS.ProcessEnv, port: string): NodeJS.ProcessEnv {
  const set = env.CATCH_LOUDNESS_THRESHOLD_DBFS?.trim()
  return { ...env, PORT: port, CATCH_LOUDNESS_THRESHOLD_DBFS: set ? env.CATCH_LOUDNESS_THRESHOLD_DBFS : LOCAL_LOUDNESS_THRESHOLD_DBFS }
}

/** One process `npm run local` starts, as spawn takes it. */
export interface LocalProcess {
  command: string
  args: string[]
  options: { cwd: string; stdio: 'inherit'; env: NodeJS.ProcessEnv }
}

/**
 * What `npm run local` starts (local.mjs spawns exactly these, test-gap-2):
 * the server on `port` with localServerEnv's environment, and the lens's Vite
 * dev server pointed at it with the matching token.
 */
export function localProcesses(env: NodeJS.ProcessEnv, root: string, execPath: string): { serverUrl: string; serverEnv: NodeJS.ProcessEnv; processes: LocalProcess[] } {
  const port = env.PORT ?? '8080'
  const serverUrl = `ws://localhost:${port}`
  const serverEnv = localServerEnv(env, port)
  return {
    serverUrl,
    serverEnv,
    processes: [
      { command: execPath, args: ['server/src/main.ts'], options: { cwd: root, stdio: 'inherit', env: serverEnv } },
      {
        command: join(root, 'node_modules/.bin/vite'),
        args: ['apps/lens'],
        // Vite gives variables already in the environment priority over .env files.
        options: { cwd: root, stdio: 'inherit', env: { ...env, VITE_CATCH_SERVER: serverUrl, VITE_CATCH_TOKEN: env.CATCH_AUDIO_TOKEN } },
      },
    ],
  }
}
