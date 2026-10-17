// The shared token a catch.ehpk carries (VITE_CATCH_TOKEN, the server's
// CATCH_AUDIO_TOKEN), found as Vite would find it: the environment first, then
// the lens's .env files. `npm run lens:pack` stops without one (operator
// answer 6): a package with no token is one the server refuses. A machine that
// only checks the package builds sets CATCH_ALLOW_NO_TOKEN=1. The token itself
// is never printed.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const ENV_FILES = ['.env.production.local', '.env.local', '.env.production', '.env']

/** VITE_CATCH_TOKEN from `env`, or as Vite would read it from the lens's .env files; '' if none. */
export function lensToken(lensDir: string, env: NodeJS.ProcessEnv): string {
  if (env.VITE_CATCH_TOKEN) return env.VITE_CATCH_TOKEN
  for (const file of ENV_FILES) {
    const path = join(lensDir, file)
    if (!existsSync(path)) continue
    const line = readFileSync(path, 'utf8')
      .split('\n')
      .find((l) => /^\s*VITE_CATCH_TOKEN\s*=/.test(l))
    const value = line
      ?.split('=')
      .slice(1)
      .join('=')
      .trim()
      .replace(/^["']|["']$/g, '')
    if (value) return value
  }
  return ''
}

/** The token, or why lens:pack must stop. */
export function checkLensToken(lensDir: string, env: NodeJS.ProcessEnv): { token: string; error?: string } {
  const token = lensToken(lensDir, env)
  if (token || env.CATCH_ALLOW_NO_TOKEN === '1') return { token }
  return {
    token,
    error:
      'lens:pack: VITE_CATCH_TOKEN is not set, so catch.ehpk would carry no token and the server would refuse it.\n' +
      'Put VITE_CATCH_TOKEN=<the CATCH_AUDIO_TOKEN value> in apps/lens/.env.local (untracked) and pack again.\n' +
      'To check only that the package builds, without a token, set CATCH_ALLOW_NO_TOKEN=1.',
  }
}
