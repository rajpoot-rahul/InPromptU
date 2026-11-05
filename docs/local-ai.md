# Local AI connection: interfaces for other workstreams

Chat, Compress/Explain, Context Packs, Skillify and coaching should reuse this layer instead of calling Ollama directly.

## Main-process modules

- `src/ollama.cjs`
  - `probe(endpoint?, fetchFn?)` → `{ status, origin, version?, models, message }`. `status` is `ready`, `no-models`, `not-running` or `error`. `models` items are `{ name, sizeBytes, family, parameterSize, quantization }`. Only localhost is contacted. Nothing is pulled or modified.
  - `isLocalURL(url)`, `DEFAULT_ENDPOINT` (`http://localhost:11434/api/chat`).
- `src/provider.cjs`
  - `isLocalConnection(connection)`: true for `offline`, `ollama`, or `compatible` on localhost.
  - `assertAllowed(connection, localOnly)`: throws a user-facing error when local-only mode forbids the connection. Call it in the main process before **any** model or network request a new feature adds.
  - `requestImprovement(input, connection, apiKey)`: Ollama requests send `format: "json"` and `think: false`. A structured-output rejection is retried once without `format`. Output is always validated; there is no fabricated fallback.

## IPC (renderer `window.impromptu`)

| Method | Purpose |
| --- | --- |
| `detectLocalAI(endpoint?)` | Run `probe`; defaults to the saved Ollama endpoint. |
| `useLocalAI({ model, endpoint?, localOnly })` | Confirms the model is installed, sends a fictional test prompt, then saves the connection, `localOnly` and `setup.completedAt`. Returns `{ durationMs, state }`. |
| `dismissSetup()` | Persists `setup.dismissed`. |
| `openHelp(id)` | Opens only the allow-listed `ollama-download` or `ollama-models` pages. |

## Persisted state (`workspace.json` in the profile folder)

New fields: `localOnly: boolean` (default `false` for existing profiles) and `setup: { dismissed: boolean, completedAt: ISO string | "" }`. `bootstrap()` returns both. API keys remain memory-only.

## One-click setup (`src/installer.cjs`)

