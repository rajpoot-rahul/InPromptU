'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { findAws } = require('../src/bedrock.cjs');
const { version } = require('../package.json');
const major = Number(process.versions.node.split('.')[0]);
console.log(`Impromptu ${version} | ${process.platform}/${process.arch} | Node ${process.versions.node}`);
if (major !== 24) { console.error('Use Node 24 LTS for the supported team toolchain.'); process.exitCode = 1; }
try {
  if (!fs.existsSync(require('electron'))) throw new Error('Electron binary missing');
  console.log('Electron: installed');
} catch { console.error('Electron missing. Run npm ci without ELECTRON_SKIP_BINARY_DOWNLOAD.'); process.exitCode = 1; }
console.log(`AWS CLI (optional, for Bedrock SSO): ${findAws() ? 'found' : 'not found'}`);
console.log('Development profile: .cache/dev-user-data (separate from installed app data).');
console.log('Provider keys and model access are configured individually in Settings.');
