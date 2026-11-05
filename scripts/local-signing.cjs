'use strict';
// Local-only code signing so macOS keeps Accessibility and Screen Recording grants across rebuilds.
// Ad-hoc builds get a new identity every build; a stable self-signed certificate does not.
// Usage: node scripts/local-signing.cjs setup | status | sign <path-to-.app>
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const NAME = 'Impromptu Local Signing';
const run = (file, args, options = {}) => execFileSync(file, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options });
function exists() {
  if (process.platform !== 'darwin') return false;
  try { return run('/usr/bin/security', ['find-identity', '-p', 'codesigning']).includes(`"${NAME}"`); } catch { return false; }
}
function setup() {
  if (process.platform !== 'darwin') throw new Error('Local signing is only needed on macOS.');
  if (exists()) { console.log(`${NAME} already exists in your login keychain.`); return; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'impromptu-sign-'));
  const password = crypto.randomBytes(18).toString('hex');
  try {
    fs.writeFileSync(path.join(dir, 'cert.cnf'), `[req]\ndistinguished_name=dn\nprompt=no\nx509_extensions=ext\n[dn]\nCN=${NAME}\n[ext]\nbasicConstraints=critical,CA:false\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=critical,codeSigning\n`);
    run('/usr/bin/openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '3650', '-config', path.join(dir, 'cert.cnf'), '-keyout', path.join(dir, 'key.pem'), '-out', path.join(dir, 'cert.pem')]);
    run('/usr/bin/openssl', ['pkcs12', '-export', '-inkey', path.join(dir, 'key.pem'), '-in', path.join(dir, 'cert.pem'), '-name', NAME, '-out', path.join(dir, 'identity.p12'), '-passout', 'env:IMPROMPTU_P12'], { env: { ...process.env, IMPROMPTU_P12: password } });
    run('/usr/bin/security', ['import', path.join(dir, 'identity.p12'), '-k', path.join(os.homedir(), 'Library/Keychains/login.keychain-db'), '-P', password, '-T', '/usr/bin/codesign']);
    console.log(`Created "${NAME}" in your login keychain. It is used only to sign Impromptu builds on this Mac.`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
function sign(app) {
  if (!exists()) throw new Error(`Run "node scripts/local-signing.cjs setup" first.`);
  if (!app || !fs.existsSync(app)) throw new Error('Pass the path to Impromptu.app.');
  run('/usr/bin/codesign', ['--force', '--deep', '--sign', NAME, '--identifier', 'com.impromptu.companion', app]);
  const info = run('/usr/bin/codesign', ['-d', '-r-', app], { stdio: ['ignore', 'pipe', 'pipe'] });
  console.log(`Signed ${path.basename(app)} with "${NAME}". ${info.trim().split('\n').find(line => line.includes('designated')) || ''}`);
}

if (require.main === module) {
  const [command, target] = process.argv.slice(2);
  try {
    if (command === 'setup') setup();
    else if (command === 'sign') sign(target);
    else if (command === 'status') console.log(exists() ? `${NAME}: present` : `${NAME}: not set up`);
    else console.log('Usage: node scripts/local-signing.cjs setup | status | sign <path-to-.app>');
  } catch (error) { console.error(error.stderr?.toString().trim() || error.message); process.exitCode = 1; }
}
module.exports = { NAME, exists, sign };
