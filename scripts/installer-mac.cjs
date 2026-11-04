'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

if (process.platform !== 'darwin') throw new Error('The Mac installer must be built on macOS.');
const arch = process.argv[2] || 'arm64';
if (!['arm64', 'x64'].includes(arch)) throw new Error('Choose arm64 or x64.');
const root = path.resolve(__dirname, '..');
const { version } = require('../package.json');
const source = path.join(root, 'release', `v${version}`, `Impromptu-darwin-${arch}`, 'Impromptu.app');
if (!fs.existsSync(source)) throw new Error('Package the Mac app before building its installer.');
const run = (tool, args, capture = false) => execFileSync(tool, args, { encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit' });
const builtVersion = run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', path.join(source, 'Contents/Info.plist')], true).trim();
if (builtVersion !== version) throw new Error('The packaged app version does not match package.json.');
const minimumOS = run('/usr/libexec/PlistBuddy', ['-c', 'Print :LSMinimumSystemVersion', path.join(source, 'Contents/Info.plist')], true).trim();
const cpu = arch === 'arm64' ? 'arm64' : 'x86_64';
const architectures = run('/usr/bin/lipo', ['-archs', path.join(source, 'Contents/MacOS/Impromptu')], true).trim().split(/\s+/);
if (!architectures.includes(cpu)) throw new Error('The packaged app has the wrong CPU architecture.');
const cache = path.join(root, '.cache');
fs.mkdirSync(cache, { recursive: true });
const staging = fs.mkdtempSync(path.join(cache, 'mac-installer-'));
const output = path.join(root, 'release', `Impromptu-${version}-Mac-${arch === 'arm64' ? 'Apple-Silicon' : 'Intel'}-Installer.pkg`);
const plist = (name, data) => {
  const file = path.join(staging, name);
  fs.writeFileSync(file, JSON.stringify(data));
  run('/usr/bin/plutil', ['-convert', 'xml1', file]);
  return file;
};

try {
  const payload = path.join(staging, 'payload');
  fs.mkdirSync(payload);
  run('/usr/bin/ditto', [source, path.join(payload, 'Impromptu.app')]);
  // Never let Installer find and overwrite a development copy elsewhere on disk.
  const components = plist('components.plist', [{
    RootRelativeBundlePath: 'Impromptu.app',
    BundleIsRelocatable: false,
    BundleHasStrictIdentifier: true,
    BundleIsVersionChecked: true,
    BundleOverwriteAction: 'upgrade'
  }]);
  const component = path.join(staging, 'Impromptu.pkg');
  run('/usr/bin/pkgbuild', [
    '--root', payload, '--component-plist', components,
    '--identifier', 'com.impromptu.companion.pkg', '--version', version,
    '--install-location', '/Applications', '--ownership', 'recommended', component
  ]);
  const requirements = plist('requirements.plist', { arch: [cpu], os: [minimumOS] });
  const distribution = path.join(staging, 'Distribution.xml');
  run('/usr/bin/productbuild', ['--synthesize', '--product', requirements, '--package', component, distribution]);
  let xml = fs.readFileSync(distribution, 'utf8');
  xml = xml.replace(/(<installer-gui-script[^>]*>)/, '$1\n    <title>Impromptu</title>\n    <welcome file="Welcome.html"/>\n    <conclusion file="Conclusion.html"/>\n    <domains enable_localSystem="true" enable_currentUserHome="false" enable_anywhere="false"/>');
  fs.writeFileSync(distribution, xml);
  const resources = path.join(staging, 'resources');
  fs.mkdirSync(resources);
  const html = (title, content) => `<!doctype html><html lang="en"><meta charset="utf-8"><title>${title}</title><style>body{font:14px -apple-system,BlinkMacSystemFont,sans-serif;line-height:1.6;margin:28px}h1{font-size:24px}code{font-size:13px}</style><body><h1>${title}</h1>${content}</body></html>`;
  fs.writeFileSync(path.join(resources, 'Welcome.html'), html('Install Impromptu', `
    <p>This installs Impromptu ${version} in your Applications folder. It opens in its own desktop window and includes its runtime. No terminal, Node.js, or project folder is needed to open it.</p>
    <p>Save any current draft and quit an older Impromptu before continuing.</p>
    <p>Offline prompt coaching works immediately. Hyland knowledge lookup requires a locally installed, signed-in Codex with the Atlassian connector enabled. AI connections need network access.</p>
    <p>This hackathon build and installer are unsigned and not notarized. Managed-device policies may require IT approval.</p>`));
  fs.writeFileSync(path.join(resources, 'Conclusion.html'), html('Open Impromptu', `
    <p>Open <strong>Applications → Impromptu</strong>, or press <strong>Command+Space</strong> and search for Impromptu.</p>
    <p>While Impromptu is running, copy text from any app and press <strong>Command+Shift+I</strong> to bring it into Impromptu.</p>
    <p>Choose <strong>Settings → Appearance → Dark</strong> for dark mode. Closing the window keeps the app in the menu bar; use Quit Impromptu to stop it.</p>
    <p>Saved sessions and settings are kept separately from the app and retained during upgrades. The app does not start at login automatically.</p>`));
  run('/usr/bin/productbuild', ['--distribution', distribution, '--package-path', staging, '--resources', resources, '--identifier', 'com.impromptu.companion.installer', '--version', version, output]);
  console.log(`Installer ready: ${output}`);
} finally {
  fs.rmSync(staging, { recursive: true, force: true });
}
