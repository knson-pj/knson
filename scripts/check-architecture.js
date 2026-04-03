const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const bannedPatterns = [
  { re: /sb\.from\(['"]properties['"]\)/g, files: ['admin-app.js', 'agent-app.js', 'app.js'], label: 'page-level direct properties query' },
];

let failed = false;
for (const rule of bannedPatterns) {
  for (const file of rule.files) {
    const full = path.join(root, file);
    if (!fs.existsSync(full)) continue;
    const text = fs.readFileSync(full, 'utf8');
    if (rule.re.test(text)) {
      console.error(`[architecture-check] ${rule.label} detected in ${file}`);
      failed = true;
    }
  }
}
if (failed) process.exit(1);
console.log('[architecture-check] ok');
