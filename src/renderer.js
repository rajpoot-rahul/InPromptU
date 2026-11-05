'use strict';
const api = window.impromptu;
const $ = id => document.getElementById(id);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const paths = {
  spark: '<path d="m12 3 2.3 6.7L21 12l-6.7 2.3L12 21l-2.3-6.7L3 12l6.7-2.3Z"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  chart: '<path d="M4 4v16h17M8 15v-3m5 3V8m5 7V5"/>', clock: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
  command: '<path d="M9 9h6v6H9zM9 9H6a3 3 0 1 1 3-3Zm6 0V6a3 3 0 1 1 3 3Zm0 6h3a3 3 0 1 1-3 3Zm-6 0v3a3 3 0 1 1-3-3Z"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="m9 3-1 3-3 1-2 3 2 2-1 3 2 3 3-1 2 4h3l1-3 3-1 2-3-2-2 1-3-2-3-3 1-2-4Z"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>',
  chevron: '<path d="m7 10 5 5 5-5"/>', clipboard: '<rect x="5" y="5" width="14" height="16" rx="2"/><rect x="8" y="3" width="8" height="4" rx="1"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', layers: '<path d="m12 3 10 6-10 6L2 9Zm-9 11 9 5 9-5M3 18l9 5 9-5"/>',
  check: '<path d="m5 12 4 4L19 6"/>', message: '<path d="M21 11a8 8 0 0 1-8 8H7l-5 3 1-7a8 8 0 0 1 8-12h2a8 8 0 0 1 8 8Z"/><path d="M7 10h10M7 14h6"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 5V3H3v13h2"/>', bookmark: '<path d="M6 3h12v18l-6-4-6 4Z"/>',
  bulb: '<path d="M9 18h6m-5 3h4M8 14a7 7 0 1 1 8 0c-1 1-1 2-1 2H9s0-1-1-2"/>', shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z"/><path d="m8 12 3 3 5-6"/>',
  code: '<path d="m8 5-6 7 6 7m8-14 6 7-6 7m-3-15-2 16"/>', file: '<path d="M14 2H5v20h14V7Zm0 0v5h5M8 12h8m-8 4h6"/>', download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>'
};
function icon(name) { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.spark}</svg>`; }
function fillIcons(root = document) { root.querySelectorAll('[data-icon]').forEach(el => el.innerHTML = icon(el.dataset.icon)); }
let state, current = null, savedId = null, pendingText = '', busy = false, analysisTimer, toastTimer, analyzeVersion = 0;
let activeView = 'workspace', incomingMode = 'knowledge', knowledgeBusy = false, knowledgeResult = null, knowledgePending = '';
const inputIds = ['prompt', 'context', 'audience', 'format'];
const samples = {
  support: { prompt: 'Help me respond to this customer complaint.', skillId: 'support' },
  engineering: { prompt: 'Help me investigate why this API request is failing.', skillId: 'engineering' },
  summary: { prompt: 'Summarize these meeting notes for my team.', skillId: 'summary' }
};
function input() { return { prompt: $('prompt').value, context: $('context').value, audience: $('audience').value, format: $('format').value, skillId: $('skill').value }; }
function toast(message, error = false) { clearTimeout(toastTimer); $('toast').textContent = String(message).replace(/^Error invoking remote method '[^']+': Error: /, ''); $('toast').classList.toggle('error', error); $('toast').hidden = false; toastTimer = setTimeout(() => $('toast').hidden = true, error ? 8000 : 3500); }
async function attempt(fn) { try { return await fn(); } catch (error) { toast(error.message, true); } }
function showView(view) {
  activeView = view;
  if (view === 'workspace' || view === 'knowledge') incomingMode = view;
  for (const name of ['workspace', 'knowledge', 'skills', 'history', 'progress']) $(`${name}-view`).hidden = name !== view;
  document.querySelectorAll('.nav-item[data-view]').forEach(el => el.classList.toggle('active', el.dataset.view === view));
  $('page-title').textContent = { workspace: 'Prompt workspace', knowledge: 'Knowledge & reply', skills: 'Skill library', history: 'Saved sessions', progress: 'My progress' }[view];
  if (view === 'history') renderHistory();
  if (view === 'progress') renderProgress();
  updateConnection();
  window.scrollTo(0, 0);
}
function updateConnection() {
  const offline = state.connection.mode === 'offline';
  $('connection-label').textContent = activeView === 'knowledge' ? state.knowledge?.connected ? 'Hyland knowledge connected' : 'Codex + Atlassian' : state.preview ? 'Browser preview · offline skills' : offline ? 'Offline skills' : state.connection.mode === 'ollama' ? 'Local model' : ({ openrouter: 'OpenRouter', huggingface: 'Hugging Face', bedrock: 'Amazon Bedrock' }[state.connection.mode] || 'Custom API');
  $('processing-note').innerHTML = `${icon(offline ? 'lock' : 'shield')}<span>${offline ? 'Runs on your device. No model call.' : `Sends this brief to ${escapeHtml((state.connection.mode === 'bedrock' ? `AWS Bedrock (${state.connection.region})` : new URL(state.connection.endpoint).host))} when you click Improve.`}</span>`;
}
function updateSkill() { $('skill-description').textContent = state.skills.find(s => s.id === $('skill').value)?.description || ''; }
function invalidate() {
  if (busy) return;
  current = null; savedId = null;
  $('result-empty').hidden = false; $('result-content').hidden = true; $('result-tag').textContent = 'READY WHEN YOU ARE';
  $('char-count').textContent = `${$('prompt').value.length.toLocaleString()} characters`;
  clearTimeout(analysisTimer);
  const revision = ++analyzeVersion;
  if (!$('prompt').value.trim()) { $('signal-row').hidden = true; return; }
  analysisTimer = setTimeout(() => attempt(async () => {
    const result = await api.analyze(input());
    if (revision !== analyzeVersion) return;
    renderSignals(result);
  }), 250);
}
function renderSignals(analysis) {
  $('signal-row').hidden = false;
  $('signals').innerHTML = analysis.signals.map(s => `<span class="signal ${s.present ? 'present' : ''}" title="${escapeHtml(s.tip)}">${s.present ? '✓ ' : ''}${escapeHtml(s.label)}</span>`).join('');
  $('coach-tip').textContent = analysis.signals.find(s => !s.present)?.tip || 'Your brief covers these signals. Extra instructions only help when they are relevant.';
}
function setInput(data, source = 'Your words stay yours.') {
  for (const id of inputIds) $(id).value = data[id] || '';
  $('skill').value = data.skillId || 'general';
  $('context-details').open = Boolean(data.context || data.audience || data.format);
  $('source-label').textContent = source;
  updateSkill(); invalidate(); showView('workspace');
}
function incoming(text) {
  if (incomingMode === 'knowledge') { incomingKnowledge(text); return; }
  if (!text.trim()) { toast('Copy a prompt first, then bring it here.'); return; }
  showView('workspace');
  if (busy || ($('prompt').value.trim() && $('prompt').value !== text)) { pendingText = text; $('incoming-banner').hidden = false; return; }
  setInput({ prompt: text, skillId: $('skill').value }, 'Brought from your clipboard.');
  toast('Copied prompt brought in. Review it before improving.');
}
function setBusy(value) {
  busy = value;
  for (const id of [...inputIds, 'skill', 'improve', 'paste-prompt', 'new-draft', 'use-incoming']) $(id).disabled = value;
  document.querySelectorAll('[data-sample]').forEach(button => button.disabled = value);
  $('improve-label').textContent = value ? 'Finding a clearer direction…' : 'Improve prompt';
  $('improve').setAttribute('aria-busy', String(value));
}
function renderResult(result) {
  $('result-empty').hidden = true; $('result-content').hidden = false;
  $('result-tag').textContent = result.mode === 'offline' ? 'LOCAL SKILL APPLIED' : 'AI SUGGESTION';
  $('result-text').value = result.improved;
  for (const key of ['changes', 'questions']) $(key).innerHTML = result[key].map(item => `<li>${escapeHtml(item)}</li>`).join('');
  $('questions-block').hidden = !result.questions.length;
  $('usage-note').textContent = result.mode === 'offline' ? 'Deterministic skill template · no AI generation or token usage. Review relevance before copying.' : `${result.model} · ${(result.durationMs / 1000).toFixed(1)} seconds · ${result.usage ? `${result.usage.input.toLocaleString()} input / ${result.usage.output.toLocaleString()} output tokens reported for this improvement only.` : 'The provider did not return token usage.'} Check that the suggestion preserves your intent.`;
  $('save-result').disabled = false;
  $('save-result').innerHTML = `${icon('bookmark')}${savedId ? 'Saved' : 'Save'}`;
  if (result.analysis) renderSignals(result.analysis);
  if (result.tip) $('coach-tip').textContent = result.tip;
}
async function improve() {
  if (busy) return;
  if (!$('prompt').value.trim()) { $('prompt').focus(); toast('Start with a prompt, or try one of the sample drafts.'); return; }
  setBusy(true);
  const snapshot = input();
  try { const result = await api.improve(snapshot); current = { input: snapshot, result }; savedId = null; renderResult(result); }
  catch (error) { toast(error.message, true); }
  finally { setBusy(false); }
}
function renderSkills() {
  $('skills-list').innerHTML = state.skills.map(skill => `<article class="skill-card"><div class="skill-icon">${icon(skill.icon)}</div><div><h2>${escapeHtml(skill.name)}</h2><div class="skill-meta">${escapeHtml(skill.category)} · v${escapeHtml(skill.version)} · STARTER TEMPLATE</div><p>${escapeHtml(skill.description)}</p><details><summary>Read the working approach</summary><p>${escapeHtml(skill.instructions)}</p></details></div><button class="secondary" data-use-skill="${skill.id}">Use skill ↗</button></article>`).join('');
  document.querySelectorAll('[data-use-skill]').forEach(button => button.addEventListener('click', () => { if (busy) { toast('Wait for the current improvement to finish.'); return; } $('skill').value = button.dataset.useSkill; updateSkill(); invalidate(); showView('workspace'); $('prompt').focus(); }));
}
function renderHistory() {
  $('export-history').disabled = !state.history.length;
  if (!state.history.length) { $('history-list').innerHTML = '<div class="empty-state"><h2>Keep the prompts worth revisiting.</h2><p>Improve a prompt, then choose Save. Nothing is added to your history automatically.</p><button class="secondary" id="history-start">Back to the workspace ↗</button></div>'; $('history-start').onclick = () => showView('workspace'); return; }
  $('history-list').innerHTML = state.history.map(item => `<article class="history-item"><div class="meta">${escapeHtml(new Date(item.date).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }))} · ${escapeHtml(state.skills.find(s => s.id === item.input.skillId)?.name || 'Skill')} · ${item.result.mode === 'offline' ? 'Offline' : 'AI-assisted'}</div><h2>${escapeHtml(item.input.prompt.slice(0, 220))}${item.input.prompt.length > 220 ? '…' : ''}</h2><div class="history-actions"><button class="secondary" data-reopen="${item.id}">Reopen ↗</button><button class="text-button" data-copy-saved="${item.id}">${icon('copy')}Copy</button><div class="feedback"><span>Useful?</span><button class="${item.feedback === 'helpful' ? 'selected' : ''}" data-rate="${item.id}" data-value="helpful">Yes</button><button class="${item.feedback === 'needs-work' ? 'selected' : ''}" data-rate="${item.id}" data-value="needs-work">Needs work</button></div><button class="text-button delete" data-delete="${item.id}">Delete</button></div></article>`).join('');
  document.querySelectorAll('[data-reopen]').forEach(button => button.onclick = () => { if (busy) { toast('Wait for the current improvement to finish.'); return; } const item = structuredClone(state.history.find(h => h.id === button.dataset.reopen)); setInput(item.input, 'Reopened from your saved sessions.'); current = { input: item.input, result: item.result }; savedId = item.id; renderResult(item.result); });
  document.querySelectorAll('[data-copy-saved]').forEach(button => button.onclick = () => attempt(async () => { await api.copy(state.history.find(h => h.id === button.dataset.copySaved).result.improved); toast('Copied. Paste it into your AI tool when ready.'); }));
  document.querySelectorAll('[data-rate]').forEach(button => button.onclick = () => attempt(async () => { state.history = await api.feedback({ id: button.dataset.rate, value: button.dataset.value }); renderHistory(); }));
  document.querySelectorAll('[data-delete]').forEach(button => button.onclick = () => attempt(async () => { if (!window.confirm('Delete this saved session from this device?')) return; state.history = await api.deleteHistory(button.dataset.delete); if (savedId === button.dataset.delete) savedId = null; renderHistory(); toast('Saved session deleted.'); }));
}
function renderProgress() {
  if (!state.history.length) { $('progress-content').innerHTML = '<div class="empty-state"><h2>Progress starts with your own work.</h2><p>Save a few sessions to see which useful details appear in your original briefs. No synthetic scores or employee comparisons.</p><button id="progress-start" class="secondary">Start with a prompt ↗</button></div>'; $('progress-start').onclick = () => showView('workspace'); return; }
  const count = state.history.length;
  const rated = state.history.filter(h => h.feedback).length;
  const helpful = state.history.filter(h => h.feedback === 'helpful').length;
  const skillsUsed = new Set(state.history.map(h => h.input.skillId)).size;
  const signals = ['task', 'context', 'audience', 'format', 'boundaries'].map(id => ({ id, count: state.history.filter(h => h.result.analysis?.signals?.find(s => s.id === id)?.present).length }));
  $('progress-content').innerHTML = `<div class="stat-grid"><div class="stat"><strong>${count}</strong><span>Sessions you chose to save</span></div><div class="stat"><strong>${helpful}<small> / ${rated}</small></strong><span>Rated helpful / all rated</span></div><div class="stat"><strong>${skillsUsed}</strong><span>Working approaches explored</span></div></div><section class="progress-panel"><h2>Details in your original briefs</h2><p>Text signals across your saved prompts and supplied context. These checks do not know the surrounding conversation or measure answer quality.</p>${signals.map(s => `<div class="bar-row"><span>${s.id[0].toUpperCase() + s.id.slice(1)}</span><progress value="${s.count}" max="${count}" aria-label="${s.id}: ${s.count} of ${count} saved briefs"></progress><span>${s.count} of ${count}</span></div>`).join('')}</section><p class="privacy-note">Visible only to you on this device. Organisation-wide standing needs a shared, comparable dataset and a participation policy; this prototype does not collect or invent one.</p>`;
}
function openSettings() {
  $('appearance').value = state.theme || 'system';
  $('connection-mode').value = state.connection.mode; $('endpoint').value = state.connection.endpoint; $('model').value = state.connection.model; $('api-key').value = ''; $('clear-key').checked = false; $('clipboard-setting').checked = state.importClipboard;
  $('api-key').placeholder = state.hasKey ? 'Key is in memory · leave blank to keep it' : 'Not saved to disk';
  $('shortcut-status').textContent = state.preview ? 'Keyboard shortcuts are available in the desktop app.' : state.shortcutRegistered ? `Global shortcut active: ${state.platform === 'darwin' ? '⌘⇧I' : 'Ctrl+Shift+I'}` : 'Shortcut unavailable: another app may have claimed it. Use the menu bar to open Impromptu.';
  $('shortcut-status').classList.toggle('warning', !state.shortcutRegistered && !state.preview);
  $('version').textContent = state.version;
  $('aws-profile').value = state.connection.profile || ''; $('aws-region').value = state.connection.region || '';
  modeFields(); $('settings-dialog').showModal();
}
function modeFields() {
  const mode = $('connection-mode').value;
  $('model-fields').hidden = mode === 'offline'; $('api-key-field').hidden = mode === 'offline' || mode === 'ollama' || mode === 'bedrock';
  $('aws-fields').hidden = mode !== 'bedrock'; $('endpoint-field').hidden = mode === 'bedrock';
  $('test-connection').hidden = mode === 'offline';
  $('connection-test-status').hidden = mode === 'offline';
  $('endpoint').readOnly = ['openrouter', 'huggingface'].includes(mode);
  $('provider-guide').textContent = { bedrock: 'Configure your company AWS SSO profile once using aws configure sso. Enter its name and AWS region, sign in, then enter your allowed Claude model ID or inference profile ID/ARN. Test requests and improvements are billed to that AWS account.', openrouter: '1. Create a key at openrouter.ai/settings/keys. 2. Paste it below. 3. Keep openrouter/free for free routing, or enter a model ID ending in :free. Free models have quotas; other models may charge credits.', huggingface: '1. Create a token at huggingface.co/settings/tokens with Inference Providers permission. 2. Paste it below. 3. Enter a supported chat model ID. Free accounts require purchased credits; eligible plans include an allowance.' }[mode] || 'Enter the full chat endpoint and an available model ID.';
  $('mode-explanation').textContent = { bedrock: 'Use Claude through your organisation’s Amazon Bedrock account. Authentication is managed by AWS SSO; no AWS secrets are stored in Impromptu.', offline: 'No credentials needed. Adds the selected reusable skill and your context. This mode does not call an AI model.', ollama: 'Connect a model already installed in Ollama on this computer. Model output is returned for your review.', openrouter: 'Real AI prompt improvement through OpenRouter. Your prompt is sent to OpenRouter and its selected inference provider.', huggingface: 'Real AI prompt improvement through Hugging Face Inference Providers. This is not an unlimited free service.', compatible: 'Connect an endpoint supporting the Chat Completions format. API access and billing are separate from chat subscriptions.' }[mode];
}

function knowledgeStatus(status = state.knowledge) {
  state.knowledge = status;
  $('knowledge-status').textContent = status?.connected ? 'Hyland knowledge connected' : 'Connect your Hyland knowledge';
  $('knowledge-connection-note').textContent = status?.connected ? 'Confluence + Jira · your Atlassian permissions · through Codex' : 'Uses your existing Atlassian sign-in in Codex. Access follows your account’s permissions.';
  $('knowledge-connect').textContent = status?.connected ? 'Connected ✓' : 'Connect via Codex';
  $('knowledge-connect').disabled = knowledgeBusy || status?.connected;
  updateConnection();
}
function clearKnowledgeResult() {
  knowledgeResult = null;
  $('knowledge-result').hidden = true; $('knowledge-empty').hidden = false;
  $('knowledge-sources-section').hidden = true; $('knowledge-result-tag').textContent = 'SOURCE FIRST';
  $('knowledge-reply').value = ''; $('knowledge-sources').replaceChildren(); $('knowledge-facts').replaceChildren();
  if (!knowledgeBusy) $('knowledge-progress').textContent = 'Ready to look up this message.';
}
function setKnowledgeMessage(text) {
  if (text.length > 12000) { toast('This copied text is longer than 12,000 characters. Paste just the comment and the context it needs.', true); return; }
  $('knowledge-message').value = text; $('knowledge-query').value = ''; clearKnowledgeResult(); showView('knowledge');
}
function incomingKnowledge(text) {
  showView('knowledge');
  if (!text.trim()) { toast('Copy a comment first, then bring it here.'); return; }
  if (knowledgeBusy || ($('knowledge-message').value.trim() && $('knowledge-message').value !== text)) { knowledgePending = text; $('knowledge-incoming').hidden = false; return; }
  setKnowledgeMessage(text);
}
function setKnowledgeBusy(value) {
  knowledgeBusy = value;
  for (const id of ['knowledge-message', 'knowledge-query', 'knowledge-draft', 'knowledge-paste', 'knowledge-run', 'knowledge-clear', 'knowledge-use-incoming', 'knowledge-locate', 'knowledge-disconnect']) $(id).disabled = value;
  $('knowledge-run').setAttribute('aria-busy', String(value));
  $('knowledge-run-label').textContent = value ? 'Finding the context…' : $('knowledge-draft').checked ? 'Find context & draft reply' : 'Find context';
  knowledgeStatus();
}
async function connectKnowledge() {
  if (knowledgeBusy) return;
  setKnowledgeBusy(true);
  try { knowledgeStatus(await api.connectKnowledge()); $('knowledge-progress').textContent = 'Connected. Paste a message to begin.'; }
  catch (error) { $('knowledge-progress').textContent = 'Could not connect. Check Codex sign-in and the Atlassian connector.'; toast(error.message, true); }
  finally { setKnowledgeBusy(false); }
}
function renderKnowledge(result) {
  knowledgeResult = result;
  $('knowledge-empty').hidden = true; $('knowledge-result').hidden = false; $('knowledge-sources-section').hidden = false;
  $('knowledge-result-tag').textContent = result.mode === 'codex' ? 'AI DRAFT · REVIEW' : 'SOURCES ONLY';
  $('knowledge-understanding').textContent = result.understanding;
  $('knowledge-facts').innerHTML = result.facts.length ? result.facts.map(fact => `<div class="knowledge-fact"><p>${escapeHtml(fact.text)} <button class="citation" data-source-id="${escapeHtml(fact.sourceId)}">[${escapeHtml(fact.sourceId)}]</button></p><details><summary>Supporting passage</summary><blockquote>${escapeHtml(fact.quote)}</blockquote></details></div>`).join('') : '<p class="help">No source-backed claims generated. Review the retrieved material and clarify the context before making a firm statement.</p>';
  $('knowledge-gaps-block').hidden = !result.gaps.length;
  $('knowledge-gaps').innerHTML = result.gaps.map(gap => `<li>${escapeHtml(gap)}</li>`).join('');
  $('knowledge-reply').value = result.reply;
  $('knowledge-warnings').innerHTML = result.warnings.map(warning => `<p>${escapeHtml(warning)}</p>`).join('');
  $('knowledge-warnings').hidden = !result.warnings.length;
  $('knowledge-search-time').textContent = `Retrieved ${new Date(result.searchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  $('knowledge-sources').innerHTML = result.sources.length ? result.sources.map(source => `<article class="knowledge-source" id="source-${source.id}"><div class="source-meta"><span class="source-id">${source.id}</span><span>${escapeHtml(source.product)}</span><span>${source.fetched ? source.truncated ? 'Selected excerpts' : 'Content read' : 'Search snippet only'}</span>${source.modified ? `<span>Updated ${escapeHtml(new Date(source.modified).toLocaleDateString())}</span>` : ''}</div><button class="source-title" data-open-source="${escapeHtml(source.id)}">${escapeHtml(source.title)} ↗</button><details><summary>${source.fetched ? 'Read the source excerpt' : 'Full content unavailable · view search snippet'}</summary><pre>${escapeHtml(source.excerpt || 'No excerpt returned.')}</pre></details></article>`).join('') : '<div class="empty-state"><h2>No readable matches yet.</h2><p>Try a project name, exact issue key, or a more specific search focus. A missing result does not mean the documentation does not exist.</p></div>';
  document.querySelectorAll('[data-open-source]').forEach(button => button.onclick = () => attempt(() => api.openSource(result.sources.find(s => s.id === button.dataset.openSource).url)));
  document.querySelectorAll('[data-source-id]').forEach(button => button.onclick = () => $(`source-${button.dataset.sourceId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
}
async function lookupKnowledge() {
  if (knowledgeBusy) return;
  if (!$('knowledge-message').value.trim()) { $('knowledge-message').focus(); toast('Paste the comment you want to understand.'); return; }
  setKnowledgeBusy(true); clearKnowledgeResult();
  try {
    const result = await api.lookupKnowledge({ message: $('knowledge-message').value, query: $('knowledge-query').value, draft: $('knowledge-draft').checked });
    renderKnowledge(result); knowledgeStatus({ connected: true, available: true });
    const count = result.sources.filter(s => s.fetched).length;
    $('knowledge-progress').textContent = `${count} ${count === 1 ? 'source' : 'sources'} read. ${result.mode === 'codex' ? 'Review the facts and reply.' : 'Review the available context.'}`;
  } catch (error) { $('knowledge-progress').textContent = 'Lookup did not complete. Your message is still here.'; toast(error.message, true); }
  finally { setKnowledgeBusy(false); }
}
function setupKnowledge() {
  knowledgeStatus();
  $('knowledge-connect').onclick = connectKnowledge;
  $('knowledge-run').onclick = lookupKnowledge;
  $('knowledge-paste').onclick = () => attempt(async () => incomingKnowledge(await api.readClipboard()));
  $('knowledge-message').oninput = clearKnowledgeResult; $('knowledge-query').oninput = clearKnowledgeResult;
  $('knowledge-draft').onchange = () => setKnowledgeBusy(false);
  $('knowledge-clear').onclick = () => { setKnowledgeMessage(''); $('knowledge-message').focus(); $('knowledge-progress').textContent = 'Ready for a new message.'; };
  $('knowledge-use-incoming').onclick = () => { setKnowledgeMessage(knowledgePending); knowledgePending = ''; $('knowledge-incoming').hidden = true; };
  $('knowledge-dismiss-incoming').onclick = () => { knowledgePending = ''; $('knowledge-incoming').hidden = true; };
  $('knowledge-options').onclick = () => $('knowledge-settings').showModal();
  $('knowledge-close-options').onclick = () => $('knowledge-settings').close();
  $('knowledge-locate').onclick = () => attempt(async () => { knowledgeStatus(await api.locateCodex()); $('knowledge-path-note').textContent = 'Executable selected. Close this dialog and connect via Codex.'; });
  $('knowledge-disconnect').onclick = () => attempt(async () => { knowledgeStatus(await api.disconnectKnowledge()); clearKnowledgeResult(); $('knowledge-settings').close(); toast('Disconnected from Codex. Your Codex account remains signed in.'); });
  $('knowledge-copy').onclick = () => attempt(async () => {
    const reply = $('knowledge-reply').value.trim(); if (!reply || !knowledgeResult) throw new Error('There is no reply to copy.');
    const refs = [...new Set([...reply.matchAll(/\[(S\d+)\]/g)].map(match => match[1]))];
    if (refs.some(ref => !knowledgeResult.sources.some(s => s.id === ref))) throw new Error('The edited reply contains a source number that is not in this lookup.');
    const sources = refs.length ? knowledgeResult.sources.filter(s => refs.includes(s.id)) : [];
    const links = sources.map(s => `[${s.id}] ${s.title}\n${s.url}`).join('\n\n');
    await api.copy(reply + (links ? `\n\nSources\n${links}` : '')); toast('Reply copied. Review the audience, then paste it into Teams.');
  });
  api.onKnowledgeProgress(message => $('knowledge-progress').textContent = message);
}

function renderAppearance(appearance = state) {
  Object.assign(state, { theme: appearance.theme || 'system', reducedTransparency: Boolean(appearance.reducedTransparency) });
  const glass = state.theme === 'glass';
  document.documentElement.dataset.theme = state.theme;
  document.documentElement.dataset.reducedTransparency = String(state.reducedTransparency);
  $('appearance-help').textContent = state.theme === 'max-ind' ? 'Maximal India · textile-inspired borders, jewel colours and architectural details. Follows your device’s light or dark appearance.' : glass
    ? state.reducedTransparency ? 'Glass uses solid surfaces while Reduce Transparency or Increase Contrast is enabled on your device.' : 'Translucent layers that follow your device’s light or dark appearance. Your choice is saved automatically.'
    : 'Applies immediately. Your choice is remembered on this device.';
}

async function boot() {
  if (!api) throw new Error('Open Impromptu using the desktop launcher.');
  state = await api.bootstrap(); fillIcons();
  const mac = state.platform === 'darwin';
  $('hide-window').hidden = true;
  $('glass-option').hidden = false; $('glass-option').disabled = false;
  $('glass-option').textContent = mac ? 'Glass · macOS' : 'Glass · Windows';
  $('max-ind-option').hidden = false; $('max-ind-option').disabled = false;
  renderAppearance();
  document.querySelectorAll('.shortcut-inline').forEach(el => el.textContent = mac ? '⌘⇧I' : 'Ctrl+Shift+I');
  document.querySelectorAll('.shortcut-keys').forEach(el => el.innerHTML = (mac ? ['⌘', '⇧', 'I'] : ['Ctrl', 'Shift', 'I']).map(key => `<kbd>${key}</kbd>`).join(''));
  $('run-key').textContent = mac ? '⌘ ↵' : 'Ctrl ↵';
  $('skill').innerHTML = state.skills.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
  updateSkill(); updateConnection(); renderSkills(); setupKnowledge(); showView('knowledge');
  document.querySelectorAll('[data-view]').forEach(button => button.onclick = () => showView(button.dataset.view));
  document.querySelector('.brand').onclick = event => { event.preventDefault(); showView('workspace'); };
  inputIds.forEach(id => $(id).addEventListener('input', invalidate));
  $('skill').onchange = () => { updateSkill(); invalidate(); };
  document.querySelectorAll('[data-sample]').forEach(button => button.onclick = () => setInput(samples[button.dataset.sample], 'Sample draft · replace it with your own.'));
  $('paste-prompt').onclick = () => attempt(async () => incoming(await api.readClipboard()));
  $('use-incoming').onclick = () => { setInput({ prompt: pendingText, skillId: $('skill').value }, 'Brought from your clipboard.'); pendingText = ''; $('incoming-banner').hidden = true; };
  $('dismiss-incoming').onclick = () => { pendingText = ''; $('incoming-banner').hidden = true; };
  $('improve').onclick = improve;
  $('new-draft').onclick = () => { setInput({}); $('prompt').focus(); };
  $('result-text').oninput = () => { if (current) { current.result.improved = $('result-text').value; savedId = null; $('save-result').innerHTML = `${icon('bookmark')}Save`; } };
  $('copy-result').onclick = () => attempt(async () => { const value = $('result-text').value; if (!value.trim()) throw new Error('The improved prompt is empty.'); await api.copy(value); toast('Copied. Switch back to your AI tool and paste.'); });
  $('save-result').onclick = () => attempt(async () => { if (!current || savedId) { toast('This session is already saved.'); return; } if (!$('result-text').value.trim()) throw new Error('The improved prompt is empty.'); current.result.improved = $('result-text').value; $('save-result').disabled = true; try { const record = await api.saveHistory(current); state.history = [record, ...state.history].slice(0, 100); savedId = record.id; renderResult(current.result); toast('Saved on this device.'); } finally { $('save-result').disabled = false; } });
  $('export-history').onclick = () => attempt(async () => { if (await api.exportHistory()) toast('Saved sessions exported.'); });
  $('open-settings').onclick = openSettings; $('connection-badge').onclick = () => activeView === 'knowledge' ? $('knowledge-settings').showModal() : openSettings();
  $('close-settings').onclick = () => $('settings-dialog').close();
  $('appearance').onchange = () => attempt(async () => {
    const select = $('appearance'); select.disabled = true;
    try { renderAppearance(await api.setTheme(select.value)); }
    catch (error) { select.value = state.theme || 'system'; throw error; }
    finally { select.disabled = false; }
  });
  $('connection-mode').onchange = () => {
    const mode = $('connection-mode').value;
    const presets = { openrouter: ['https://openrouter.ai/api/v1/chat/completions', 'openrouter/free'], huggingface: ['https://router.huggingface.co/v1/chat/completions', 'openai/gpt-oss-120b'], ollama: ['http://localhost:11434/api/chat', ''] };
    [$('endpoint').value, $('model').value] = presets[mode] || ['', ''];
    $('api-key').value = ''; $('api-key').placeholder = 'Enter the key for this provider · session only';
    $('connection-test-status').textContent = 'Sends a fictional sample prompt, not your draft. Uses provider quota or credits.';
    modeFields();
  };
  $('aws-sign-in').onclick = async () => {
    $('aws-sign-in').disabled = true; $('aws-status').textContent = 'Complete AWS SSO sign-in in your browser…';
    try { $('aws-status').textContent = (await api.awsSignIn($('aws-profile').value.trim())).message; }
    catch (error) { $('aws-status').textContent = error.message.replace(/^Error invoking remote method '[^']+': Error: /, ''); }
    finally { $('aws-sign-in').disabled = false; }
  };
  $('test-connection').onclick = async () => {
    const button = $('test-connection'); button.disabled = true;
    $('connection-test-status').textContent = 'Testing a sample prompt…';
    try {
      const result = await api.testConnection({ mode: $('connection-mode').value, endpoint: $('endpoint').value, model: $('model').value, region: $('aws-region').value.trim(), profile: $('aws-profile').value.trim(), apiKey: $('api-key').value, clearKey: $('clear-key').checked });
      $('connection-test-status').textContent = result.message;
    } catch (error) { $('connection-test-status').textContent = error.message.replace(/^Error invoking remote method '[^']+': Error: /, ''); }
    finally { button.disabled = false; }
  };
  $('settings-form').onsubmit = event => { event.preventDefault(); attempt(async () => { if (busy) throw new Error('Wait for the current request to finish before changing connection.'); state = await api.saveSettings({ mode: $('connection-mode').value, endpoint: $('endpoint').value, model: $('model').value, region: $('aws-region').value.trim(), profile: $('aws-profile').value.trim(), apiKey: $('api-key').value, clearKey: $('clear-key').checked, importClipboard: $('clipboard-setting').checked }); $('api-key').value = ''; updateConnection(); $('settings-dialog').close(); toast('Settings saved.'); }); };
  $('hide-window').onclick = () => api.hide();
  document.addEventListener('keydown', event => { const modal = $('settings-dialog').open || $('knowledge-settings').open; if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !modal) { if (activeView === 'workspace') { event.preventDefault(); improve(); } if (activeView === 'knowledge') { event.preventDefault(); lookupKnowledge(); } } if (event.key === 'Escape' && !modal) api.hide(); });
  api.onInvoke(incoming);
  api.onNotice(message => toast(message, true));
  api.onSettings(data => { state = data; renderAppearance(); updateConnection(); });
  api.onAppearance(renderAppearance);
}
boot().catch(error => toast(error.message, true));
