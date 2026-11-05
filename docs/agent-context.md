# Connected agent context

InPromptU can now collect conversation context automatically after you connect a source. This is separate from the existing manual Context packs workflow. Open **Prompt workspace → Connected agent context**.

## Codex

1. Install/sign in to Codex using your own account.
2. Click **Connect Codex history**. If discovery fails, use **Locate Codex**, choose the actual `codex` / `codex.exe`, disconnect and reconnect.
3. InPromptU polls saved local history every 30 seconds. **Refresh** checks immediately. The status reports errors, partial reads and whether more tasks exist outside the collection window.

On macOS, discovery checks the existing ChatGPT/Codex app locations under `/Applications` and `~/Applications`, the shell PATH, `~/.local/bin`, and the Apple Silicon and Intel Homebrew prefixes. **Locate Codex** can browse inside an `.app` bundle. Paths containing spaces are passed directly to the process launcher, without a shell. A compatible, signed-in Codex installation is still required on each computer.

The collector uses the official stdio App Server with `thread/list` and `thread/turns/list`. It explicitly includes CLI, IDE, app-server and subagent source kinds, and all model providers. It never starts or resumes an agent task. Authentication stays with Codex.

Coverage is bounded: the 80 most recently updated **unarchived local tasks**, up to 8 recent turns and 12,000 characters per task. Only user text and assistant messages are extracted. Reasoning, tool output, attachments, unsaved activity and cloud-only tasks are not included. A separate App Server reads persisted history; this is not a subscription to the running agent's internal state. The API is experimental. The connector was checked against installed Codex CLI `0.166.0-alpha.6`.

## ChatGPT in Chrome or Edge

1. In InPromptU, click **Enable ChatGPT bridge**, then **Copy pairing code**.
2. Choose **Open extension folder** in InPromptU. It creates a browser-loadable copy of the bundled extension and opens it in Finder on macOS or File Explorer on Windows; the folder path also appears in the app. Open `chrome://extensions` or `edge://extensions`, enable **Developer mode**, choose **Load unpacked**, and select that folder. Developers can also select the repository's `extensions/chatgpt-context` folder.
3. Open the extension's options, paste the pairing code, and choose **Pair & enable sharing**.
4. Open or reload a saved conversation on `https://chatgpt.com`. Loaded user and assistant messages appear in InPromptU automatically, normally within 4–8 seconds. Scroll to load more messages if needed.

Chrome and Edge use the same extension on macOS and Windows. Safari is not supported. The exported folder lives under the app's user-data directory in `browser-extensions/chatgpt-context`; it stays outside the signed app bundle and its ASAR archive. After updating InPromptU, choose **Open extension folder** again and **Reload** the extension in the browser to refresh its files. This action does not enable sharing or install the extension automatically.

The extension handles regular conversations and conversations under project/custom-GPT paths. It reads rendered message elements, not the unsent prompt composer. Up to 40 loaded messages / 12,000 characters are sent per snapshot; the desktop retains at most 80 conversations. Changed content is checked every 4 seconds, with a heartbeat at most once a minute. Background-tab throttling may delay collection.

This does **not** grant access to all ChatGPT history, unopened conversations, other branches, attachment contents, hidden agent state, or the native ChatGPT desktop app. It does not call undocumented ChatGPT account endpoints or read cookies. ChatGPT DOM changes may require updating the selector in `content.js`.

Pairing uses a random session token and an ephemeral port bound to `127.0.0.1`. The token is stored in the extension's local storage, restricted to trusted extension contexts. It is not sent to the webpage. The bridge has no history-read endpoint, requires bearer authentication, rejects ordinary web origins, and bounds request size. Pair again after restarting InPromptU or reconnecting the bridge. The extension is a developer-loaded prototype, not a published store extension.

## Improve a prompt

1. Write the rough prompt in the existing prompt editor.
2. Check **Use conversation context when improving my prompt**.
3. Keep **Automatically match my prompt**, or select a conversation explicitly. Preview the excerpt. A clear keyword match selects one conversation. If several could fit a vague prompt such as “fix this”, InPromptU asks you to choose rather than combining unrelated work.
4. Click **Improve prompt**. Selected context enters the existing AI provider flow alongside your prompt, manual background and any attached evidence. The result names the conversation used.

For example, with a selected conversation about a failing `SAVE10` checkout coupon, “fix this” carries that coupon, the checkout failure and the recorded offline-support constraint into the rewrite request. The model still needs to distinguish established facts from hypotheses.

**Offline skills** remains a deterministic template: it includes context but does not generate a semantic rewrite. Use the app's existing Ollama or configured cloud AI provider for generated rewrites. No new API key or provider integration is introduced. **Local-only mode** continues to block remote model providers; local history reads and the loopback bridge remain available.

## Data lifecycle

- Both sources start disconnected on each app launch. Collection and inclusion in a prompt are separate opt-ins.
- Collected messages are held in memory, bounded, and expire after 24 hours without collection. No transcript database is written.
- Common secret patterns are redacted before storage in the in-memory index. This is best-effort pattern matching; review excerpts before using a cloud provider.
- **Disconnect & forget** clears that source's collection. **Quit** clears both. Turning sharing off in the extension stops future sends; disconnect in the desktop app to clear data already received.
- A generated or copied prompt can contain conversation content. **Save** retains the existing improvement as usual. Disconnecting does not erase saved improvements, current results or the clipboard.

## Implementation and validation

`src/agent-context.cjs` owns collection, bounds, matching and prompt augmentation. `src/context-bridge.cjs` owns the authenticated loopback receiver. The desktop main process exposes narrow, sender-validated IPC through `preload.cjs`; `agent-context-ui.js` drives the controls. The browser extension is under `extensions/chatgpt-context`.

Run `npm ci`, then `npm run verify` on Node 24. Run `npm run dev` for the isolated development profile. New tests cover pagination and subagent source filters, late responses after disconnect, partial reads, ambiguity, expiry, secret redaction, bridge authentication/origin/body validation, extension sender validation, composer exclusion, and the desktop IPC-to-improvement path. Test data is synthetic and no model account is needed.

Desktop IPC tests exercise both `darwin` and `win32` branches, including Context packs persistence, packaged extension export, context inclusion and shutdown. Mac-specific tests cover the native title bar, delayed first show, hide-on-close, Dock activation, and locating Codex inside app bundles. An installed Electron binary also enables an ASAR extraction test. The Desktop checks workflow runs the suite on Windows, Apple Silicon macOS and Intel macOS, then packages and smoke-starts each native Mac build in all five themes. A Windows run with simulated `darwin` settings is not a substitute for that native Mac run or the manual checks in CONTRIBUTING.md.

References: [Codex App Server](https://learn.chatgpt.com/docs/app-server), [Chrome content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts), and [extension network requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests).
