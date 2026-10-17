// `npm run lint:features`: every feature file through gherkin-node-test's
// linter in strict mode (every warning is an error). Part of the full lane.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import gnt from 'gherkin-node-test'

const dir = 'features'
const files = readdirSync(dir).filter((f) => f.endsWith('.feature')).sort()
if (files.length === 0) {
  console.error(`no .feature files in ${dir}/`)
  process.exit(1)
}
const problems = files.flatMap((f) =>
  gnt.lintFeature(readFileSync(join(dir, f), 'utf8'), f, { strict: true }).map((p) => `${dir}/${f}:${p.line}: [${p.rule}] ${p.message}`),
)
for (const p of problems) console.error(p)
console.log(`lint:features: ${files.length} files, ${problems.length} findings`)
process.exit(problems.length === 0 ? 0 : 1)
