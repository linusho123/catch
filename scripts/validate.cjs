const { lintFeature, parseFeature } = require(process.env.GNT || "gherkin-node-test");
const fs = require("fs");
const probe = lintFeature("Feature: p\n  @only\n  Scenario: s\n    Given g\n    Then the count is 1\n", "probe", { strict: true });
if (!probe.some((f) => f.rule === "strict-tag")) { console.error("linter too old: no strict-tag under {strict:true} — this contract needs gherkin-node-test >= 0.9.0"); process.exit(1); }
try { require.resolve("@bingh/docketry/package.json"); } catch (e) { console.error("docketry not installed — npm i -D @bingh/docketry@0.1.0"); process.exit(1); }
const files = process.argv.slice(2);
if (files.length === 0) { console.error("no feature files passed — a clean report over nothing is vacuous"); process.exit(1); }
const missing = files.filter((f) => !fs.existsSync(f));
if (missing.length) { console.error(`not found: ${missing.join(" ")}`); process.exit(1); }
const path = require("path");
const dir = path.dirname(files[0]);
const find = (name, msg) => { const p = [path.join(dir, name), path.join(dir, "..", name)].find((p) => fs.existsSync(p) && fs.readFileSync(p, "utf8").trim().length > 0); if (!p) { console.error(msg); process.exit(1); } return p; };
const fence = find("OUT-OF-SCOPE.md", "fence missing or empty");
const ledger = find("USER-NEEDS.md", "needs ledger missing or empty");
const design = find("DESIGN.md", "design doc missing or empty");
if (!/^#{1,6}\s*Changelog\b/im.test(fs.readFileSync(design, "utf8"))) { console.error(`design doc has no Changelog heading (${design})`); process.exit(1); }
const docket = find("DOCKET.md", "docket missing or empty");
const docketLint = require("child_process").spawnSync("npx", ["--no-install", "docketry", "lint", docket, "--corpus", dir, "--strict"], { encoding: "utf8" });
if (docketLint.status !== 0) {
  process.stdout.write(docketLint.stdout || ""); process.stderr.write(docketLint.stderr || "");
  console.error(docketLint.status === 1 ? "docket lint: findings under --strict (exit 1)" : `docket lint: could not run (exit ${docketLint.status})`);
  process.exit(1);
}
let bad = 0, plain = 0, outlines = 0;
for (const f of files) {
  const text = fs.readFileSync(f, "utf8");
  for (const x of lintFeature(text, f, { strict: true })) { bad += 1; console.log(`${f}:${x.line}: [${x.rule}] ${x.severity}: ${x.message}`); }
  try { const parsed = parseFeature(text, f); plain += parsed.scenarios.length - parsed.outlines.reduce((n, o) => n + o.rows, 0); outlines += parsed.outlines.length; }
  catch (e) { bad += 1; console.log(`${f}: [parse] error: ${e.message}`); }
}
if (bad) process.exit(1);
console.log("scope-clean: zero strict findings");
console.log("corpus: " + files.map((f) => path.resolve(f)).join(" "));
console.log("fence: " + path.resolve(fence)); console.log("ledger: " + path.resolve(ledger)); console.log("design: " + path.resolve(design)); console.log("docket: " + path.resolve(docket));
console.log(`stats: ${files.length} feature files, ${plain} scenarios, ${outlines} scenario outlines`);
console.log("docket lint (strict, exit 0) — read these counted lines aloud at handoff:");
process.stdout.write(docketLint.stdout);
