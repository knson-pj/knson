const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const root = path.resolve(__dirname, '..');
const baselinePath = path.join(__dirname, 'architecture-baseline.json');
const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));

function runNode(args) {
  cp.execFileSync(process.execPath, args, {
    cwd: root,
    stdio: 'inherit',
  });
}

function assertExists(file) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) {
    throw new Error(`missing required file: ${file}`);
  }
}

for (const file of Object.values(baseline.sharedLayers)) assertExists(file);
for (const file of baseline.htmlFiles) assertExists(file);
for (const file of baseline.pageFiles) assertExists(file);

runNode(['scripts/check-html-assets.js']);
runNode(['scripts/check-architecture.js']);

for (const file of baseline.syntaxCheckFiles) {
  assertExists(file);
  runNode(['--check', file]);
}

const warnings = [];
for (const [file, maxBytes] of Object.entries(baseline.pageSizeWarnings || {})) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) continue;
  const size = fs.statSync(full).size;
  if (size > maxBytes) warnings.push(`${file}: ${size} bytes (warning threshold ${maxBytes})`);
}

console.log(`[final-boundary] ok (stage ${baseline.stage})`);
if (warnings.length) {
  console.warn('[final-boundary] page size warnings');
  for (const line of warnings) console.warn(`  - ${line}`);
}
