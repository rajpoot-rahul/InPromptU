'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { packager } = require('@electron/packager');
const [platform = process.platform, arch = process.arch] = process.argv.slice(2);
if (!['darwin', 'win32'].includes(platform) || !['arm64', 'x64'].includes(arch)) throw new Error('Supported builds: darwin arm64/x64, win32 arm64/x64.');
const root = path.resolve(__dirname, '..');
const version = require('../package.json').version;
(async () => {
  const outputs = await packager({
    dir: root, name: 'Impromptu', platform, arch,
    out: path.join(root, 'release', `v${version}`), overwrite: true, asar: true,
    appBundleId: 'com.impromptu.companion', appCategoryType: 'public.app-category.productivity',
    appCopyright: 'Impromptu hackathon prototype',
    icon: path.join(root, 'src/assets', platform === 'darwin' ? 'icon.icns' : 'icon.ico'),
    ignore: [/^\/release($|\/)/, /^\/tests($|\/)/, /^\/scripts($|\/)/, /^\/docs($|\/)/, /^\/\.github($|\/)/, /^\/\.cache($|\/)/, /^\/\.git($|\/)/, /^\/README\.md$/, /^\/CONTRIBUTING\.md$/, /^\/\.nvmrc$/, /^\/Launch Impromptu\.command$/],
    osxSign: false,
    win32metadata: { CompanyName: 'Impromptu', FileDescription: 'Impromptu prompt companion', ProductName: 'Impromptu' }
  });
  if (platform === 'darwin') {
    const localSigning = require('./local-signing.cjs');
    // CI and other machines keep ad-hoc builds; this Mac signs with its stable local identity when present.
    if (localSigning.exists()) for (const output of outputs) localSigning.sign(path.join(output, 'Impromptu.app'));
  }
  for (const output of outputs) {
    fs.writeFileSync(path.join(output, 'START HERE.txt'), `Impromptu ${version} — hackathon prototype\n\n${platform === 'darwin' ? 'Open Impromptu.app. This build is for Apple Silicon Macs.' : 'Extract the entire folder, then open Impromptu.exe. Keep its supporting files together. This build is for Windows x64.'}\n\nIf an older Impromptu is running, save your draft and Quit it first. Closing its window only hides it.\n\nCopy a message from Teams or any app. Press ${platform === 'darwin' ? 'Command+Shift+I' : 'Ctrl+Shift+I'}. In Knowledge & reply, click Connect via Codex, then Find context & draft reply. Review the sources and editable reply, copy it and paste back into Teams.\n\nKnowledge requires a local Codex install, your own sign-in, and its enabled Atlassian connector for hyland.atlassian.net. Connection options can locate codex.exe on Windows. Codex owns sign-in; no Jira tokens are included. Searches are read-only. AI drafting uses your Codex model and account usage. Turn drafting off for source retrieval only. This uses experimental app-server APIs tested with Codex CLI 0.165.0-alpha.1.2; versions and managed policies can affect compatibility.\n\nSettings > Appearance offers System, Light and Dark. The choice applies immediately and is remembered.\n\nPrompt workspace still supports offline skills, local Ollama or an approved Chat Completions endpoint. API keys stay in memory only. Closing the window keeps the tray/menu-bar companion running; use Quit to stop it.\n\nNo automatic startup, typing observation, or automatic sending. Select-and-copy is required; native right-click integration is not included.\n\nThis prototype is unsigned (not notarized on macOS). Windows behavior must be tested on Windows before wider distribution.\n`);
    console.log(output);
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
