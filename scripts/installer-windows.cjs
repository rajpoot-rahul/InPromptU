'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { build, Platform, Arch } = require('electron-builder');
const { extractFile } = require('@electron/asar');

const root = path.resolve(__dirname, '..');
const { version } = require('../package.json');
const source = path.join(root, 'release', `v${version}`, 'Impromptu-win32-x64');
const archive = path.join(source, 'resources', 'app.asar');
if (!fs.existsSync(archive)) throw new Error('Package the Windows x64 app before building its installer.');
const packaged = JSON.parse(extractFile(archive, 'package.json').toString());
if (packaged.version !== version) throw new Error('The packaged app version does not match package.json.');
const executable = fs.readFileSync(path.join(source, 'Impromptu.exe'));
const peOffset = executable.readUInt32LE(0x3c);
if (executable.toString('ascii', peOffset, peOffset + 4) !== 'PE\0\0' || executable.readUInt16LE(peOffset + 4) !== 0x8664) {
  throw new Error('The packaged app must be Windows x64.');
}

build({
  projectDir: root,
  prepackaged: source,
  targets: Platform.WINDOWS.createTarget('nsis', Arch.x64),
  publish: 'never',
  config: {
    appId: 'com.impromptu.companion',
    productName: 'Impromptu',
    executableName: 'Impromptu',
    directories: { output: path.join(root, 'release', 'windows-installer') },
    artifactName: 'Impromptu-${version}-Windows-x64-Setup.${ext}',
    npmRebuild: false,
    win: {
      icon: path.join(root, 'src/assets/icon.ico'),
      // The prepackaged app already has its icon and version resources.
      signAndEditExecutable: false
    },
    nsis: {
      oneClick: false,
      perMachine: false,
      selectPerMachineByDefault: false,
      allowElevation: true,
      allowToChangeInstallationDirectory: true,
      createDesktopShortcut: true,
      createStartMenuShortcut: true,
      shortcutName: 'Impromptu',
      uninstallDisplayName: 'Impromptu',
      deleteAppDataOnUninstall: false,
      runAfterFinish: false,
      differentialPackage: false,
      installerIcon: path.join(root, 'src/assets/icon.ico'),
      uninstallerIcon: path.join(root, 'src/assets/icon.ico')
    }
  }
}).then(files => files.forEach(file => console.log(`Installer ready: ${file}`)))
  .catch(error => { console.error(error); process.exitCode = 1; });
