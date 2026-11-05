# Developing Impromptu

## First run (Mac and Windows)

1. Install Git and Node **24 LTS**. On Mac with nvm, run `nvm install` and `nvm use`; on Windows select Node 24 with your normal installer or version manager.
2. Clone the private repo with your GitHub account, then open a terminal in the repo folder.
3. Run `npm ci`, `npm run doctor`, then `npm run dev`.

The installed desktop app bundles Electron; only developers need Node. Never use `Launch Impromptu.command` for active source development: it intentionally prefers the installed app. The dev command uses `.cache/dev-user-data`; `npm start` uses the normal installed-app profile. Saved real user data is not a development fixture. Close the installed app when testing Cmd+Shift+I / Ctrl+Shift+I to avoid shortcut contention.

Do not set `ELECTRON_SKIP_BINARY_DOWNLOAD` for interactive development. CI source checks can skip it; native release jobs cannot.

## Daily changes

Create a branch from updated main, make changes, then run:

```sh
npm run verify
```

This checks every JavaScript source/build/test file, validates version alignment and runs the unit tests. Open a PR; Desktop checks runs on Mac and Windows. The repository owner should require both jobs in branch protection before a team-wide rollout. Those remote settings are not configured by these files.

Use `npm ci` after pulling a changed lockfile. Runtime libraries belong in `dependencies`; build/test tools belong in `devDependencies`. Commit both package files together. Never bulk-replace a version string in the lockfile, because it can change unrelated dependencies.

## AI configuration

Use your own account, profile and model access. Do not commit keys, AWS config, Codex tokens or company documents. Offline mode is a template, not AI. Test AI connection sends a fictional sample and can consume quota/credits; it never silently falls back to offline output.

- OpenRouter: key + `openrouter/free` or another deliberately chosen model ID.
- Hugging Face: inference-enabled token + supported model ID; free accounts require credits.
- Bedrock: AWS CLI v2, `aws configure sso`, profile name, region and approved model/inference-profile ID. Sign in through the Settings button, then test. No shared team AWS secrets.
- Knowledge & Reply: independent Codex/Atlassian connection; prompt-provider settings do not configure it.

## Local builds

```sh
npm run installer:mac
npm run installer:windows
```

**Keep macOS permissions across local rebuilds (mascot features).** Ad-hoc builds get a new code identity every time, so macOS silently stops applying Accessibility and Screen Recording grants after each reinstall, even while System Settings still shows them as on. Run `node scripts/local-signing.cjs setup` once. It creates a self-signed "Impromptu Local Signing" certificate in your login keychain, and `npm run package:mac` then signs with it automatically. The designated requirement stays `identifier "com.impromptu.companion" and certificate leaf = H"…"`, so grants persist. To clear stale grants from older builds: `tccutil reset ScreenCapture com.impromptu.companion` and `tccutil reset Accessibility com.impromptu.companion`. CI is unchanged and still produces ad-hoc builds.

Build Mac installers on macOS. Windows can be cross-built, but installation must be checked on Windows. Expected output names are derived from `package.json`:

- `release/Impromptu-<version>-Mac-Apple-Silicon-Installer.pkg`
- `release/windows-installer/Impromptu-<version>-Windows-x64-Setup.exe`
- Portable apps: `release/v<version>/Impromptu-darwin-arm64/Impromptu.app` and `release/v<version>/Impromptu-win32-x64/Impromptu.exe`.

Save drafts and quit the existing app before replacing it. Installed apps do not update automatically. Generated files stay out of Git.

## One release for both platforms

1. Choose a version not already released. For the next patch use `npm version patch --no-git-tag-version`. This updates both package files; do not manually edit launcher paths or create a tag.
2. Run `npm run verify`, review the changes and merge/push to main. The initial aligned release can use the existing unpublished 0.2.7 version.
3. In GitHub Actions, run **Desktop release** on `main`. Leave **publish** off for a rehearsal; artifacts are retained for 14 days. Turn it on to publish both installers after validation. With GitHub CLI:

```sh
gh workflow run desktop-release.yml --ref main -f publish=true
```

4. Wait for both build jobs and the publish job. The workflow checks native startup, verifies artifact versions/commit hashes/checksums, creates a draft, uploads both installers and a manifest, then makes it the latest release. A failed build publishes nothing; an upload failure leaves a draft.
5. Download each installer and do the manual acceptance checks below. Share the release page with the team.

The release uses stable asset names, so after the first successful aligned release these links remain usable:

- [Latest Mac installer](https://github.com/rajpoot-rahul/InPromptU/releases/latest/download/Impromptu-Mac-Apple-Silicon-Installer.pkg)
- [Latest Windows installer](https://github.com/rajpoot-rahul/InPromptU/releases/latest/download/Impromptu-Windows-x64-Setup.exe)
- [Latest release and checksums](https://github.com/rajpoot-rahul/InPromptU/releases/latest)

An existing version/tag is never overwritten. If publication fails, inspect the draft before removing it or choose a new patch version. Do not combine artifacts from different workflow runs. Only the publish job has release-write permission. Private repository Actions consume the account's included/billed runner minutes.

## Manual acceptance

On each actual OS: verify displayed version, switch all five themes, resize and switch tabs, copy sample text and summon using the global shortcut, save/reopen a sample session, and test one authorised provider. Check upgrade preservation of settings/history. Verify company Codex/Atlassian access separately. Automated startup checks do not replace these interactive checks.

## If pushing is blocked in the coding environment

Commits remain local. From your own terminal:

```sh
cd /Users/rahul.rajpoot/Documents/wrkDir/InPromptU
git push origin main
```

Other teammates should use their own checkout path. After the workflow files are pushed, the GitHub release command above becomes available. Never report a release as published until GitHub confirms it.
