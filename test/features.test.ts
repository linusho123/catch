import { copyFileSync, mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { afterAll } from 'vitest'
import { runFeatures, type Definer, type WipEntry } from 'gherkin-node-test/vitest'
import { closeHarness } from './steps/lens-world.ts'
import names from './steps/names.steps.ts'
import stayingDark from './steps/staying-dark.steps.ts'

// gherkin-node-test over features/. One definer per feature file joins here as
// its phase binds it (test/steps/<feature>.steps.ts). The bound scenarios run
// on the worker's one test harness (test/harness/), closed after the run.
//
// FEATURES (fast lane only) names the feature files to run, by basename or
// path, separated by commas or spaces; unset runs them all. The full lane
// unsets it. CATCH_MANIFEST=1 (npm run manifest) writes run-manifest.ndjson,
// and only on an unfiltered run, because a partial account is not an account.

const ROOT = resolve(import.meta.dirname, '..')
const FEATURE_DIR = join(ROOT, 'features')

// The wip register: features (or scenarios) not yet bound. It only shrinks.
const WIP: WipEntry[] = [
  'dropped-thread',
  'holding',
  'kept-conversations',
  'phone-handoff',
  'promises',
  // P1a binds D14, D16 and D37; these wait for P3 (D32, the promise line), P6 (pause).
  {
    feature: 'staying-dark',
    scenarios: [
      'The newest catch replaces a page that is showing',
      'A swipe down pauses Catch and shows the dash',
      'A second swipe down resumes listening',
      'A pause freezes the conversation',
    ],
  },
]

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- each feature's world type is its own
const definers: Record<string, Definer<any>> = {
  names,
  'staying-dark': stayingDark,
}

const all = readdirSync(FEATURE_DIR).filter((f) => f.endsWith('.feature')).map((f) => basename(f, '.feature'))
const requested = (process.env.FEATURES ?? '')
  .split(/[\s,]+/)
  .filter(Boolean)
  .map((f) => basename(f, '.feature'))
for (const name of requested) {
  if (!all.includes(name)) throw new Error(`FEATURES names ${name}, which is not a feature file in features/`)
}

const filtered = requested.length > 0
if (process.env.CATCH_MANIFEST === '1' && filtered) {
  throw new Error('CATCH_MANIFEST=1 with FEATURES set: the manifest is written only by a run over every feature file')
}

const selected = filtered ? requested : all
let dir = FEATURE_DIR
if (filtered) {
  dir = mkdtempSync(join(tmpdir(), 'catch-features-'))
  for (const name of selected) copyFileSync(join(FEATURE_DIR, `${name}.feature`), join(dir, `${name}.feature`))
}

const featureOf = (entry: WipEntry) => (typeof entry === 'string' ? entry : entry.feature)
const pick = <T>(entries: Record<string, T>) =>
  Object.fromEntries(Object.entries(entries).filter(([name]) => selected.includes(name)))

afterAll(closeHarness)

const manifest = join(ROOT, 'run-manifest.ndjson')
runFeatures(dir, pick(definers), {
  wip: WIP.filter((entry) => selected.includes(featureOf(entry))),
  ...(process.env.CATCH_MANIFEST === '1' ? { manifest } : {}),
})
