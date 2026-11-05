# Impromptu desktop

A Mac-first companion based on the [hackathon brief](https://impromptu-hackathon-brief.hyland-0170.chatgpt.site/#idea). Copy a message from Teams, summon Impromptu, look up Hyland documentation, and review a source-backed reply. The original prompt-coaching workspace remains available.

## Current source — v0.2.7

The source includes **Glass** and **Max-ind · Maximal India** themes for Mac and Windows alongside System, Light and Dark. Both follow the device's light/dark appearance. Windows Glass uses CSS materials with an opaque canvas, without macOS vibrancy APIs. Glass uses a stable opaque canvas and limited blur layers to avoid stale content during tab switches. Max-ind adds jewel colours, textile-inspired borders and architectural details. Both platforms use their native window controls without the extra hide button.

Prompt improvement now supports **OpenRouter**, **Hugging Face**, and **Amazon Bedrock with AWS SSO**, alongside Ollama and a custom compatible API. Settings includes provider guidance and a **Test AI connection** action using a fictional prompt. Offline templates remain explicitly labelled as non-AI.

Build the current Mac source with `npm ci` and `npm run package:mac`; the output is `release/v0.2.7/Impromptu-darwin-arm64/Impromptu.app`. Save drafts and quit an older copy before launching it. The downloadable installers below remain **v0.2.1**; v0.2.7 installers have not been published. Build the Windows x64 installer with `npm run installer:windows`; the output is `release/windows-installer/Impromptu-0.2.7-Windows-x64-Setup.exe`. Windows-specific logic is covered by unit tests and renderer simulation; native installation and execution still require the Windows CI job. That job now checks startup in all five themes.

Validation: 25 automated tests pass, plus isolated Electron appearance and provider-form checks. The new providers have mocked transport tests; live inference requires your account credentials and model access. No credentials or generated app bundles are committed.

## Download an installer

- **[Download for Mac — Installer.pkg](https://github.com/rajpoot-rahul/InPromptU/releases/download/v0.2.1/Impromptu-0.2.1-Mac-Apple-Silicon-Installer.pkg)** — Apple Silicon, macOS 13 or later. Run the installer, then open **Applications → Impromptu**.
- **[Download for Windows — Setup.exe](https://github.com/rajpoot-rahul/InPromptU/releases/download/v0.2.1/Impromptu-0.2.1-Windows-x64-Setup.exe)** — Windows x64. Run Setup, then open **Impromptu** from the Start Menu or desktop shortcut. It includes an uninstaller in Windows Installed apps.

Both are unsigned hackathon preview builds. Sign in to a GitHub account with repository access to download from this private repository. [Portable ZIPs, checksums, and all release assets](https://github.com/rajpoot-rahul/InPromptU/releases/tag/v0.2.1) are also available.

## Project and downloads

- [Concept and product vision](docs/concept.md) — the original idea, the implemented prototype, and the proposed next steps.
- [Demo walkthrough](docs/demo.md) — a short prompt-coaching and knowledge-retrieval demo.
- [v0.2.1 release](https://github.com/rajpoot-rahul/InPromptU/releases/tag/v0.2.1) — separate Mac and Windows installers, optional portable apps, and SHA-256 checksums.
- [Release notes and limitations](docs/releases/v0.2.1.md).

Application downloads are attached to the GitHub release. A source checkout does not include the `release/` directory. This repository and its releases require repository access while private.

![Impromptu Knowledge and reply workspace in dark mode](docs/images/knowledge-dark.png)

## Install and open the app

- **Apple Silicon Mac:** open `release/Impromptu-0.2.1-Mac-Apple-Silicon-Installer.pkg` and follow macOS Installer. This places **Impromptu.app** in **Applications**. Open it there, or use Spotlight (Command+Space → Impromptu). The installer requires macOS 13 or later on Apple Silicon. It does not download dependencies or run installation scripts.
- Impromptu runs in its **own desktop window**, loading the interface from files bundled inside the app. It is not a ChatGPT web page, extension, or embedded chat. Electron and the app code are included, so opening the installed app needs neither Node.js nor this project folder. **Hyland knowledge still requires the separate local Codex connection described below.** Installing Impromptu does not install Codex or grant Atlassian access.
- **Portable Mac alternative:** open `release/v0.2.7/Impromptu-darwin-arm64/Impromptu.app`. `Launch Impromptu.command` prefers an installed copy, then falls back to this build.
- **Windows x64:** download and run `Impromptu-0.2.1-Windows-x64-Setup.exe`, choose the installation location, then launch Impromptu from its desktop or Start Menu shortcut. Setup defaults to the current user and also supports an all-users installation with administrator approval. Uninstall through Windows Installed apps. Saved sessions are retained by default.
- **Portable Windows alternative:** extract the entire `Impromptu-0.2.1-Windows-x64.zip`, then open `Impromptu.exe`. Keep its supporting files together.
- **Updating from an older version:** save your current draft and choose Quit Impromptu before opening the new version. Both versions use the same local saved-session folder. The old build has been left intact.
- The app must be running for its global shortcut to work. Closing the window keeps it in the menu bar/system tray. Choose **Quit Impromptu** there to stop it. It does not start automatically at login.

## Appearance

Open **Settings → Appearance** and choose **System**, **Light**, or **Dark**. Changes apply immediately and are remembered on this device. System follows the operating system, including changes while the app is running. The theme covers both workspaces, source excerpts, dialogs, inputs, and native window controls. It is selected before the window opens to avoid a bright startup flash.

## Keyboard workflow

1. Open **Knowledge & reply** and click **Connect via Codex**. Use a locally installed, signed-in Codex with its Atlassian connector enabled for `hyland.atlassian.net`.
2. Select and **copy** a comment in Teams or another app.
3. Press **Command+Shift+I** on Mac or **Ctrl+Shift+I** on Windows.
4. Review the message. Optionally add a project, topic or issue key under **Search focus**.
5. Click **Find context & draft reply**, or Command/Ctrl+Enter. Turn **Draft a reply with Codex** off to retrieve sources without AI synthesis.
6. Review the source passages, supported facts, uncertainties and editable reply. **Copy reply with sources**, then paste it into Teams yourself.

The shortcut brings copied text into the last-used workspace (Knowledge & reply or Prompt workspace). It does not read the currently selected text directly or watch Teams. Another open draft is preserved behind an incoming-text banner. Blank or oversized messages are rejected rather than submitted automatically.

## Prompt-coaching workflow

1. Select and copy a draft in ChatGPT, Claude, Codex, or another tool.
2. Choose **Prompt workspace**, then use the global shortcut or Paste.
3. Review the imported prompt. Choose a starter skill and optionally add context, audience and output format.
4. Click **Improve prompt** or press **Command/Ctrl+Enter** inside the app.
5. Review/edit the result, copy it, then paste into the original tool. Impromptu never sends that final prompt for you.

The shortcut reads clipboard text once. There is no background clipboard polling or typing observation. If another draft is open, the incoming text is offered in a banner instead of overwriting it. Disable clipboard import in Settings to make the shortcut only summon the app. If the shortcut is occupied, Settings reports that; open the app from its tray/menu-bar icon.

## What works

- Existing Codex Atlassian connection reused through the official local app-server, with each employee's permissions.
- Separate semantic searches of Confluence and Jira, direct reads of mentioned issue keys and Confluence links, and up to six retrieved sources per lookup.
- AI knowledge summary, source passages, explicit gaps, editable Teams reply and copyable source links. Search-only and partial-failure states are supported.
- Native Electron window, menu bar/system tray, global shortcut and explicit clipboard import/export.
- Side-by-side original and editable improvement, change explanation and clarification suggestions.
- Five versioned starter skills: clear thinking, customer response, code investigation, document summary, business analysis. These are example templates, **not approved Hyland policies**.
- Optional saved sessions, reopen/copy, helpfulness feedback, deletion and JSON export.
- Personal progress derived only from saved original briefs. The text checks are heuristic signals, not an aptitude/productivity score.
- Offline skill application, local Ollama, and a configurable Chat Completions compatible API.

## Knowledge connection and evidence boundaries

This local prototype uses the documented [Codex app-server](https://learn.chatgpt.com/docs/app-server) JSON-RPC interface. It launches the installed `codex app-server --stdio`, checks the enabled Atlassian app, opens an ephemeral connector session, and calls exactly four allowlisted read tools: `getAccessibleAtlassianResources`, `search`, `getConfluenceContent`, and `getJiraIssue`. It discovers the user's Hyland cloud ID from their accessible resources. Returned/opened source URLs are restricted to `https://hyland.atlassian.net`. The renderer cannot choose arbitrary tools, tenants, executables, or external URLs.

No Jira API token or copied Codex credential is needed. Codex owns authentication; Impromptu does not read credential files or persist access tokens. Each teammate must have their own local Codex install, sign-in and connector access. If automatic executable detection fails, **Connection options → Locate Codex executable** opens a native file picker. Windows requires `codex.exe` on PATH or selected explicitly; an npm `.cmd` shim is not supported. A current app-server with direct MCP tool calls is required; tested here with `codex-cli 0.165.0-alpha.1.2`. These APIs are experimental and may differ on other installs.

Each search sends the editable search focus, or the first 1,000 characters of the message, to Atlassian. It requests ten results per product, retains up to three readable hits from each plus explicitly linked content within a six-source total, then reads full source bodies. Long bodies are reduced to bounded excerpts; this is shown in the UI. Search snippets from failed reads are visible but excluded from AI drafting. A partial search failure is reported; absent matches do not prove absent documentation.

With drafting enabled, the copied message and up to 60,000 characters of retrieved excerpts go to the model configured in the employee's Codex account, using that account's usage. Prompt-workspace API settings do not control this mode. The separate drafting session disables app connectors, plugins, shell, computer/browser interaction, image generation and agents, verifies its MCP inventory has no callable tools, and declines interactive operation requests. If custom MCP configuration still exposes tools, drafting fails closed and sources remain available. No agent turn is started for connector retrieval.

The model treats source content as untrusted data and must return structured facts with exact supporting quotations, source IDs, gaps and a draft reply. Validation rejects unknown source IDs, quotes absent from retrieved excerpts, and unsupported reply links. This validates provenance, **not factual entailment or completeness**: the employee still reviews the evidence, wording, audience, document age, and relevant ticket status. A failed draft returns sources and a clearly labeled clarification template. Nothing is posted to Teams, Jira or Confluence.

The app uses ephemeral Codex sessions and does not save knowledge lookups to its local session history. This does not promise zero retention by Codex or Atlassian: their service, diagnostic and organization policies still apply. Closing Impromptu closes its app-server connection. **Disconnect this session** does not revoke the user's connector in Codex.

## Model connections

The app starts in **Offline skills** mode. This preserves the original request and appends the selected skill/context. It is deterministic, requires no credentials, and is not AI rewriting. No model responses, token savings, provider billing, or organisation rankings are simulated.

For AI rewriting, open Settings:

- **Ollama:** start your existing Ollama service and choose an installed model. Endpoint: `http://localhost:11434/api/chat`. No model is installed by this project.
- **OpenRouter:** create a key at `openrouter.ai/settings/keys`, select OpenRouter and enter the key. The preset `openrouter/free` routes to free models subject to quotas. Other model IDs may incur charges.
- **Hugging Face:** create a token with Inference Providers permission at `huggingface.co/settings/tokens`, select Hugging Face and enter a supported chat model ID. Free accounts currently require purchased inference credits; eligible plans include allowances.
- **Amazon Bedrock / Claude:** install AWS CLI v2 and configure your company's SSO profile with `aws configure sso`. Select Bedrock, enter that profile and region, then click **Sign in with AWS SSO** to open the company browser login. Enter an authorised Claude model ID or inference profile ID/ARN. AWS manages SSO credentials; Impromptu saves only profile, region and model settings. Model tests and improvements are billed to that AWS account. IAM/model access and regional availability must permit the request.
- **Custom API:** enter the full Chat Completions endpoint URL, a model ID available to your account, and an API key if required. Example URL shape: `https://your-approved-host/v1/chat/completions`. Only HTTPS is accepted remotely; localhost may use HTTP. Query-string credentials and redirects are rejected.

Use **Test AI connection** to validate a fictional sample without sending your draft; this consumes provider quota or credits. Save settings after a successful test.

Clicking Improve sends your original prompt, supplied context, audience, format, and skill to that configured service. It asks for a structured rewrite, validates the returned shape, and reports provider-returned usage when available. Review semantic correctness. There are no tool calls or automatic retries. Requests time out after 90 seconds. Chat subscriptions do not automatically provide API entitlement.

API keys are held only in the desktop main process's memory until quit. They are not returned to the renderer or saved to disk. Changing endpoint clears the old key. Connection settings are saved; enter the key again after restarting.

## Privacy and storage

Drafts and unsaved improvements stay in the app's memory. Only **Save** writes a prompt-coaching session. Up to 100 sessions are retained locally in Electron's user-data folder (`~/Library/Application Support/Impromptu` on Mac; `%APPDATA%/Impromptu` on Windows). Saved prompt/context content is JSON with restricted file permissions where supported, **not encrypted**. Export contains saved prompts and responses, so review it before sharing. The app adds no telemetry, central database, employee scoring or background monitoring. Explicit knowledge requests use the connected services described above.

The desktop renderer is sandboxed with context isolation and no Node integration. Its narrow IPC API validates the sender; navigation, popups and permissions are denied. Model requests and the Codex connection run in the main process following explicit clicks. Retrieved source links open in the system browser only when clicked.

## Scope of this first build

This implements the brief's copy-and-shortcut entry path. It does **not yet** inject right-click items into browsers/native apps, intercept Send, automatically apply a result to another app, or implement organisation-wide standing. The knowledge bridge is intended for the local hackathon prototype, not a hosted production service. Organization rollout, a centrally registered Atlassian OAuth app, multi-tenant policy, signing, and IT deployment remain separate work.

## Development

Node 22+ is recommended for the tooling. Packaged apps bundle their own runtime.

```sh
npm ci
npm start
npm run check
npm test
python3 scripts/make-icons.py
npm run package:mac
npm run package:windows
npm run installer:mac
npm run installer:windows
```

Source: `src/main.cjs` (desktop), `src/preload.cjs` (narrow bridge), `src/engine.cjs` (skills/checks), `src/provider.cjs` (prompt-model adapters), `src/codex.cjs` (local JSON-RPC transport), `src/knowledge.cjs` (bounded retrieval and drafting), `src/renderer.js` + `index.html` + `styles.css` (UI). No runtime npm dependencies; Electron and packaging tools are pinned development dependencies.

The Mac installer is built with Apple's `pkgbuild` and `productbuild`. It installs only `/Applications/Impromptu.app`, disables bundle relocation so a development copy is not updated accidentally, and leaves local saved sessions and settings separate. It has no install scripts or login items. `npm run installer:mac` packages the current source and produces the `.pkg`; `node scripts/installer-mac.cjs arm64` wraps an already-built matching app.

The Windows installer uses the pinned electron-builder NSIS toolchain and is built on Windows by the manually triggered [Windows installer workflow](.github/workflows/windows-installer.yml). `npm run installer:windows` packages the app and writes Setup.exe under `release/windows-installer/`. `node scripts/installer-windows.cjs` wraps an already-built matching Windows x64 app. The build never publishes automatically. The workflow has read-only repository permissions and uploads a build artifact after its installation smoke check passes.

To attach a tested installer to the existing release, manually run [Publish tested Windows installer](.github/workflows/publish-windows-installer.yml) with the successful build's run ID. It checks the source repository, workflow result, app version, and checksums before uploading, then updates the release checksum manifest. This separate workflow requires release-write access and refuses to overwrite a different installer with the same filename.

Apps and installers are unsigned prototypes. macOS notarization, Windows signing, automatic updates and an IT rollout are not implemented. Managed-device policies may require IT approval. No OS security settings are changed. Full interactive Windows keyboard/clipboard and Codex/Atlassian testing is still needed. Prompt-model adapters are tested against controlled responses; the knowledge workflow was also tested with the real Codex/Atlassian connection on Mac.

## Verification

The Mac `.pkg` was expanded and checked: it targets `/Applications`, restricts installation to Apple Silicon/macOS 13+, disables bundle relocation, includes no installation scripts, and contains the complete app with matching file hashes, symlinks and executable permissions. The app was also copied into `/Applications/Impromptu.app`, registered with macOS and verified against the release bundle. The Installer wizard itself has not been exercised end to end.

Automated tests cover original-text preservation, input limits, endpoint validation, model responses, offline no-network behavior, clipboard handling, shortcut dispatch, sender rejection, RPC framing, connection lifecycle, read-tool and tenant restrictions, partial retrieval failures, bounded evidence, and citation/quotation validation. A live test against the user-supplied hackathon page searched both products, read five accessible sources, reported one failed source read, and generated six facts plus a cited reply. A synthetic draft also confirmed the no-external-tools session can generate successfully. Browser UI checks use synthetic data rather than storing company documents as fixtures.

Earlier native Mac checks covered prompt review/saving, progress and shortcut registration. A macOS ScreenCaptureKit failure blocked physical interaction with the updated native window, so later appearance checks used an isolated offscreen Electron window.

The [successful Windows installation check](https://github.com/rajpoot-rahul/InPromptU/actions/runs/41871487298) verified installation, desktop and Start Menu shortcut targets, per-user uninstall registration, installed runtime hashes, native-window startup, uninstall, and preservation of saved user data on a disposable Windows runner. All 18 unit tests also passed there. This does not exercise the interactive prompt/clipboard workflow or a signed-in Codex/Atlassian account.

Appearance in v0.2.1 was verified in an isolated offscreen Electron window: the Settings selector switches Dark, Light and System, both workspaces use the expected colors, and the settings dialog was visually inspected. The existing 18 automated checks also pass. This check did not restart or alter the running user session.
