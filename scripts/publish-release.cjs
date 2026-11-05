'use strict';
// CI-only: both platform artifacts must be from this exact run's commit/version.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { version } = require('../package.json');
if (process.env.GITHUB_ACTIONS !== 'true' || !process.env.GITHUB_SHA || !process.env.GITHUB_REPOSITORY) throw new Error('Run through the Desktop release workflow.');
const dir = 'release/distribution';
const manifests = ['mac', 'windows'].map(platform => JSON.parse(fs.readFileSync(path.join(dir, `${platform}.json`), 'utf8')));
const expected = { mac: 'Impromptu-Mac-Apple-Silicon-Installer.pkg', windows: 'Impromptu-Windows-x64-Setup.exe' };
for (const [index, m] of manifests.entries()) {
  const platform = ['mac', 'windows'][index];
  if (m.platform !== platform || m.file !== expected[platform] || m.version !== version || m.commit !== process.env.GITHUB_SHA) throw new Error('Release artifact provenance mismatch.');
  const digest = crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, m.file))).digest('hex');
  if (digest !== m.sha256) throw new Error('Release artifact checksum mismatch.');
}
fs.writeFileSync(path.join(dir, 'SHA256SUMS.txt'), manifests.map(m => `${m.sha256}  ${m.file}`).join('\n') + '\n');
fs.writeFileSync(path.join(dir, 'release.json'), JSON.stringify({ version, commit: process.env.GITHUB_SHA, builds: manifests }, null, 2) + '\n');
const notes = path.join(dir, 'release-notes.md');
fs.writeFileSync(notes, `Mac Apple Silicon and Windows x64 installers built from the same commit: ${process.env.GITHUB_SHA}.\n\nBoth platforms passed source/unit checks and native startup checks; Windows also passed install/uninstall checks. Live AI access requires each user's own provider configuration.\n\nUnsigned hackathon preview. Save drafts and quit the old app before upgrading. Settings and saved sessions are retained.\n`);
const run = args => execFileSync('gh', args, { stdio: 'inherit' });
const tag = `v${version}`;
const repo = process.env.GITHUB_REPOSITORY;
const tags = JSON.parse(execFileSync('gh', ['api', `repos/${repo}/git/matching-refs/tags/${tag}`], { encoding: 'utf8' }));
if (tags.some(ref => ref.ref === `refs/tags/${tag}`)) throw new Error('This version already has a remote tag. Bump package.json before releasing.');
// Existing versions are intentionally immutable. A rerun must use a new version,
// or a maintainer must explicitly remove an incomplete draft first.
run(['release', 'create', tag, '--repo', repo, '--target', process.env.GITHUB_SHA, '--draft', '--title', `Impromptu ${tag} — Mac and Windows`, '--notes-file', notes]);
run(['release', 'upload', tag, '--repo', repo, ...manifests.map(m => path.join(dir, m.file)), path.join(dir, 'SHA256SUMS.txt'), path.join(dir, 'release.json')]);
run(['release', 'edit', tag, '--repo', repo, '--draft=false', '--latest']);
