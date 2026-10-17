import { loadFixture } from './fixture.ts'

// Prints one fixture's word timings: `npm run fixtures:print -- cut-off.wearer-louder`.
const name = process.argv[2] ?? 'introductions.wearer-louder'
const fx = loadFixture(name)
console.log(`${name} (${fx.synthetic ? 'synthetic' : 'recorded'}, ${fx.words.length} words)`)
for (const w of fx.words) {
  console.log(`${w.start.toFixed(3).padStart(8)} ${w.end.toFixed(3).padStart(8)}  ${w.role.padEnd(6)} ${w.loudness.toFixed(1).padStart(6)} dBFS  spk ${w.speaker}  ${w.text}`)
}
