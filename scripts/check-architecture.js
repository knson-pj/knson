const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const pageFiles = [
  'admin-app.js',
  'admin-tab-properties.js',
  'admin-tab-new-property.js',
  'admin-tab-staff-regions.js',
  'agent-app.js',
  'app.js',
  'general-register.js',
];

const bannedPatterns = [
  { re: /sb\.from\(['"]properties['"]\)/g, label: 'page-level direct properties query' },
  { re: /['"]\/admin\/properties['"]/g, label: 'page-level direct /admin/properties endpoint' },
  { re: /['"]\/properties['"]/g, label: 'page-level direct /properties endpoint' },
  { re: /['"]\/public-listings['"]/g, label: 'page-level direct /public-listings endpoint' },
  { re: /['"]\/admin\/staff['"]/g, label: 'page-level direct /admin/staff endpoint' },
  { re: /['"]\/admin\/region-assignments['"]/g, label: 'page-level direct /admin/region-assignments endpoint' },
];

const helperRules = [];


let failed = false;
for (const file of pageFiles) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) continue;
  const text = fs.readFileSync(full, 'utf8');
  for (const rule of bannedPatterns) {
    rule.re.lastIndex = 0;
    if (rule.re.test(text)) {
      console.error(`[architecture-check] ${rule.label} detected in ${file}`);
      failed = true;
    }
  }
}
for (const rule of helperRules) {
  const full = path.join(root, rule.file);
  if (!fs.existsSync(full)) continue;
  const text = fs.readFileSync(full, 'utf8');
  rule.re.lastIndex = 0;
  if (rule.re.test(text)) {
    console.error(`[architecture-check] ${rule.label} detected in ${rule.file}`);
    failed = true;
  }
}
if (failed) process.exit(1);
console.log('[architecture-check] ok');
