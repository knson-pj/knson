const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const files = ['index.html', 'admin-index.html', 'agent-index.html', 'general-register.html'];
const expected = [
  'knson-core.js',
  'knson-shared.js',
  'knson-schema.js',
  'knson-property-domain.js',
  'knson-property-renderers.js',
  'knson-data-access.js',
];

let failed = false;
for (const file of files) {
  const html = fs.readFileSync(path.join(root, file), 'utf8');
  const matches = [...html.matchAll(/<script\s+src="\.\/(knson-[^"]+\.js)\?v=[^"]+"/g)].map((m) => m[1]);
  const actual = expected.map((name) => matches.indexOf(name));
  if (actual.some((idx) => idx === -1)) {
    console.error(`[asset-check] missing shared asset in ${file}:`, expected.filter((name) => !matches.includes(name)).join(', '));
    failed = true;
    continue;
  }
  for (let i = 1; i < actual.length; i += 1) {
    if (actual[i - 1] > actual[i]) {
      console.error(`[asset-check] shared asset order mismatch in ${file}`);
      failed = true;
      break;
    }
  }
}
if (failed) process.exit(1);
console.log('[asset-check] ok');
