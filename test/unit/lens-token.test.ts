import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { checkLensToken } from '../../scripts/lens-token.ts'

// `npm run lens:pack` refuses to build a catch.ehpk the server would refuse
// (operator answer 6): no VITE_CATCH_TOKEN, no package, unless
// CATCH_ALLOW_NO_TOKEN=1 says this machine only checks that the package builds.

const dirs: string[] = []
function lensDir(files: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'catch-lens-'))
  dirs.push(dir)
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text)
  return dir
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('the lens token check behind lens:pack', () => {
  it('fails with a message naming VITE_CATCH_TOKEN and apps/lens/.env.local when there is no token', () => {
    const { error } = checkLensToken(lensDir({ '.env.example': 'VITE_CATCH_TOKEN=\n' }), {})
    expect(error).toMatch(/VITE_CATCH_TOKEN/)
    expect(error).toMatch(/apps\/lens\/\.env\.local/)
    expect(error).toMatch(/CATCH_ALLOW_NO_TOKEN=1/)
  })

  it('lets the package build without a token when CATCH_ALLOW_NO_TOKEN=1', () => {
    const result = checkLensToken(lensDir(), { CATCH_ALLOW_NO_TOKEN: '1' })
    expect(result.error).toBeUndefined()
    expect(result.token).toBe('')
  })

  it('takes the token from the environment', () => {
    expect(checkLensToken(lensDir(), { VITE_CATCH_TOKEN: 'from-env' })).toEqual({ token: 'from-env' })
  })

  it('takes the token from apps/lens/.env.local as Vite would', () => {
    expect(checkLensToken(lensDir({ '.env.local': '# local\nVITE_CATCH_TOKEN="from-file"\n' }), {})).toEqual({ token: 'from-file' })
  })

  it('does not count an empty VITE_CATCH_TOKEN line as a token', () => {
    expect(checkLensToken(lensDir({ '.env.local': 'VITE_CATCH_TOKEN=\n' }), {}).error).toMatch(/VITE_CATCH_TOKEN/)
  })
})
