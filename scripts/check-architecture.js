const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const baselinePath = path.join(__dirname, 'architecture-baseline.json');
const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));

let failed = false;

for (const file of baseline.pageFiles) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) {
    console.error(`[architecture-check] missing page file: ${file}`);
    failed = true;
    continue;
  }
  const text = fs.readFileSync(full, 'utf8');
  for (const rule of baseline.bannedPatterns) {
    const re = new RegExp(rule.pattern, 'g');
    if (re.test(text)) {
      console.error(`[architecture-check] ${rule.label} detected in ${file}`);
      failed = true;
    }
  }
}

for (const rule of baseline.helperRules) {
  const full = path.join(root, rule.file);
  if (!fs.existsSync(full)) continue;
  const text = fs.readFileSync(full, 'utf8');
  const re = new RegExp(rule.pattern, 'g');
  if (re.test(text)) {
    console.error(`[architecture-check] ${rule.label} detected in ${rule.file}`);
    failed = true;
  }
}

if (failed) process.exit(1);
console.log(`[architecture-check] ok (stage ${baseline.stage})`);
