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
- Verification: macOS requires `TeamIdentifier=3MU9H2V9Y9`, a valid deep signature and `spctl --assess`. Windows requires `Get-AuthenticodeSignature` to be `Valid` with an Infra Technologies or Ollama subject (not yet confirmed on Windows).

## Prompt actions (`improve` IPC)

`window.impromptu.improve({ ...input, action })` with `action` of `improve` (default), `compress` or `explain`.
- `compress` returns the improvement shape plus `stats: { original, result }` (each `{ characters, words, estimatedTokens }`) and `missing` (details from `engine.keyDetails` absent from the output).
- `explain` returns `explanation: { summary, strengths[], gaps[], tips[] }` and no `improved` text.
- Offline mode throws for `compress` and `explain`. Saved sessions record `action` (`improve` or `compress`); explanations are not saved.

## Context Packs (`src/context.cjs`)

Format `impromptu-context-pack/1`: Markdown with front matter (`format`, `source`, `model`, `title`, `created`) and the sections `## Goal`, `## Decisions made`, `## Facts and constraints`, `## Open questions`, `## Key artefacts` and `## Suggested next prompt`. Headings match on their first word. `extractPack` strips surrounding chat prose and code fences.

- Inbox: `~/Impromptu/Inbox` (`.md`, `.markdown`, `.txt`, up to 300 KB). Files move to `Inbox/imported/` after import. Hand-off skills are written to `~/.cursor/skills/impromptu-handoff/SKILL.md`, `~/.claude/skills/…` or `~/.codex/skills/…`, and removal only deletes a file named `impromptu-handoff`.
- Store: `context-packs.json` holds `{ packs: [{ id, title, source, model, created, sections, missing, text, redacted[], origin, fileName, importedAt, stats }] }`, up to 50 packs of 100,000 characters each. `redact()` runs before parsing on import and on edit.
- IPC: `contextState()`, `contextGet(id)`, `importPackText({ text, redactSecrets })`, `importPackFile({ name, redactSecrets })`, `updatePack({ id, text })`, `deletePack(id)`, `openInbox()`, `installHandoff(tool)`, `removeHandoff(tool)`, `exportPack(id)`, and the event `context-inbox-changed`.
- Extension points for other importers (Cursor/Codex transcripts, ChatGPT/Claude data exports): produce a pack string and call `PackStore.add(text, { origin })`. Condense raw transcripts with a local model before calling it.
- Chat providers: `chatProviders()` returns `{ local: [{ model, label }], cloud: [{ mode, label, available, reason }], localOnly }`. `chatNew({ provider: 'cloud' })` creates a chat bound to the configured cloud connection (`provider: 'cloud'`, `providerLabel`), and `chatSend` then uses `provider.complete` instead of Ollama streaming. `bedrock.converseInput` turns messages into alternating Bedrock turns.

## Mascot (`src/mascot.cjs`, `mascot.html`)

- `workspace.json` → `mascot: { enabled, consentAt, nudges, breakMinutes, scrollFrames, visionModel }`. `enabled` is ignored without `consentAt`.
- The mascot window has its own preload and IPC (`mascot-state`, `mascot-action`, `mascot-expand`, `mascot-typing`), validated against the mascot window and its file URL. The main window uses `mascotSettings`, `enableMascot({ consent: true })`, `disableMascot`, `updateMascot` and `mascotPermission(kind)`.
- `describeScreens({ images, question, endpoint, model })` accepts only a localhost Ollama endpoint. `Coach` takes `record(kind, text)` events from Improve, Compress, Explain and chat; `factCheckNudge(reply, supplied)` checks chat replies.
- Screen answers are written to Local chat (temporary when "Save new chats" is off). Images aren't stored.

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
- IPC: `learningState()`, `markMilestone({ id, done })` (self-reported steps only), `submitBenchmark(answers)`, `eraseLearning()`, `openReading(url)` (curriculum links only).

## Local chat (`src/chat.cjs`)

- `ChatStore(file)` keeps conversations in memory and writes `chats.json` (mode `0600`) in the profile folder. Shape: `{ version: 1, conversations: [{ id, title, model, createdAt, updatedAt, messages: [{ id, at, role: "user" | "assistant", content, model?, usage?, durationMs?, stopped? }] }] }`. Conversations created while **Save new chats** is off carry `temporary: true` and are never written.
- `streamChat({ endpoint, model, messages, signal, onDelta })` streams from `/api/chat` on localhost only. It throws on a missing model, Ollama not running, a stream error or an empty reply.
- Context sent to the model is the system guardrail plus the newest messages within 48,000 characters.
- IPC: `chatList`, `chatGet(id)`, `chatNew({ model })`, `chatSend({ chatId, text, model })` (resolves with `{ chat, message }` or `{ chat, stopped: true }`; tokens arrive as `chat-delta` events), `chatStop(id)`, `chatDelete(id)`, `chatClear()`, `chatSettings({ saveNewChats })`, `chatExport()`.
- A failed send removes the unanswered user message so a retry does not duplicate it. A stopped reply keeps its partial text, marked `stopped`.
- Persisted setting: `chat: { saveNewChats: boolean, model: string }` in `workspace.json`.

Context Packs and Skillify can start a chat with `chatNew`, then `chatSend` with the pack or skill text as the first message.

## Rules for new features

1. Treat `state.localOnly` as authoritative in the main process; renderer checks are for display only.
2. Label output by origin: `offline` (template), `ollama` (on this computer), or a named cloud provider. Never present a template or fixture as model output.
3. Report usage only when the provider returns it.
