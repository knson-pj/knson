#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const htmlFiles = ['index.html', 'admin-index.html', 'agent-index.html', 'general-register.html'];
const requiredOrder = ['knson-core.js', 'knson-shared.js', 'knson-property-domain.js', 'knson-schema.js', 'knson-property-renderers.js', 'knson-data-access.js'];
const errors = [];

for (const file of htmlFiles) {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  const positions = requiredOrder.map((name) => text.indexOf(name));
  if (positions.some((pos) => pos < 0)) {
    errors.push(`${file}: 공통 자산 누락 (${requiredOrder.filter((_, i) => positions[i] < 0).join(', ')})`);
    continue;
  }
  for (let i = 1; i < positions.length; i += 1) {
    if (positions[i] < positions[i - 1]) {
      errors.push(`${file}: 공통 자산 로드 순서 오류 (${requiredOrder.join(' -> ')})`);
      break;
    }
  }
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}

console.log('HTML asset check passed.');
