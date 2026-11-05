'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { version } = require('../package.json');
if (process.platform !== 'darwin') throw new Error('Requires macOS.');
const executable = path.resolve(`release/v${version}/Impromptu-darwin-arm64/Impromptu.app/Contents/MacOS/Impromptu`);
fs.mkdirSync('.cache', { recursive: true });
(async () => {
  for (const theme of ['system', 'light', 'dark', 'glass', 'max-ind']) {
    const profile = fs.mkdtempSync(path.resolve('.cache', 'mac-startup-'));
    fs.writeFileSync(path.join(profile, 'workspace.json'), JSON.stringify({ theme, connection: { mode: 'offline' }, importClipboard: false, history: [] }));
    const env = { ...process.env, IMPROMPTU_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(executable, [], { env, stdio: 'ignore' });
    let failed;
    child.on('error', error => { failed = error; });
    await new Promise(resolve => setTimeout(resolve, 3500));
    const alive = child.exitCode === null && child.signalCode === null && !failed;
    if (alive) {
      const exited = new Promise(resolve => child.once('exit', resolve));
      child.kill('SIGTERM'); await exited;
    }
    fs.rmSync(profile, { recursive: true, force: true });
    if (!alive) throw failed || new Error(`Mac app exited during ${theme} startup.`);
    console.log(`Mac process startup passed: ${theme}`);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