- IPC: `localAIPlan()` returns `{ specs: { ramGB, freeGB, platform, arch }, catalog: [{ name, label, size, minRam, vision, license, fits, reason, recommended, page }], ollama: { path, running, models } }`. `localAIRelease()` returns `{ version, size, url, source }`. `installLocalAI({ consent: true, model, localOnly })` emits `local-ai-progress` events `{ stage: download|verify|install|start|model|test|done, message, done?, total? }`. `cancelLocalAI()` cancels.
- Verification: macOS requires `TeamIdentifier=3MU9H2V9Y9`, a valid deep signature and `spctl --assess`. Windows requires `Get-AuthenticodeSignature` to be `Valid` and the signer subject to have `CN=Ollama Inc.`, `O=Ollama Inc.` and `SERIALNUMBER=2713355` (Ollama's Ontario corporation number on its DigiCert EV code-signing certificate). That subject was read from the signatures of `OllamaSetup.exe` v0.6.0, v0.12.0, v0.30.0 and v0.40.14. PowerShell runs by absolute path (`%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe`), and the file path is passed in an environment variable rather than in the script.
- Windows install: `OllamaSetup.exe` is an Inno Setup 6 installer (about 1.7 GB) with `PrivilegesRequired=lowest`. Impromptu runs it with `/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP-`, so it installs for the current user to `%LOCALAPPDATA%\Programs\Ollama` with no UAC prompt. Its post-install step starts `ollama app.exe`. If the server does not answer within 20 seconds, Impromptu starts `ollama app.exe` itself. Setup first checks for about 4 times the download size in free disk space.
- Existing installs: `findOllama()` checks `%LOCALAPPDATA%\Programs\Ollama\ollama.exe`, `%ProgramFiles%\Ollama\ollama.exe` and `PATH`. `startOllama()` opens `Ollama.app` on macOS. On Windows it starts the neighbouring `ollama app.exe` tray app, or `ollama.exe serve` when only the command-line tool is installed.

## Prompt actions (`improve` IPC)

`window.impromptu.improve({ ...input, action })` with `action` of `improve` (default), `compress` or `explain`.
- `compress` returns the improvement shape plus `stats: { original, result }` (each `{ characters, words, estimatedTokens }`) and `missing` (details from `engine.keyDetails` absent from the output).
- `explain` returns `explanation: { summary, strengths[], gaps[], tips[] }` and no `improved` text.
- Offline mode throws for `compress` and `explain`. Saved sessions record `action` (`improve` or `compress`); explanations are not saved.

## Context Packs (`src/context.cjs`)

Format `impromptu-context-pack/1`: Markdown with front matter (`format`, `source`, `model`, `title`, `created`) and the sections `## Goal`, `## Decisions made`, `## Facts and constraints`, `## Open questions`, `## Key artefacts` and `## Suggested next prompt`. Headings match on their first word. `extractPack` strips surrounding chat prose and code fences.

- Inbox: `~/Impromptu/Inbox` (`.md`, `.markdown`, `.txt`, up to 300 KB). Files move to `Inbox/imported/` after import. Hand-off skills are written to `~/.cursor/skills/impromptu-handoff/SKILL.md`, `~/.claude/skills/…` or `~/.codex/skills/…`, and removal only deletes a file named `impromptu-handoff`. On Windows, `~` is the user profile folder (`%USERPROFILE%`, for example `C:\Users\me\Impromptu\Inbox`), which is where Cursor, Claude Code and Codex look for personal skills.
- Store: `context-packs.json` holds `{ packs: [{ id, title, source, model, created, sections, missing, text, redacted[], origin, fileName, importedAt, stats }] }`, up to 50 packs of 100,000 characters each. `redact()` runs before parsing on import and on edit.
- IPC: `contextState()`, `contextGet(id)`, `importPackText({ text, redactSecrets })`, `importPackFile({ name, redactSecrets })`, `updatePack({ id, text })`, `deletePack(id)`, `openInbox()`, `installHandoff(tool)`, `removeHandoff(tool)`, `exportPack(id)`, and the event `context-inbox-changed`.
- Extension points for other importers (Cursor/Codex transcripts, ChatGPT/Claude data exports): produce a pack string and call `PackStore.add(text, { origin })`. Condense raw transcripts with a local model before calling it.
- Chat providers: `chatProviders()` returns `{ local: [{ model, label }], cloud: [{ mode, label, available, reason }], localOnly }`. `chatNew({ provider: 'cloud' })` creates a chat bound to the configured cloud connection (`provider: 'cloud'`, `providerLabel`), and `chatSend` then uses `provider.complete` instead of Ollama streaming. `bedrock.converseInput` turns messages into alternating Bedrock turns.

## Hyland latest learning (`src/hyland-learning.cjs`)

Format `impromptu-learning-session/1`, written by collecting agents (Teams recaps, Confluence pages, manual notes) into `~/Impromptu/Learning/<YYYY-MM-DD>-<slug>/session.md` (on Windows `%USERPROFILE%\Impromptu\Learning\…`), with files in an `attachments/` subfolder:

```markdown
---
format: impromptu-learning-session/1
series: <series name>
title: <title>
date: <ISO date>
source: teams-recap | confluence | manual
url: <https link>
---
## Summary
## Action items
## Topics
## Attachments
(Markdown links; relative links point into attachments/)
```

- Parsing is tolerant: every section is optional, list items may be `-`, `*`, `1.` or plain lines (Topics may be comma-separated), and headings such as "Meeting notes", "Follow-up tasks" and "Chapters" are recognised. Without front matter, bare-line headings (as in pasted Teams recaps) also count. Missing title and date fall back to a `# heading` and the folder name. CRLF and LF line endings both parse. `session.md` must be a regular file of 300 KB or less; symlinks, and on Windows directory junctions, are skipped. `IMPROMPTU_LEARNING_DIR` overrides the folder.
- Change detection polls file stats every 10 seconds (an unref'd timer) on macOS and Windows alike, instead of `fs.watch`, and sends `learning-folder-changed` only when the pending count changes.
- Attachments are classified as `link` (credential-free public `https://` addresses only; see `safeUrl`), `file` (a relative path that cannot escape the session folder; `\` is treated as `/`, and drive letters, UNC paths and `:` such as NTFS alternate data streams are blocked) or `blocked`. `resolveAttachment` follows symlinks and requires the result to be inside the learning folder and to have a document, media or text extension.
- Store: `learning-sessions.json` holds `{ version: 1, sessions: [{ id, series, title, date, source, url, summary, actionItems[], topics[], attachments[{ label, kind, href, manual? }], missing[], redacted[], origin: folder|paste, folder, folderName, sourceModified, importedAt, updatedAt, attended, reviewed, notes, ai }] }`. `attended` and `reviewed` are ISO timestamps or `""`. `ai` is the last session summary `{ overview, points[], actions[], label, local, usage, at }`. Up to 300 sessions; notes up to 4,000 characters. Sessions are deduplicated by folder name, then by date and title, and an update keeps the personal fields.
- IPC: `hylandState()` returns `{ series: [{ name, sessions }], progress: { total, reviewed, attended, catchUp[] }, folder: { path, exists, pending }, format, sources }`. The others are `hylandScan()`, `hylandOpenFolder()`, `hylandPaste({ text, series, title, date, url, source })`, `hylandStatus({ id, attended?, reviewed? })`, `hylandNotes({ id, notes })`, `hylandAddLink({ id, label, url })`, `hylandDelete(id)`, `hylandOpen({ id, target: 'source' | attachmentIndex })` and `hylandSummarize({ id?, mode: 'session' | 'digest', provider: 'local:<model>' | 'cloud' })`, plus the event `learning-folder-changed` (pending count). The renderer never passes a URL or path to open, only a session ID and an index.
- AI: `digestMessages` frames the session notes as untrusted data and asks for JSON `{ overview, points, actions }`, which `parseDigest` validates. Digests cover up to 12 unreviewed sessions within 24,000 characters. Personal notes are never sent. The main process calls `assertAllowed` before `provider.complete`.

## Mascot (`src/mascot.cjs`, `mascot.html`)

- `workspace.json` → `mascot: { enabled, consentAt, nudges, breakMinutes, scrollFrames, visionModel }`. `enabled` is ignored without `consentAt`.
- The mascot window has its own preload and IPC (`mascot-state`, `mascot-action`, `mascot-expand`, `mascot-typing`), validated against the mascot window and its file URL. The main window uses `mascotSettings`, `enableMascot({ consent: true })`, `disableMascot`, `updateMascot` and `mascotPermission(kind)`.
- `describeScreens({ images, question, endpoint, model })` accepts only a localhost Ollama endpoint. `Coach` takes `record(kind, text)` events from Improve, Compress, Explain and chat; `factCheckNudge(reply, supplied)` checks chat replies.
- Screen answers are written to Local chat (temporary when "Save new chats" is off). Images aren't stored.
- Key presses: macOS uses `osascript` with System Events. Windows uses `System.Windows.Forms.SendKeys` through PowerShell. It first waits up to 1.5 seconds for Ctrl, Shift and Alt to be released, because Windows would otherwise merge a still-held Ctrl+Shift+I into the copy and send Ctrl+Shift+C. The renderer passes only a fixed key name (`copy`, `pageDown`, `pageUp`).
- `grabSelection` restores the previous clipboard as text, HTML, RTF and image, where present.
- Windows window flags: `type: 'toolbar'` (kept out of Alt+Tab), `focusable: false` (clicking the mascot leaves your app in the foreground, so Ctrl+C and Page Down reach it), `transparent`, `alwaysOnTop` and `skipTaskbar`. The ask box makes the window focusable only while you type. `mascotPermissions()` reports both permissions as granted on Windows, and Settings hides the macOS permission rows.

## Hyland evidence (`src/evidence.cjs`)

- `findEvidence(query)` runs `KnowledgeService.lookup({ draft: false })` and caches fetched sources in the main process. It returns `{ sources: [{ id, title, product, url, modified, fetched, truncated, excerpt }], warnings, query }`.
- `improve({ ...input, evidence: ['S1', …] })` only accepts IDs from the latest cached lookup and appends `evidenceContext(sources)` to the context. The result gains `evidence: [{ id, title, product, url, modified }]`.
- Local-only mode refuses `findEvidence`.

## Skills (`src/skills.cjs`)

- `skills.json`: `{ version: 1, skills: [{ id: "custom-<uuid>", name, category, description, instructions, icon, version, uses, createdAt, updatedAt }] }`. `bootstrap().skills` returns starters (`custom: false`) followed by custom skills (`custom: true`).
- The export file format is `{ format: "impromptu-skills", version: 1, skills: [{ name, category, description, instructions, icon, version }] }`, and import accepts the same shape. An organisation catalogue can be distributed this way until there is a shared service.
- IPC: `generateSkill(text)` returns `{ draft, mode, model, usage, durationMs }` and never saves. The others are `saveSkill(skill)` (pass `id` to edit), `deleteSkill(id)`, `exportSkills()` and `importSkills()`.
- `provider.complete(messages, connection, apiKey)` is the shared transport for any JSON-returning model request; callers validate the content.

## Learning (`src/learning.cjs`)

- `workspace.json` → `learning: { events: { improve, compress, explain, chat, skill, … }, manual: { agents|workflows|multiagent: ISO date }, runs: [{ id, date, total, answered, tasks: [{ id, prompt, score, items, tips }] }] }` (20 runs kept).
- `scoreRun(answers)` and `scorePrompt(task, prompt)` are deterministic; a ranked mode could submit `{ total, answered, task scores }` only, never prompt text.
- Score card file: `{ format: "impromptu-scorecard", version: 1, alias, total, answered: 6, tasks: { <taskId>: 0–100 }, date, app }`. `validateScorecard` requires all six task IDs and `total === round(mean(tasks))`. A future shared service can accept exactly this payload. `workspace.json` → `ranked: { joined, alias, joinedAt, board: [card + importedAt] }`.
- IPC: `joinRanked({ alias, consent: true })`, `leaveRanked({ clearBoard })`, `removeRanked(alias)`, `exportScorecard()`, `importScorecards()`; `learningState().ranked` holds `{ joined, alias, hasCard, entries[{ rank, alias, total, date, you? }], participants, average, taskAverages }`.
- IPC: `learningState()`, `markMilestone({ id, done })` (self-reported steps only), `submitBenchmark(answers)`, `eraseLearning()`, `openReading(url)` (curriculum and My progress links only).

## Local chat (`src/chat.cjs`)

- `ChatStore(file)` keeps conversations in memory and writes `chats.json` (mode `0600`) in the profile folder. Shape: `{ version: 1, conversations: [{ id, title, model, createdAt, updatedAt, messages: [{ id, at, role: "user" | "assistant", content, model?, usage?, durationMs?, stopped? }] }] }`. Conversations created while **Save new chats** is off carry `temporary: true` and are never written.
- `streamChat({ endpoint, model, messages, signal, onDelta })` streams from `/api/chat` on localhost only. It throws on a missing model, Ollama not running, a stream error or an empty reply.
- Context sent to the model is the system guardrail plus the newest messages within 48,000 characters.
- IPC: `chatList`, `chatGet(id)`, `chatNew({ model })`, `chatSend({ chatId, text, model })` (resolves with `{ chat, message }` or `{ chat, stopped: true }`; tokens arrive as `chat-delta` events), `chatStop(id)`, `chatDelete(id)`, `chatClear()`, `chatSettings({ saveNewChats })`, `chatExport()`.
- A failed send removes the unanswered user message so a retry does not duplicate it. A stopped reply keeps its partial text, marked `stopped`.
- Persisted setting: `chat: { saveNewChats: boolean, model: string }` in `workspace.json`.

Context Packs and Skillify can start a chat with `chatNew`, then `chatSend` with the pack or skill text as the first message.

## My progress insights (`src/insights.cjs`)

- `PromptLog(file)` writes `prompt-log.json` (mode `0600`) in the profile folder: `{ version: 1, enabled, entries: [{ id, at, action: improve|compress|explain, skillId, mode, signals: [signal ids present], words, estimatedTokens, contextWords, savings: { before, after, pct } | null, prompt, truncated }] }`. The newest 1,000 entries are kept, oldest first; prompts are cut to 4,000 characters and context text is never stored. `record(entry)` does nothing while `enabled` is false.
- The main process records `entryFrom(input, result)` after every successful `improve` IPC call, whatever the action or provider. Any other prompt-processing feature should record the same way.
- `summarize(entries, now?)` is deterministic and needs no model: `{ total, firstAt, lastAt, specificity: { average, recent, earlier, delta, recentCount, latest, parts, weeks[{ from, to, count, average }] }, coverage[{ id, label, count, pct, recentPct, earlierPct }], weaknesses[{ id, title, why, gap, count, of, examples[{ id, at, prompt, excerpt, missing[], addition, score }], actions[], readings[{ title, source, url }] }], habits, formula[] }`. `specificity({ prompt, signals })` and `concreteDetails(text)` expose the score.
- Reading links live in `READINGS`; each was checked to return HTTP 200. `open-reading` opens a URL only when `learning.readingAllowed` or `insights.readingAllowed` accepts it.
- AI coaching: `coachMessages(entries)` frames the prompts as untrusted data and sends statistics plus up to 8 excerpts of 400 characters; `parseCoach` validates `{ summary, focus[], tips[] }`. The main process refuses offline mode and calls `assertAllowed` before `provider.complete`.
- IPC: `insightsState()` returns `{ enabled, count, summary, canCoach, localConnection, localOnly }`. The others are `insightsSettings({ enabled })`, `eraseInsights()`, `exportInsights()` (file format `impromptu-prompt-log`, version 1) and `insightsCoach()`.
- The view is `src/insights-view.js` with `src/insights.css`, loaded after `renderer.js`.

## Rules for new features

1. Treat `state.localOnly` as authoritative in the main process; renderer checks are for display only.
2. Label output by origin: `offline` (template), `ollama` (on this computer), or a named cloud provider. Never present a template or fixture as model output.
3. Report usage only when the provider returns it.
