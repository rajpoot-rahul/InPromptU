'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { version } = require('../package.json');

for (const mismatch of ['commit', 'checksum']) {
  test(`release refuses ${mismatch} mismatch before publication`, t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'impromptu-release-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const dir = path.join(root, 'release', 'distribution'); fs.mkdirSync(dir, { recursive: true });
    for (const [platform, file] of Object.entries({ mac: 'Impromptu-Mac-Apple-Silicon-Installer.pkg', windows: 'Impromptu-Windows-x64-Setup.exe' })) {
      fs.writeFileSync(path.join(dir, file), 'synthetic artifact');
      fs.writeFileSync(path.join(dir, `${platform}.json`), JSON.stringify({ platform, file, version, commit: mismatch === 'commit' ? 'other-commit' : 'test-commit', sha256: 'incorrect' }));
    }
    const result = spawnSync(process.execPath, [path.resolve(__dirname, '../scripts/publish-release.cjs')], {
      cwd: root, encoding: 'utf8', env: { ...process.env, GITHUB_ACTIONS: 'true', GITHUB_SHA: 'test-commit', GITHUB_REPOSITORY: 'example/test', GH_TOKEN: '' }
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, mismatch === 'commit' ? /provenance mismatch/ : /checksum mismatch/);
    assert.equal(fs.existsSync(path.join(dir, 'release.json')), false);
  });
}
