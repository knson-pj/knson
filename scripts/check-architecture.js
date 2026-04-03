#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const pageFiles = ['admin-app.js', 'agent-app.js', 'app.js', 'general-register.js'];
const errors = [];

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

for (const file of pageFiles) {
  const text = read(file);
  const lines = text.split(/\r?\n/);
  lines.forEach((line, idx) => {
    const n = idx + 1;
    if (/\.from\("properties"\)|\.from\('properties'\)/.test(line)) {
      errors.push(`${file}:${n} 페이지 레이어에서 직접 Supabase properties 접근 발견`);
    }
    if (/fetch\(\s*["'`](?:\.\/)?(?:api\/|\$\{API_BASE\}\/)/.test(line)) {
      errors.push(`${file}:${n} 페이지 레이어에서 직접 fetch 호출 발견`);
    }
  });
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}

console.log('Architecture check passed.');
