'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

if (process.env.GITHUB_ACTIONS !== 'true') throw new Error('Run this script in the manual installer publishing workflow.');
const repo = process.env.GITHUB_REPOSITORY;
const runId = process.env.BUILD_RUN_ID;
if (!/^[\w.-]+\/[\w.-]+$/.test(repo || '') || !/^\d+$/.test(runId || '')) throw new Error('Invalid repository or build run ID.');
const { version } = require('../package.json');
const tag = `v${version}`;
const name = `Impromptu-${version}-Windows-x64-Setup.exe`;
const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
const api = endpoint => JSON.parse(gh('api', `repos/${repo}/${endpoint}`));
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const repository = JSON.parse(gh('api', `repos/${repo}`));
if (!repository.private) throw new Error('This publishing workflow is intended for the private repository.');
const run = api(`actions/runs/${runId}`);
if (run.status !== 'completed' || run.conclusion !== 'success' || run.path !== '.github/workflows/windows-installer.yml' || run.head_repository?.full_name !== repo || run.head_branch !== 'main') {
  throw new Error('Choose a successful Windows installer workflow from this repository’s main branch.');
}
const buildPackage = api(`contents/package.json?ref=${run.head_sha}`);
if (JSON.parse(Buffer.from(buildPackage.content, 'base64')).version !== version) throw new Error('The tested build has a different app version.');
const release = () => api(`releases/tags/${tag}`);
if (release().draft) throw new Error('The existing app release must already be published.');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'impromptu-publish-'));
try {
  gh('run', 'download', runId, '--repo', repo, '--name', 'impromptu-windows-installer', '--dir', temporary);
  const installer = path.join(temporary, name);
  const buildChecksum = fs.readFileSync(path.join(temporary, 'SHA256SUMS-Windows-Installer.txt'), 'utf8').trim();
  const expected = digest(installer);
  if (buildChecksum !== `${expected}  ${name}`) throw new Error('The installer does not match its tested build checksum.');
  const before = release();
  const existing = before.assets.find(asset => asset.name === name);
  if (existing && (existing.digest !== `sha256:${expected}` || existing.size !== fs.statSync(installer).size)) {
    throw new Error('A different installer with this name already exists; leaving it unchanged.');
  }
  const manifest = path.join(temporary, 'SHA256SUMS.txt');
  gh('release', 'download', tag, '--repo', repo, '--pattern', 'SHA256SUMS.txt', '--dir', temporary);
  const entries = new Map();
  for (const line of fs.readFileSync(manifest, 'utf8').trim().split(/\r?\n/)) {
    const match = /^([a-f0-9]{64})  ([\w.-]+)$/.exec(line);
    if (!match) throw new Error('Invalid existing release checksum manifest.');
    const asset = before.assets.find(item => item.name === match[2]);
    if (!asset || asset.digest !== `sha256:${match[1]}`) throw new Error(`Existing release checksum cannot be verified: ${match[2]}`);
    entries.set(match[2], match[1]);
  }
  if (!existing) gh('release', 'upload', tag, '--repo', repo, installer);
  const uploaded = release().assets.find(asset => asset.name === name);
  if (uploaded?.state !== 'uploaded' || uploaded.digest !== `sha256:${expected}` || uploaded.size !== fs.statSync(installer).size) {
    throw new Error('The uploaded installer could not be verified.');
  }
  entries.set(name, expected);
  fs.writeFileSync(manifest, [...entries].map(([filename, hash]) => `${hash}  ${filename}`).join('\n') + '\n');
  gh('release', 'upload', tag, '--repo', repo, manifest, '--clobber');
  if (release().assets.find(asset => asset.name === 'SHA256SUMS.txt')?.digest !== `sha256:${digest(manifest)}`) {
    throw new Error('The uploaded checksum manifest could not be verified.');
  }
  console.log(`Published and checksum-verified ${name} from successful Windows run ${runId} (${run.head_sha}).`);
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
