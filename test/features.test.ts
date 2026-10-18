import { copyFileSync, mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { afterAll, afterEach } from 'vitest'
import { runFeatures, type Definer, type WipEntry } from 'gherkin-node-test/vitest'
import { afterScenario, closeHarness } from './steps/lens-world.ts'
import droppedThread from './steps/dropped-thread.steps.ts'
import holding from './steps/holding.steps.ts'
import keptConversations from './steps/kept-conversations.steps.ts'
import names from './steps/names.steps.ts'
import phoneHandoff from './steps/phone-handoff.steps.ts'
import promises from './steps/promises.steps.ts'
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
  // P1b binds D43's names page, D31 and the dismissal; P2a the promises page
  // (D112) and the phone's half of the quiet end; P4 the keep in the
  // long-press end; P5 the owed line on the promises page. Scrolling waits for P10.
  { feature: 'holding', scenarios: ['Thirty names scroll before the promises page'] },
  // kept-conversations.feature has left the register: P4 bound the keep and the jogger, P9 the restart (D73).
  // P2b′ (D130) binds the phone page's "nothing to keep" scenario; P2a binds D51,
  // D76 and D79 in full; P4 binds D114 in full (its kept half) and the iPhone
  // rows of the history and jogger outlines, with steps that match only the
  // "iPhone app" surface; P5 binds D117 (its owed line) and D28 (its "opens in
  // full", with both owed promises on the phone page's OWED TO YOU). The
  // tick-off outlines' iPhone rows are bound by P7 (D133) the same way. Every
  // website row is cut (D126), so all four outlines stay scenario-scoped wip
  // while their website rows are unbound (deferred by D126, operator answer 3).
  {
    feature: 'phone-handoff',
    scenarios: [
      "Ticking off a promise removes it from the conversation's screen on the <surface>",
      'An owed promise can be ticked off the same way on the <surface>',
      'The home lists conversations newest first on the <surface>',
      'The jogger reads the same on the <surface>',
    ],
  },
  // promises.feature has left the register: P2a bound the wearer's own (D89,
  // D90, D47, rows 1, 2 and 4), P5 the owed list (row 3, D91, D113).
  // staying-dark.feature has left the register: P1a bound D14, D16 and D37, P5 D32, P6 the pause (D86, D81).
]

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- each feature's world type is its own
const definers: Record<string, Definer<any>> = {
  'dropped-thread': droppedThread,
  holding,
  'kept-conversations': keptConversations,
  names,
  'phone-handoff': phoneHandoff,
  promises,
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

afterEach(afterScenario)
afterAll(closeHarness)

const manifest = join(ROOT, 'run-manifest.ndjson')
runFeatures(dir, pick(definers), {
  wip: WIP.filter((entry) => selected.includes(featureOf(entry))),
  ...(process.env.CATCH_MANIFEST === '1' ? { manifest } : {}),
})
