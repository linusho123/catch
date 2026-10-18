import { copyFileSync, mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { afterAll } from 'vitest'
import { runFeatures, type Definer, type WipEntry } from 'gherkin-node-test/vitest'
import { closeHarness } from './steps/lens-world.ts'
import holding from './steps/holding.steps.ts'
import names from './steps/names.steps.ts'
import phoneHandoff from './steps/phone-handoff.steps.ts'
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
  // P1b binds D43's names page, D31 and the dismissal; these wait for P2a (the
  // promises page; the phone's half of the end), P4 (the keep) and P10 (scrolling).
  // The lens steps of the two ends are bound, and first run when P2a binds the phone.
  {
    feature: 'holding',
    scenarios: [
      'A swipe down turns to the promises page',
      'Thirty names scroll before the promises page',
      'The promises page with nothing promised',
      'Quiet ends a conversation at ten minutes',
      'A long-press ends the conversation now',
    ],
  },
  'kept-conversations',
  // P2b′ (D130) binds the phone page's "nothing to keep" scenario. The rest waits:
  // the notifications for P2a; the jogger row for P4; the tick-off outlines and
  // every website row are cut (D126, D130). "The home lists conversations newest
  // first on the <surface>": its iPhone row is lifted in P4 (after P2a's promises
  // and P4's keep), with steps that match only the "iPhone app" surface; this
  // scenario-scoped entry stays while its website row is unbound, because the
  // website row is deferred by D126 (operator answer 3).
  {
    feature: 'phone-handoff',
    scenarios: [
      'One notification carries both lines',
      'A long list is cut off and opens in full',
      'No promises means no notification',
      'Notifications wait for an unreachable phone',
      "Ticking off a promise removes it from the conversation's screen on the <surface>",
      'An owed promise can be ticked off the same way on the <surface>',
      'The home lists conversations newest first on the <surface>',
      'The jogger reads the same on the <surface>',
      "An unkept conversation's transcript is deleted everywhere",
      "A shared pair delivers to the account holder's phone",
    ],
  },
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
  holding,
  names,
  'phone-handoff': phoneHandoff,
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
