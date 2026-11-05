'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const pkg = require('../package.json');
const lock = require('../package-lock.json');
if (pkg.version !== lock.version || pkg.version !== lock.packages[''].version) throw new Error('Version mismatch. Use npm version patch --no-git-tag-version.');
for (const dir of ['src', 'scripts', 'tests', 'extensions/chatgpt-context']) {
  for (const file of fs.readdirSync(path.join(root, dir))) {
    if (/\.(cjs|js)$/.test(file)) execFileSync(process.execPath, ['--check', path.join(root, dir, file)], { stdio: 'inherit' });
  }
}
console.log(`Source syntax and version alignment OK: ${pkg.version}`);
