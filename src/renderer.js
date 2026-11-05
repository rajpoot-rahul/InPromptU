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
  code: '<path d="m8 5-6 7 6 7m8-14 6 7-6 7m-3-15-2 16"/>', route: '<circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M8 19h7a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h7"/>', chat: '<path d="M4 5h16v11H9l-5 4Z"/><path d="M8 9h8M8 12h5"/>', file: '<path d="M14 2H5v20h14V7Zm0 0v5h5M8 12h8m-8 4h6"/>', download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>'
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
  for (const name of ['workspace', 'chat', 'context', 'knowledge', 'skills', 'history', 'progress', 'learn']) $(`${name}-view`).hidden = name !== view;
  document.querySelectorAll('.nav-item[data-view]').forEach(el => el.classList.toggle('active', el.dataset.view === view));
  $('page-title').textContent = { workspace: 'Prompt workspace', chat: 'Local chat', knowledge: 'Knowledge & reply', skills: 'Skill library', history: 'Saved sessions', progress: 'My progress', learn: 'Learner track', context: 'Context packs' }[view];
  if (view === 'chat') openChatView();
  if (view === 'skills') renderSkills();
  if (view === 'learn') openLearning();
  if (view === 'context') openContext();
  if (view === 'history') renderHistory();
  if (view === 'progress') renderProgress();
  updateConnection();
  window.scrollTo(0, 0);
}
const cleanError = message => String(message).replace(/^Error invoking remote method '[^']+': Error: /, '');
function localAIUnreachable() { return state.connection.mode === 'ollama' && localAI && localAI.status !== 'ready'; }
function updateConnection() {
  const offline = state.connection.mode === 'offline', local = state.connection.mode === 'ollama';
  $('connection-label').textContent = activeView === 'chat' ? activeChat?.provider === 'cloud' ? `Cloud chat · ${activeChat.providerLabel}` : `Local chat${$('chat-model').value ? ` · ${$('chat-model').value}` : ''}` : activeView === 'knowledge' ? state.localOnly ? 'Local-only · knowledge off' : state.knowledge?.connected ? 'Hyland knowledge connected' : 'Codex + Atlassian' : state.preview ? 'Browser preview · offline skills' : offline ? 'Offline skills' : local ? `Local · ${state.connection.model}` : ({ openrouter: 'OpenRouter', huggingface: 'Hugging Face', bedrock: 'Amazon Bedrock' }[state.connection.mode] || 'Custom API');
  $('connection-badge').dataset.health = activeView !== 'knowledge' && localAIUnreachable() ? 'warning' : '';
  const note = offline ? 'Runs on your device. No model call.'
    : local ? localAIUnreachable() ? 'Ollama is not responding. Start it, then improve. Your draft stays here.' : 'Runs on this computer through Ollama. Nothing leaves your device.'
      : `Sends this brief to ${escapeHtml((state.connection.mode === 'bedrock' ? `AWS Bedrock (${state.connection.region})` : new URL(state.connection.endpoint).host))} when you click Improve.`;
  const attached = typeof selectedEvidence === 'function' ? selectedEvidence().length : 0;
  const evidenceNote = attached ? ` Includes ${attached} Hyland ${attached === 1 ? 'excerpt' : 'excerpts'}${local ? ', sent to your local model' : offline ? ' in the template' : ''}.` : '';
  $('processing-note').innerHTML = `${icon(offline || local ? 'lock' : 'shield')}<span>${note}${evidenceNote}</span>`;
}

let localAI = null, setupBusy = false, setupCompleted = false, setupHidden = false, setupError = '', detecting = null;
function shouldShowSetup() {
  if (state.preview || setupHidden) return false;
  if (setupCompleted) return true;
  if (state.connection.mode === 'ollama') return Boolean(localAI && (localAI.status !== 'ready' || !localAI.models.some(m => m.name === state.connection.model)));
  return state.connection.mode === 'offline' && !state.setup?.dismissed;
}
function renderSetup() {
  const card = $('local-setup');
  card.hidden = !shouldShowSetup();
  if (card.hidden) return;
  const configured = state.connection.mode === 'ollama';
  const status = setupCompleted ? 'done' : detecting || !localAI ? 'checking' : localAI.status;
  const model = state.connection.model;
  card.dataset.status = status;
  $('setup-eyebrow').textContent = configured && !setupCompleted ? 'LOCAL AI · NEEDS ATTENTION' : 'GUIDED SETUP · ON THIS COMPUTER';
  $('setup-title').textContent = {
    done: 'Local AI is ready', checking: configured ? 'Checking your local model…' : 'Use AI that stays on this computer',
    'not-running': configured ? 'Ollama is not responding' : 'Use AI that stays on this computer',
    'no-models': 'Ollama is running. Add a model to begin.', error: 'Local AI check did not complete',
    ready: configured ? `“${model}” is no longer installed` : 'Choose a model installed on this computer'
  }[status];
  $('setup-message').textContent = setupError || {
    done: `Improve now uses ${model} through Ollama on this computer. ${state.localOnly ? 'Local-only mode is on: cloud providers and knowledge lookups are blocked.' : 'Cloud providers stay available in Settings.'}`,
    checking: 'Looking for Ollama on this computer…',
    ready: `${localAI?.message} Your prompts stay on this device when you use it.`,
    'not-running': `${localAI?.message}${configured ? ' Improve will not work until it responds.' : ' Impromptu keeps working offline in the meantime.'}`
  }[status] || localAI?.message || '';
  $('setup-message').classList.toggle('error', Boolean(setupError));
  $('setup-install').hidden = status !== 'not-running';
  $('setup-pull').hidden = status !== 'no-models';
  $('setup-model-row').hidden = status !== 'ready';
  $('setup-use').hidden = status !== 'ready';
  $('setup-auto').hidden = !['not-running', 'no-models', 'error'].includes(status);
  $('setup-auto-label').textContent = status === 'no-models' ? 'Download a model for me' : 'Set up local AI for me';
  $('setup-cloud').hidden = configured || !['not-running', 'no-models', 'error'].includes(status);
  $('setup-check').hidden = ['done', 'checking'].includes(status);
  $('setup-dismiss').textContent = status === 'done' ? 'Done' : configured ? 'Hide for now' : 'Not now';
  if (status === 'ready') {
    const select = $('setup-model'), previous = select.value;
    select.innerHTML = localAI.models.map(m => `<option value="${escapeHtml(m.name)}">${escapeHtml(m.name)}${m.parameterSize ? ` · ${escapeHtml(m.parameterSize)}` : ''}${m.sizeBytes ? ` · ${(m.sizeBytes / 1e9).toFixed(1)} GB` : ''}</option>`).join('');
    select.value = [previous, model].find(name => localAI.models.some(m => m.name === name)) || localAI.models[0].name;
    if (!configured) $('setup-local-only').checked = state.localOnly || $('setup-local-only').checked;
  }
  for (const id of ['setup-use', 'setup-check', 'setup-dismiss', 'setup-model', 'setup-local-only', 'setup-auto', 'setup-cloud']) $(id).disabled = setupBusy;
  $('setup-use').setAttribute('aria-busy', String(setupBusy));
  $('setup-use-label').textContent = setupBusy ? 'Testing on this computer…' : 'Test & use this model';
}
async function detectLocalAI() {
  if (detecting) return detecting;
  setupError = ''; renderSetup();
  detecting = (async () => {
    try { localAI = await api.detectLocalAI(); }
    catch (error) { localAI = { status: 'error', models: [], message: cleanError(error.message) }; }
    finally { detecting = null; }
    renderSetup(); renderChatModels();
    return localAI;
  })();
  renderSetup();
  return detecting;
}
async function useLocalModel() {
  if (setupBusy || busy) return;
  setupBusy = true; setupError = ''; renderSetup();
  try {
    const result = await api.useLocalAI({ model: $('setup-model').value, localOnly: $('setup-local-only').checked });
    state = result.state; setupCompleted = true;
    toast(`Local AI ready. ${state.connection.model} answered a test prompt in ${(result.durationMs / 1000).toFixed(1)} seconds.`);
  } catch (error) { setupError = cleanError(error.message); }
  finally { setupBusy = false; renderSetup(); updateConnection(); knowledgeStatus(); }
}
function setupLocalAI() {
  $('setup-check').onclick = () => detectLocalAI();
  $('setup-use').onclick = useLocalModel;
  $('setup-get-ollama').onclick = () => attempt(() => api.openHelp('ollama-download'));
  $('setup-browse-models').onclick = () => attempt(() => api.openHelp('ollama-models'));
  $('setup-copy-command').onclick = () => attempt(async () => { await api.copy($('setup-pull-command').textContent); toast('Command copied. Paste it into a terminal, then choose Check again.'); });
  $('setup-dismiss').onclick = () => attempt(async () => {
    if (setupCompleted) setupCompleted = false;
    else if (state.connection.mode === 'offline') state = await api.dismissSetup();
    else setupHidden = true;
    renderSetup();
  });
  // Re-check when the user returns from starting Ollama or installing a model.
  window.addEventListener('focus', () => { if ((!$('local-setup').hidden || activeView === 'chat') && !setupBusy && !setupCompleted && localAI?.status !== 'ready') detectLocalAI(); });
  if (state.connection.mode === 'ollama' || (state.connection.mode === 'offline' && !state.setup?.dismissed)) detectLocalAI();
}
let installPlan = null, installRunning = false;
const gb = bytes => `${(bytes / 1e9).toFixed(bytes >= 1e10 ? 0 : 1)} GB`;
async function openInstaller() {
  $('local-ai-choose').hidden = false; $('local-ai-progress').hidden = true;
  $('local-ai-consent').checked = false;
  $('local-ai-specs').textContent = 'Checking this computer…';
  $('local-ai-dialog').showModal();
  installPlan = await attempt(() => api.localAIPlan());
  if (!installPlan) return;
  const { specs, ollama, catalog } = installPlan;
  $('local-ai-specs').textContent = `This computer: ${specs.ramGB} GB memory${specs.freeGB !== null ? ` · ${specs.freeGB} GB free disk` : ''} · ${specs.platform === 'darwin' ? 'macOS' : specs.platform === 'win32' ? 'Windows' : specs.platform} ${specs.arch}.`;
  $('local-ai-ollama').textContent = ollama.running ? 'Ollama is already running on this computer. Nothing to install.' : ollama.path ? `Ollama is installed (${ollama.path}) but not running. Impromptu will start it.` : 'Not installed. Impromptu will download the official Ollama app, check it is signed by Ollama, install it and start it. Checking the latest version…';
  if (!ollama.running && !ollama.path) api.localAIRelease().then(release => { $('local-ai-ollama').textContent = `Not installed. Impromptu will download Ollama ${release.version || '(latest)'}${release.size ? ` (${gb(release.size)})` : ''} from ${release.source}, check it is signed by Ollama${installPlan.platform === 'darwin' ? ' and notarized by Apple' : ''}, install it and start it.`; }).catch(() => {});
  const installed = new Set(ollama.models);
  $('local-ai-models').innerHTML = catalog.map(m => `<label class="model-option ${m.fits ? '' : 'unavailable'} ${m.recommended ? 'recommended' : ''}"><input type="radio" name="local-model" value="${escapeHtml(m.name)}" ${m.fits ? '' : 'disabled'} ${m.recommended ? 'checked' : ''}><span class="model-body"><span class="model-head"><strong>${escapeHtml(m.label)}</strong><code>${escapeHtml(m.name)}</code>${m.recommended ? '<em>Recommended</em>' : ''}${m.vision ? '<em class="vision">Reads screens</em>' : ''}${installed.has(m.name) ? '<em>Installed</em>' : ''}</span><small>${installed.has(m.name) ? 'Already downloaded' : `${m.size.toFixed(1)} GB download`} · needs ${m.minRam} GB memory · ${escapeHtml(m.license)} · <button type="button" class="text-button" data-model-page="${escapeHtml(m.name)}">Model page ↗</button></small><small>${escapeHtml(m.fits ? m.note : `Not available here: ${m.reason}.`)}</small></span></label>`).join('');
  document.querySelectorAll('[data-model-page]').forEach(button => button.onclick = event => { event.preventDefault(); attempt(() => api.openHelp(`model:${button.dataset.modelPage}`)); });
  document.querySelectorAll('[name="local-model"]').forEach(radio => radio.onchange = () => { $('local-ai-custom').value = ''; updateInstallConsent(); });
  $('local-ai-custom').oninput = () => { if ($('local-ai-custom').value.trim()) document.querySelectorAll('[name="local-model"]').forEach(r => { r.checked = false; }); updateInstallConsent(); };
  if (!catalog.some(m => m.fits)) $('local-ai-models').insertAdjacentHTML('afterbegin', `<p class="pack-warning">This computer does not have enough memory or disk space for the models Impromptu has tested. Use a cloud provider instead, or type a model you know works.</p>`);
  updateInstallConsent();
  document.querySelector('.model-option.recommended')?.scrollIntoView({ block: 'nearest' });
}
function chosenModel() { return $('local-ai-custom').value.trim() || document.querySelector('[name="local-model"]:checked')?.value || ''; }
function updateInstallConsent() {
  const name = chosenModel(), known = installPlan?.catalog.find(m => m.name === name);
  const needsOllama = installPlan && !installPlan.ollama.running && !installPlan.ollama.path;
  const have = installPlan?.ollama.models.includes(name);
  $('local-ai-consent-text').textContent = !name ? 'Choose a model first.' : `I agree to ${[needsOllama && 'download and install Ollama', !have && `download ${name}${known ? ` (${known.size.toFixed(1)} GB)` : ''}`].filter(Boolean).join(' and ') || `use ${name}`} on this computer${have ? '' : `, and accept ${known ? `the ${known.license}` : 'the model\'s licence'}`}.`;
  $('local-ai-start').disabled = !name || installRunning;
}
async function runInstaller() {
  const model = chosenModel();
  if (!model) { toast('Choose a model to download.', true); return; }
  if (!$('local-ai-consent').checked) { toast('Tick the box to agree to the downloads, or choose a cloud provider instead.', true); return; }
  installRunning = true; $('local-ai-choose').hidden = true; $('local-ai-progress').hidden = false;
  $('local-ai-stage').textContent = 'Starting…'; $('local-ai-bar').removeAttribute('value'); $('local-ai-bytes').textContent = '';
  try {
    const result = await api.installLocalAI({ consent: true, model, localOnly: $('local-ai-localonly').checked });
    state = result.state; setupCompleted = true; setupHidden = false;
    $('local-ai-dialog').close();
    toast(`Local AI ready. ${state.connection.model} is installed and answered a test prompt.`);
  } catch (error) {
    $('local-ai-stage').textContent = cleanError(error.message);
    $('local-ai-bytes').textContent = 'Nothing was configured. You can try again, choose another model, or use a cloud provider instead.';
    $('local-ai-cancel').textContent = 'Back';
  } finally {
    installRunning = false; await detectLocalAI(); updateConnection(); knowledgeStatus();
  }
}
function setupInstaller() {
  $('setup-auto').onclick = openInstaller;
  $('setup-cloud').onclick = openSettings;
  $('local-ai-cloud').onclick = () => { $('local-ai-dialog').close(); openSettings(); };
  $('local-ai-close').onclick = () => { if (installRunning) { toast('Setup is running. Cancel it first, or keep it running in the background.'); $('local-ai-dialog').close(); return; } $('local-ai-dialog').close(); };
  $('local-ai-start').onclick = runInstaller;
  $('local-ai-cancel').onclick = () => { if (installRunning) { api.cancelLocalAI(); $('local-ai-stage').textContent = 'Cancelling…'; } else { $('local-ai-cancel').textContent = 'Cancel'; $('local-ai-choose').hidden = false; $('local-ai-progress').hidden = true; } };
  api.onLocalAIProgress(p => {
    $('local-ai-stage').textContent = p.message;
    if (p.total) { $('local-ai-bar').max = p.total; $('local-ai-bar').value = p.done || 0; $('local-ai-bytes').textContent = `${gb(p.done || 0)} of ${gb(p.total)} · ${Math.floor(((p.done || 0) / p.total) * 100)}%`; }
    else { $('local-ai-bar').removeAttribute('value'); $('local-ai-bytes').textContent = ''; }
  });
}
async function detectSettingsModels() {
  const button = $('ollama-refresh'); button.disabled = true;
  $('ollama-status').textContent = 'Checking Ollama on this computer…';
  try {
    const result = await api.detectLocalAI($('endpoint').value);
    $('ollama-models').innerHTML = result.models.map(m => `<option value="${escapeHtml(m.name)}"></option>`).join('');
    if (result.models.length && !result.models.some(m => m.name === $('model').value)) $('model').value = result.models[0].name;
    $('ollama-status').textContent = result.models.length ? `${result.message} Installed: ${result.models.map(m => m.name).join(', ')}.` : result.message;
  } catch (error) { $('ollama-status').textContent = cleanError(error.message); }
  finally { button.disabled = false; }
}
let chatSummaries = [], activeChat = null, chatBusy = false, streamingBubble = null;
const chatStarters = ['Explain tokenmining: how can I get the same result from an AI with fewer tokens?', 'Help me turn this rough idea into a clear, specific prompt.', 'Summarise the key points of the text I paste next as five bullets.'];
function inlineMarkdown(escaped) {
  return escaped.replace(/`([^`\n]+)`/g, '<code>$1</code>').replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[\s(])\*([^*\s][^*\n]*)\*(?=[\s.,;:!?)]|$)/gm, '$1<em>$2</em>');
}
function renderChatText(text) {
  // Escape first, then add a few formatting tags; model output is never interpreted as HTML.
  return String(text).split(/```[\w-]*\n?/).map((part, index) => {
    if (index % 2) return `<pre><code>${escapeHtml(part.replace(/\n$/, ''))}</code></pre>`;
    if (!part.trim()) return '';
    const lines = escapeHtml(part.trim()).split('\n').map(line => {
      const heading = line.match(/^#{1,6}\s+(.*)$/);
      if (heading) return `<strong class="chat-heading">${inlineMarkdown(heading[1])}</strong>`;
      if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) return '<hr>';
      return inlineMarkdown(line.replace(/^(\s*)[*-]\s+/, '$1• '));
    });
    return `<div class="chat-text">${lines.join('\n')}</div>`;
  }).join('');
}
function chatMeta(message) {
  if (message.role !== 'assistant') return '';
  const parts = [message.model, message.durationMs ? `${(message.durationMs / 1000).toFixed(1)} s` : '', message.usage ? `${message.usage.input.toLocaleString()} in / ${message.usage.output.toLocaleString()} out tokens` : '', message.stopped ? 'stopped' : ''].filter(Boolean);
  return `<div class="chat-meta"><span>${escapeHtml(parts.join(' · '))}</span><button type="button" class="text-button" data-copy-message="${escapeHtml(message.id)}"><span data-icon="copy"></span>Copy</button></div>`;
}
function renderChatList() {
  $('chat-list').innerHTML = chatSummaries.length ? chatSummaries.map(c => `<div class="chat-list-item ${activeChat?.id === c.id ? 'active' : ''}"><button type="button" class="chat-open" data-open-chat="${escapeHtml(c.id)}" ${chatBusy ? 'disabled' : ''}><span class="chat-list-title">${escapeHtml(c.title)}</span><small>${c.provider === 'cloud' ? `${escapeHtml(c.providerLabel)} · ` : ''}${c.temporary ? 'Temporary · not saved' : escapeHtml(new Date(c.updatedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }))}</small></button><button type="button" class="icon-button" data-delete-chat="${escapeHtml(c.id)}" aria-label="Delete chat: ${escapeHtml(c.title)}" ${chatBusy ? 'disabled' : ''}>×</button></div>`).join('') : '<p class="help chat-list-empty">No chats yet. Your conversations appear here.</p>';
  $('chat-export').disabled = chatBusy || !chatSummaries.some(c => !c.temporary);
  $('chat-clear').disabled = chatBusy || !chatSummaries.length;
  document.querySelectorAll('[data-open-chat]').forEach(button => button.onclick = () => attempt(async () => { activeChat = await api.chatGet(button.dataset.openChat); renderChat(); }));
  document.querySelectorAll('[data-delete-chat]').forEach(button => button.onclick = () => attempt(async () => {
    if (!window.confirm('Delete this chat from this device?')) return;
    chatSummaries = await api.chatDelete(button.dataset.deleteChat);
    if (activeChat?.id === button.dataset.deleteChat) activeChat = null;
    renderChat(); toast('Chat deleted.');
  }));
}
function renderChat() {
  renderChatList();
  $('chat-title').textContent = activeChat?.title || 'New chat';
  $('chat-tag').textContent = activeChat?.provider === 'cloud' ? `CLOUD · ${String(activeChat.providerLabel).toUpperCase()}` : activeChat?.temporary || (!activeChat && !state.chat?.saveNewChats) ? 'PREVIEW · TEMPORARY' : 'PREVIEW · ON THIS COMPUTER';
  renderChatModels();
  const messages = activeChat?.messages || [];
  $('chat-thread').innerHTML = messages.length ? messages.map(m => `<article class="chat-message ${m.role}"><div class="chat-bubble">${renderChatText(m.content)}</div>${chatMeta(m)}</article>`).join('')
    : `<div class="chat-empty"><div class="orbit-mark" aria-hidden="true">✳</div><h3>AI that runs on this computer.</h3><p>No subscription, no token bill, nothing sent outside this device. Local models can be wrong; check anything important.</p><div class="chat-starters">${chatStarters.map((s, i) => `<button type="button" class="secondary" data-starter="${i}">${escapeHtml(s)}</button>`).join('')}</div></div>`;
  fillIcons($('chat-thread'));
  document.querySelectorAll('[data-starter]').forEach(button => button.onclick = () => { $('chat-input').value = chatStarters[button.dataset.starter]; $('chat-input').focus(); });
  document.querySelectorAll('[data-copy-message]').forEach(button => button.onclick = () => attempt(async () => { await api.copy(activeChat.messages.find(m => m.id === button.dataset.copyMessage).content); toast('Reply copied.'); }));
  $('chat-thread').scrollTop = $('chat-thread').scrollHeight;
}
function renderChatModels() {
  if (activeChat?.provider === 'cloud') {
    $('chat-model').innerHTML = `<option value="${escapeHtml(activeChat.model)}">${escapeHtml(activeChat.providerLabel)} · ${escapeHtml(activeChat.model)}</option>`;
    $('chat-notice').hidden = true;
    $('chat-privacy').textContent = `Sent to ${activeChat.providerLabel}, your configured cloud provider. Not on this computer.`;
    $('chat-input').placeholder = `Message ${activeChat.providerLabel}… (Enter to send, Shift+Enter for a new line)`;
    document.querySelector('.chat-model-wrap [data-icon]').innerHTML = icon('shield');
    setChatBusy(chatBusy); updateConnection(); return;
  }
  $('chat-privacy').textContent = 'Runs on this computer through Ollama. Nothing leaves your device.';
  $('chat-input').placeholder = 'Message your local model… (Enter to send, Shift+Enter for a new line)';
  const wrapIcon = document.querySelector('.chat-model-wrap [data-icon]'); if (wrapIcon) wrapIcon.innerHTML = icon('lock');
  const ready = localAI?.status === 'ready';
  const select = $('chat-model'), previous = select.value;
  select.innerHTML = ready ? localAI.models.map(m => `<option value="${escapeHtml(m.name)}">${escapeHtml(m.name)}</option>`).join('') : '<option value="">No local model</option>';
  if (ready) select.value = [previous, activeChat?.model, state.chat?.model, state.connection.mode === 'ollama' ? state.connection.model : ''].find(name => localAI.models.some(m => m.name === name)) || localAI.models[0].name;
  $('chat-notice').hidden = ready || !localAI || Boolean(detecting);
  $('chat-notice-text').textContent = !localAI ? '' : localAI.status === 'no-models' ? `${localAI.message} Install one yourself in a terminal, for example “ollama pull llama3.2”, then choose Check again.` : localAI.message;
  setChatBusy(chatBusy);
  updateConnection();
}
function setChatBusy(value) {
  chatBusy = value;
  const cloud = activeChat?.provider === 'cloud';
  const ready = cloud || localAI?.status === 'ready';
  $('chat-send').disabled = value || !ready; $('chat-model').disabled = value || !ready || cloud;
  $('chat-new').disabled = value; $('chat-improve').disabled = value;
  $('chat-stop').hidden = !value; $('chat-send').hidden = value;
  $('chat-send').setAttribute('aria-busy', String(value));
  renderChatList();
}
async function openChatView() {
  $('chat-save-setting').checked = state.chat?.saveNewChats !== false;
  chatSummaries = await attempt(() => api.chatList()) || [];
  if (activeChat && !chatSummaries.some(c => c.id === activeChat.id)) activeChat = null;
  renderChat();
  if (!localAI || localAI.status !== 'ready') await detectLocalAI();
  renderChatModels();
  if (!chatBusy) $('chat-input').focus();
}
async function sendChat() {
  const text = $('chat-input').value.trim();
  if (chatBusy) return;
  if (!text) { $('chat-input').focus(); return; }
  const cloud = activeChat?.provider === 'cloud';
  const model = cloud ? activeChat.model : $('chat-model').value;
  if (!model) { toast('Set up a local model first. Start Ollama, then choose Check again.', true); return; }
  setChatBusy(true);
  let chatId = activeChat?.id;
  try {
    if (!activeChat) { activeChat = await api.chatNew({ model }); chatId = activeChat.id; }
    activeChat.messages = [...activeChat.messages, { id: 'pending', role: 'user', content: text }];
    $('chat-input').value = '';
    renderChat();
    $('chat-thread').insertAdjacentHTML('beforeend', `<article class="chat-message assistant streaming"><div class="chat-bubble"><div class="chat-text" id="chat-streaming"><span class="chat-typing">${cloud ? `Waiting for ${escapeHtml(activeChat.providerLabel || 'the provider')}…` : 'Thinking on this computer…'}</span></div></div></article>`);
    streamingBubble = $('chat-streaming');
    $('chat-thread').scrollTop = $('chat-thread').scrollHeight;
    const result = await api.chatSend({ chatId, text, model });
    activeChat = result.chat;
    if (result.stopped) toast('Reply stopped.');
  } catch (error) {
    toast(error.message, true);
    // The main process rolls back the unanswered message; restore it for a retry.
    if (!$('chat-input').value) $('chat-input').value = text;
    activeChat = await api.chatGet(chatId).catch(() => null);
    if (/Ollama is not responding|not installed/.test(error.message)) detectLocalAI().then(renderChatModels);
  } finally {
    streamingBubble = null;
    chatSummaries = await api.chatList().catch(() => chatSummaries);
    setChatBusy(false); renderChat();
    $('chat-input').focus();
  }
}
function setupChat() {
  $('chat-form').onsubmit = event => { event.preventDefault(); sendChat(); };
  $('chat-input').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && !event.metaKey && !event.ctrlKey) { event.preventDefault(); sendChat(); } });
  $('chat-stop').onclick = () => { if (activeChat) api.chatStop(activeChat.id); };
  $('chat-new').onclick = () => { if (chatBusy) return; activeChat = null; renderChat(); $('chat-input').focus(); };
  $('chat-model').onchange = updateConnection;
  $('chat-recheck').onclick = () => detectLocalAI().then(renderChatModels);
  $('chat-improve').onclick = () => {
    const text = $('chat-input').value.trim();
    if (!text) { toast('Write a draft first, then improve it.'); return; }
    if (busy) { toast('Wait for the current improvement to finish.'); return; }
    setInput({ prompt: text, skillId: $('skill').value }, 'Brought from Local chat. Improve it, then copy it back.');
  };
  $('chat-save-setting').onchange = () => attempt(async () => { state = await api.chatSettings({ saveNewChats: $('chat-save-setting').checked }); renderChat(); toast(state.chat.saveNewChats ? 'New chats will be saved on this device.' : 'New chats are temporary and will not be saved.'); });
  $('chat-export').onclick = () => attempt(async () => { if (await api.chatExport()) toast('Saved chats exported.'); });
  $('chat-clear').onclick = () => attempt(async () => { if (!window.confirm('Delete every chat from this device? This cannot be undone.')) return; chatSummaries = await api.chatClear(); activeChat = null; renderChat(); toast('All chats deleted.'); });
  api.onChatDelta(({ chatId, delta }) => {
    if (!streamingBubble || activeChat?.id !== chatId) return;
    streamingBubble.querySelector('.chat-typing')?.remove();
    streamingBubble.append(delta);
    const thread = $('chat-thread');
    if (thread.scrollHeight - thread.scrollTop - thread.clientHeight < 160) thread.scrollTop = thread.scrollHeight;
  });
}
function applyLocalOnlyOptions() {
  const localOnly = $('local-only-setting').checked;
  for (const option of $('connection-mode').options) if (['openrouter', 'huggingface', 'bedrock'].includes(option.value)) option.disabled = localOnly;
}
function updateSkill() { $('skill-description').textContent = state.skills.find(s => s.id === $('skill').value)?.description || ''; }
function invalidate() {
  if (busy) return;
  current = null; savedId = null;
  $('result-empty').hidden = false; $('result-content').hidden = true; $('explain-content').hidden = true; $('result-tag').textContent = 'READY WHEN YOU ARE';
  const length = $('prompt').value.length;
  $('char-count').textContent = `${length.toLocaleString()} characters${length ? ` · ≈${Math.ceil(length / 4).toLocaleString()} tokens` : ''}`;
  $('char-count').title = 'Token estimate: characters ÷ 4. Each model counts slightly differently.';
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
let evidenceSources = [], evidenceBusy = false;
const selectedEvidence = () => [...document.querySelectorAll('[data-evidence]:checked')].map(box => box.dataset.evidence);
function renderEvidence() {
  const localOnly = Boolean(state.localOnly);
  $('evidence-find').disabled = evidenceBusy || localOnly;
  $('evidence-query').disabled = evidenceBusy || localOnly;
  $('evidence-find').textContent = evidenceBusy ? 'Searching…' : 'Find evidence';
  if (localOnly) $('evidence-status').textContent = 'Local-only mode is on. Hyland evidence uses Atlassian and your Codex account, so it is turned off.';
  $('evidence-list').innerHTML = evidenceSources.map(s => `<div class="evidence-item ${s.fetched ? '' : 'unavailable'}"><label class="checkbox-label"><input type="checkbox" data-evidence="${escapeHtml(s.id)}" ${s.fetched ? '' : 'disabled'}><span><strong>[${escapeHtml(s.id)}] ${escapeHtml(s.title)}</strong><small>${escapeHtml(s.product)}${s.modified ? ` · updated ${escapeHtml(new Date(s.modified).toLocaleDateString())}` : ''}${s.fetched ? s.truncated ? ' · selected excerpts' : '' : ' · search snippet only, cannot be attached'}</small></span></label>${s.fetched ? `<details><summary>Preview the excerpt</summary><pre>${escapeHtml(s.excerpt.slice(0, 1500))}${s.excerpt.length > 1500 ? '\n[…]' : ''}</pre></details>` : ''}<button type="button" class="text-button" data-evidence-open="${escapeHtml(s.id)}">Open source ↗</button></div>`).join('');
  $('evidence-attach-label').hidden = !evidenceSources.some(s => s.fetched);
  document.querySelectorAll('[data-evidence]').forEach(box => box.onchange = () => { invalidate(); updateConnection(); });
  document.querySelectorAll('[data-evidence-open]').forEach(button => button.onclick = () => attempt(() => api.openSource(evidenceSources.find(s => s.id === button.dataset.evidenceOpen).url)));
}
async function findEvidence() {
  if (evidenceBusy || state.localOnly) return;
  const query = $('evidence-query').value.trim() || $('prompt').value.trim();
  if (!query) { $('evidence-query').focus(); toast('Add a search topic, or write your prompt first.'); return; }
  evidenceBusy = true; renderEvidence(); $('evidence-status').textContent = 'Searching Confluence and Jira with your Atlassian permissions…';
  try {
    const result = await api.findEvidence(query);
    evidenceSources = result.sources; invalidate();
    const usable = evidenceSources.filter(s => s.fetched).length;
    $('evidence-status').textContent = usable ? `${usable} ${usable === 1 ? 'source' : 'sources'} found. Tick the passages to attach; they go to your AI provider when you click Improve.${result.warnings.length ? ` ${result.warnings[0]}` : ''}` : 'No readable sources found. Try a project name, issue key or more specific topic. A missing result does not mean the documentation does not exist.';
  } catch (error) { $('evidence-status').textContent = `${cleanError(error.message)} Your prompt is unchanged.`; toast(error.message, true); }
  finally { evidenceBusy = false; renderEvidence(); updateConnection(); }
}
function withSources(text, result) {
  if (!result?.evidence?.length) return text;
  const excerpts = $('evidence-attach').checked;
  const blocks = result.evidence.map(e => { const source = evidenceSources.find(s => s.id === e.id && s.url === e.url); return `[${e.id}] ${e.title} (${e.product})\n${e.url}${excerpts && source?.excerpt ? `\n${source.excerpt.slice(0, 3000)}` : ''}`; });
  return `${text}\n\n${excerpts ? 'Evidence from Hyland sources' : 'Hyland sources'}\n${blocks.join('\n\n')}`;
}
let promptAction = 'improve';
const actionText = {
  improve: { label: 'Improve prompt', busy: 'Finding a clearer direction…', help: 'Clearer structure and missing context, keeping your intent.' },
  compress: { label: 'Compress prompt', busy: 'Trimming the extra tokens…', help: 'Tokenmining: the same request in fewer tokens. Needs an AI model.' },
  explain: { label: 'Explain my prompt', busy: 'Reading your prompt…', help: 'Learn what works, what is unclear, and how to spend fewer tokens. Needs an AI model.' }
};
function setAction(action) {
  if (busy || !actionText[action]) return;
  promptAction = action;
  document.querySelectorAll('[data-action]').forEach(button => button.setAttribute('aria-checked', String(button.dataset.action === action)));
  $('action-help').textContent = actionText[action].help;
  $('improve-label').textContent = actionText[action].label;
  invalidate();
}
function setBusy(value) {
  busy = value;
  for (const id of [...inputIds, 'skill', 'improve', 'paste-prompt', 'new-draft', 'use-incoming', 'explain-improve']) $(id).disabled = value;
  document.querySelectorAll('[data-sample], [data-action]').forEach(button => button.disabled = value);
  $('improve-label').textContent = value ? actionText[promptAction].busy : actionText[promptAction].label;
  $('improve').setAttribute('aria-busy', String(value));
}
const list = items => items.map(item => `<li>${escapeHtml(item)}</li>`).join('');
function usageText(result) {
  return `${result.mode === 'ollama' ? 'On this computer · ' : ''}${result.model} · ${(result.durationMs / 1000).toFixed(1)} seconds · ${result.usage ? `${result.usage.input.toLocaleString()} input / ${result.usage.output.toLocaleString()} output tokens reported for this request.` : 'The provider did not return token usage.'}`;
}
function renderExplain(result) {
  const e = result.explanation;
  $('result-empty').hidden = true; $('result-content').hidden = true; $('explain-content').hidden = false;
  $('result-tag').textContent = 'AI EXPLANATION';
  $('explain-summary').textContent = e.summary;
  for (const key of ['strengths', 'gaps', 'tips']) { $(`explain-${key}`).innerHTML = list(e[key]); $(`explain-${key}-block`).hidden = !e[key].length; }
  $('explain-improve').hidden = !e.tips.length && !e.gaps.length;
  $('explain-usage').textContent = `${usageText(result)} Explanations come from a model and can be wrong; use your judgement.`;
  if (result.analysis) renderSignals(result.analysis);
}
function renderSavings(result) {
  const { original, result: compressed } = result.stats;
  const saved = original.estimatedTokens - compressed.estimatedTokens;
  const percent = original.estimatedTokens ? Math.round((saved / original.estimatedTokens) * 100) : 0;
  $('savings').hidden = false;
  $('savings').classList.toggle('neutral', saved <= 0);
  $('savings').innerHTML = saved > 0
    ? `<strong>≈${original.estimatedTokens.toLocaleString()} → ≈${compressed.estimatedTokens.toLocaleString()} tokens · about ${percent}% shorter</strong><span>${original.words.toLocaleString()} → ${compressed.words.toLocaleString()} words. Estimate: characters ÷ 4; each model's tokenizer counts slightly differently.</span>`
    : `<strong>Already compact · no shorter version found</strong><span>${original.words.toLocaleString()} words, ≈${original.estimatedTokens.toLocaleString()} tokens (estimate). Compression works best on long, repetitive prompts.</span>`;
  $('missing-block').hidden = !result.missing.length;
  $('missing').innerHTML = list(result.missing);
}
function renderResult(result) {
  if (result.action === 'explain') { renderExplain(result); return; }
  $('result-empty').hidden = true; $('result-content').hidden = false; $('explain-content').hidden = true;
  $('savings').hidden = true; $('missing-block').hidden = true;
  if (result.action === 'compress' && result.stats) renderSavings(result);
  $('result-sources').hidden = !result.evidence?.length;
  $('result-sources').innerHTML = result.evidence?.length ? `<h3>HYLAND SOURCES ATTACHED</h3><ul>${result.evidence.map(e => `<li>[${escapeHtml(e.id)}] ${escapeHtml(e.title)} · ${escapeHtml(e.product)}</li>`).join('')}</ul>` : '';
  $('result-tag').textContent = result.mode === 'offline' ? 'LOCAL SKILL APPLIED' : result.action === 'compress' ? 'AI COMPRESSION' : 'AI SUGGESTION';
  $('result-text').value = result.improved;
  for (const key of ['changes', 'questions']) $(key).innerHTML = result[key].map(item => `<li>${escapeHtml(item)}</li>`).join('');
  $('questions-block').hidden = !result.questions.length;
  $('usage-note').textContent = result.mode === 'offline' ? 'Deterministic skill template · no AI generation or token usage. Review relevance before copying.' : `${usageText(result)} Check that the ${result.action === 'compress' ? 'shorter version' : 'suggestion'} preserves your intent.`;
  $('save-result').disabled = false;
  $('copy-result').innerHTML = `${icon('copy')}${result.action === 'compress' ? 'Copy compressed prompt' : 'Copy improved prompt'}`;
  $('save-result').innerHTML = `${icon('bookmark')}${savedId ? 'Saved' : 'Save'}`;
  if (result.analysis) renderSignals(result.analysis);
  if (result.tip) $('coach-tip').textContent = result.tip;
}
async function improve() {
  if (busy) return;
  if (!$('prompt').value.trim()) { $('prompt').focus(); toast('Start with a prompt, or try one of the sample drafts.'); return; }
  setBusy(true);
  const snapshot = input();
  try {
    const evidence = selectedEvidence();
    const result = await api.improve({ ...snapshot, action: promptAction, ...(evidence.length ? { evidence } : {}) }); current = { input: snapshot, result }; savedId = null; renderResult(result);
    const used = state.skills.find(skill => skill.custom && skill.id === result.skillId); if (used) used.uses = (used.uses || 0) + 1;
  }
  catch (error) {
    toast(error.message, true);
    if (state.connection.mode === 'ollama') { setupHidden = false; detectLocalAI(); }
    else if (state.connection.mode === 'offline' && promptAction !== 'improve') { setupHidden = false; state.setup = { ...state.setup, dismissed: false }; detectLocalAI(); }
  }
  finally { setBusy(false); }
}
let editingSkillId = null, skillifyBusy = false;
function skillCard(skill) {
  const meta = [skill.category, `v${skill.version}`, skill.custom ? `used ${skill.uses || 0} ${skill.uses === 1 ? 'time' : 'times'}` : 'STARTER TEMPLATE'];
  const actions = `<div class="skill-card-actions"><button class="secondary" data-use-skill="${escapeHtml(skill.id)}">Use skill ↗</button><button class="text-button" data-chat-skill="${escapeHtml(skill.id)}"><span data-icon="chat"></span>Chat with it</button>${skill.custom ? `<button class="text-button" data-edit-skill="${escapeHtml(skill.id)}">Edit</button><button class="text-button delete" data-delete-skill="${escapeHtml(skill.id)}">Delete</button>` : `<button class="text-button" data-duplicate-skill="${escapeHtml(skill.id)}">Duplicate &amp; edit</button>`}</div>`;
  return `<article class="skill-card"><div class="skill-icon">${icon(skill.icon)}</div><div><h2>${escapeHtml(skill.name)}</h2><div class="skill-meta">${meta.map(escapeHtml).join(' · ')}</div><p>${escapeHtml(skill.description || 'No description.')}</p><details><summary>Read the working approach</summary><p>${escapeHtml(skill.instructions)}</p></details></div>${actions}</article>`;
}
function refreshSkills(list) {
  state.skills = list;
  const selected = $('skill').value;
  $('skill').innerHTML = state.skills.map(s => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)}${s.custom ? ' · yours' : ''}</option>`).join('');
  $('skill').value = state.skills.some(s => s.id === selected) ? selected : 'general';
  updateSkill(); renderSkills();
}
function renderSkills() {
  const custom = state.skills.filter(s => s.custom).sort((a, b) => (b.uses || 0) - (a.uses || 0) || a.name.localeCompare(b.name));
  $('custom-skill-count').textContent = custom.length ? `${custom.length} saved on this device · most used first` : '';
  $('custom-skills-list').innerHTML = custom.length ? custom.map(skillCard).join('') : '<div class="empty-state skills-empty"><h2>No skills of your own yet.</h2><p>Skillify a prompt that worked, write one yourself, or duplicate a starter skill. Saved skills appear in the Prompt workspace and Local chat.</p></div>';
  $('skills-list').innerHTML = state.skills.filter(s => !s.custom).map(skillCard).join('');
  $('skills-export').disabled = !custom.length;
  fillIcons($('skills-view'));
  const find = id => state.skills.find(s => s.id === id);
  document.querySelectorAll('[data-use-skill]').forEach(button => button.onclick = () => { if (busy) { toast('Wait for the current improvement to finish.'); return; } $('skill').value = button.dataset.useSkill; updateSkill(); invalidate(); showView('workspace'); $('prompt').focus(); });
  document.querySelectorAll('[data-chat-skill]').forEach(button => button.onclick = () => {
    if (chatBusy) { toast('Wait for the current chat reply to finish.'); return; }
    const skill = find(button.dataset.chatSkill);
    activeChat = null; showView('chat');
    $('chat-input').value = `Follow this working approach (“${skill.name}”):\n${skill.instructions}\n\nMy task: `;
    $('chat-input').focus(); $('chat-input').setSelectionRange($('chat-input').value.length, $('chat-input').value.length);
  });
  document.querySelectorAll('[data-edit-skill]').forEach(button => button.onclick = () => openSkillEditor(find(button.dataset.editSkill), 'Editing your skill. Saving creates a new version.', button.dataset.editSkill));
  document.querySelectorAll('[data-duplicate-skill]').forEach(button => { const skill = find(button.dataset.duplicateSkill); button.onclick = () => openSkillEditor({ ...skill, name: `${skill.name} (my version)` }, 'Your own copy of a starter skill. Starter skills stay unchanged.'); });
  document.querySelectorAll('[data-delete-skill]').forEach(button => button.onclick = () => attempt(async () => {
    if (!window.confirm('Delete this skill from this device? Saved sessions that used it keep their text.')) return;
    refreshSkills(await api.deleteSkill(button.dataset.deleteSkill)); toast('Skill deleted.');
  }));
}
function openSkillEditor(skill = {}, note = '', id = null) {
  editingSkillId = id;
  $('edit-skill-name').value = skill.name || ''; $('edit-skill-category').value = skill.category || ''; $('edit-skill-description').value = skill.description || ''; $('edit-skill-instructions').value = skill.instructions || '';
  $('skill-editor-note').textContent = note; $('edit-skill-save-label').textContent = id ? 'Save new version' : 'Save skill';
  $('skill-editor').hidden = false; $('skillify-source-block').hidden = true;
  $('skill-editor').scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  $('edit-skill-name').focus();
}
function closeSkillEditor() { editingSkillId = null; $('skill-editor').hidden = true; $('skillify-source-block').hidden = false; }
function setSkillifyBusy(value) {
  skillifyBusy = value;
  for (const id of ['skillify-generate', 'skillify-manual', 'skillify-use-draft', 'skillify-source']) $(id).disabled = value;
  $('skillify-generate').setAttribute('aria-busy', String(value));
  $('skillify-generate-label').textContent = value ? 'Drafting your skill…' : 'Generate a skill';
}
async function generateSkillDraft() {
  if (skillifyBusy) return;
  const source = $('skillify-source').value.trim();
  if (!source) { $('skillify-source').focus(); toast('Paste a prompt or describe a task first.'); return; }
  if (busy) { toast('Wait for the current improvement to finish.'); return; }
  setSkillifyBusy(true); $('skillify-note').textContent = 'Drafting with your AI connection…';
  try {
    const result = await api.generateSkill(source);
    openSkillEditor(result.draft, `AI draft from ${result.mode === 'ollama' ? `${result.model} on this computer` : result.model} in ${(result.durationMs / 1000).toFixed(1)} s. Review and edit before saving; nothing is saved yet.`);
    $('skillify-note').textContent = 'Generating uses your AI connection. You review and edit the draft before anything is saved.';
  } catch (error) {
    $('skillify-note').textContent = `${cleanError(error.message)} You can still write the skill yourself.`;
    toast(error.message, true);
  } finally { setSkillifyBusy(false); }
}
let learningData = null, bench = null;
async function openLearning() {
  learningData = await attempt(() => api.learningState());
  if (!learningData) return;
  renderLearning();
}
function renderLearning() {
  const { milestones, progress } = learningData;
  const status = Object.fromEntries(progress.milestones.map(m => [m.id, m]));
  const latest = learningData.runs[0];
  $('learn-summary').innerHTML = `<div class="learn-progress"><strong>${progress.completed} of ${milestones.length} milestones</strong><progress value="${progress.completed}" max="${milestones.length}" aria-label="Milestones completed"></progress></div><p>${progress.readyForMore ? 'You are writing strong prompts. You are ready for the next level: skills, then agents.' : progress.next ? `Up next: <strong>${escapeHtml(milestones.find(m => m.id === progress.next).title)}</strong>.` : 'Every milestone is complete. Keep using the benchmark to check your habits.'}${latest ? ` Latest benchmark: <strong>${latest.total}/100</strong>.` : ' Try the personal benchmark below to see where you stand.'}</p>`;
  $('milestones').innerHTML = milestones.map(m => {
    const s = status[m.id], next = progress.next === m.id;
    return `<li class="milestone ${s.done ? 'done' : ''} ${next ? 'next' : ''}"><div class="milestone-marker" aria-hidden="true">${s.done ? '✓' : m.level}</div><div class="milestone-body"><div class="milestone-head"><h2>${escapeHtml(m.title)}</h2><span class="milestone-status">${s.done ? 'Done' : next ? 'Up next' : 'Not yet'}${m.auto ? '' : ' · self-reported'}</span></div><p>${escapeHtml(m.summary)}</p><details ${next ? 'open' : ''}><summary>Why it matters, practice and reading</summary><p class="milestone-why">${escapeHtml(m.why)}</p><p><strong>Practice:</strong> ${escapeHtml(m.practice)}</p><p class="milestone-detail">${escapeHtml(s.detail)}</p><div class="milestone-actions"><button type="button" class="secondary" data-milestone-action="${m.id}">${escapeHtml(m.action.label)} ↗</button>${m.auto ? '' : `<button type="button" class="text-button" data-milestone-mark="${m.id}" data-done="${!s.done}">${s.done ? 'Mark as not done' : 'Mark as done'}</button>`}</div><ul class="readings">${m.readings.map(r => `<li><button type="button" class="text-button" data-reading="${escapeHtml(r.url)}">${escapeHtml(r.title)} ↗</button></li>`).join('')}</ul></details></div></li>`;
  }).join('');
  document.querySelectorAll('[data-milestone-action]').forEach(button => button.onclick = () => {
    const action = milestones.find(m => m.id === button.dataset.milestoneAction).action;
    if (action.view === 'chat') { if (chatBusy) { toast('Wait for the current chat reply to finish.'); return; } activeChat = null; showView('chat'); $('chat-input').value = action.chatPrompt; $('chat-input').focus(); return; }
    showView(action.view);
    if (action.promptAction) setAction(action.promptAction);
  });
  document.querySelectorAll('[data-milestone-mark]').forEach(button => button.onclick = () => attempt(async () => { learningData = await api.markMilestone({ id: button.dataset.milestoneMark, done: button.dataset.done === 'true' }); renderLearning(); }));
  document.querySelectorAll('[data-reading]').forEach(button => button.onclick = () => attempt(() => api.openReading(button.dataset.reading)));
  if (!bench) renderBenchmarkIntro();
  renderRanked();
}
function renderBenchmarkIntro() {
  const runs = learningData.runs;
  $('benchmark-intro').hidden = false; $('benchmark-run').hidden = true; $('benchmark-result').hidden = true;
  $('benchmark-intro').innerHTML = `<p>Six everyday tasks, from a meeting summary to a tokenmining rewrite. Write the prompt you would give an AI; a transparent rubric scores it out of 100: the five brief signals, task-specific essentials, and conciseness. It measures how complete and efficient your brief is, not your ability, and needs no AI model.</p><p class="help">Compare with your own earlier attempts, and with reference prompts written for each task (they average ${learningData.referenceTotal}/100). To compare with other people, join opt-in ranked mode below. Your answers stay on this device so you can review them; Erase learning data removes them.</p>${runs.length ? `<div class="benchmark-history"><h3>YOUR ATTEMPTS</h3>${runs.slice(0, 6).map((run, i) => `<div class="bar-row"><span>${escapeHtml(new Date(run.date).toLocaleDateString([], { dateStyle: 'medium' }))}</span><progress value="${run.total}" max="100" aria-label="Score ${run.total} of 100"></progress><span>${run.total}/100${(() => { const c = i === 0 ? compareRuns(run, runs[1]) : null; return c?.shared ? ` (${c.delta >= 0 ? '+' : ''}${c.delta} on ${c.shared} shared)` : ''; })()} · ${run.answered}/6 tasks</span></div>`).join('')}</div>` : ''}<div class="skillify-actions"><button type="button" class="primary compact" id="benchmark-start"><span data-icon="spark"></span>${runs.length ? 'Take the benchmark again' : 'Start the benchmark'}</button>${runs.length ? '<button type="button" class="secondary" id="benchmark-last">Review latest results</button>' : ''}</div>`;
  fillIcons($('benchmark-intro'));
  $('benchmark-start').onclick = () => { bench = { index: 0, answers: {} }; renderBenchmarkStep(); };
  if (runs.length) $('benchmark-last').onclick = () => renderBenchmarkResult(runs[0], runs[1]);
}
function renderBenchmarkStep() {
  const tasks = learningData.tasks, task = tasks[bench.index];
  $('benchmark-intro').hidden = true; $('benchmark-run').hidden = false; $('benchmark-result').hidden = true;
  $('benchmark-count').textContent = `Task ${bench.index + 1} of ${tasks.length}`;
  $('benchmark-progress').max = tasks.length; $('benchmark-progress').value = bench.index + 1;
  $('benchmark-task-title').textContent = task.title; $('benchmark-scenario').textContent = task.scenario;
  $('benchmark-answer').value = bench.answers[task.id] || '';
  $('benchmark-budget').textContent = `Aim for about ${task.budget} tokens or fewer`;
  $('benchmark-back').disabled = bench.index === 0;
  $('benchmark-next').textContent = bench.index === tasks.length - 1 ? 'Finish and score' : 'Next task';
  updateBenchmarkEstimate(); $('benchmark-answer').focus();
}
function updateBenchmarkEstimate() {
  const length = $('benchmark-answer').value.length;
  $('benchmark-estimate').textContent = `${length.toLocaleString()} characters${length ? ` · ≈${Math.ceil(length / 4)} tokens` : ''}`;
}
async function benchmarkMove(step, skip = false) {
  const tasks = learningData.tasks, task = tasks[bench.index];
  bench.answers[task.id] = skip ? '' : $('benchmark-answer').value;
  const index = bench.index + step;
  if (index < 0) return;
  if (index < tasks.length) { bench.index = index; renderBenchmarkStep(); return; }
  await attempt(async () => {
    const result = await api.submitBenchmark(bench.answers);
    learningData = result.state; bench = null;
    renderLearning(); renderBenchmarkResult(result.run, learningData.runs[1]);
  });
}
function compareRuns(run, previous) {
  if (!previous) return null;
  const shared = run.tasks.filter(t => t.prompt && previous.tasks.find(p => p.id === t.id)?.prompt);
  if (!shared.length) return { shared: 0 };
  const average = tasks => Math.round(tasks.reduce((n, t) => n + t.score, 0) / tasks.length);
  const now = average(shared), before = average(shared.map(t => previous.tasks.find(p => p.id === t.id)));
  return { shared: shared.length, now, before, delta: now - before };
}
function renderBenchmarkResult(run, previous) {
  const tasks = learningData.tasks;
  $('benchmark-intro').hidden = true; $('benchmark-run').hidden = true; $('benchmark-result').hidden = false;
  const compared = compareRuns(run, previous);
  $('benchmark-result').innerHTML = `<div class="benchmark-score"><strong>${run.total}<small>/100</small></strong><div><p>${run.answered} of ${tasks.length} tasks answered · ${escapeHtml(new Date(run.date).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }))}</p><p>${!compared ? 'Your first attempt. Take it again later to see your progress.' : !compared.shared ? 'No task was answered in both this and your previous attempt, so there is nothing like-for-like to compare.' : `On the ${compared.shared} ${compared.shared === 1 ? 'task' : 'tasks'} you answered both times: ${compared.before} → ${compared.now} (${compared.delta >= 0 ? '+' : ''}${compared.delta}).`} Reference prompts average ${learningData.referenceTotal}.</p></div></div>${run.tasks.map(t => { const task = tasks.find(x => x.id === t.id); return `<details class="benchmark-task"><summary><span>${escapeHtml(task.title)}</span><span>${t.prompt ? `${t.score}/100` : 'skipped'}</span></summary>${t.prompt ? `<blockquote>${escapeHtml(t.prompt)}</blockquote><ul class="rubric">${t.items.map(item => `<li class="${item.earned === item.points ? 'met' : 'missed'}"><span>${item.earned === item.points ? '✓' : '·'} ${escapeHtml(item.label)}</span><span>${item.earned}/${item.points}</span></li>`).join('')}</ul>${t.tips.length ? `<h3>TRY NEXT TIME</h3><ul>${list(t.tips)}</ul>` : ''}` : ''}<h3>REFERENCE PROMPT · ${task.referenceScore}/100</h3><blockquote>${escapeHtml(task.reference)}</blockquote></details>`; }).join('')}<div class="skillify-actions"><button type="button" class="primary compact" id="benchmark-again">Take it again</button><button type="button" class="secondary" id="benchmark-done">Back to the overview</button></div>`;
  $('benchmark-again').onclick = () => { bench = { index: 0, answers: {} }; renderBenchmarkStep(); };
  $('benchmark-done').onclick = renderBenchmarkIntro;
}
function renderRanked() {
  const r = learningData.ranked;
  $('ranked-tag').textContent = r.joined ? `OPT-IN · JOINED AS ${r.alias.toUpperCase()}` : 'OPT-IN · OFF';
  $('ranked-off').hidden = r.joined; $('ranked-on').hidden = !r.joined;
  if (!r.joined) return;
  const you = r.entries.find(e => e.you);
  const comparison = !you ? `Complete a benchmark attempt with all ${learningData.tasks.length} tasks answered to get your own card and ranking.`
    : r.participants < 2 ? 'Import teammates’ score cards to see where you stand. Until then, compare yourself with the reference prompts.'
      : `You rank ${you.rank} of ${r.participants}. Your ${you.total} vs the participants’ average of ${r.average} (${you.total - r.average >= 0 ? '+' : ''}${you.total - r.average}).`;
  $('ranked-on').innerHTML = `<p>${escapeHtml(comparison)}</p>
    <div class="skillify-actions"><button type="button" class="primary compact" id="ranked-export" ${r.hasCard ? '' : 'disabled'}><span data-icon="download"></span>Export my score card</button><button type="button" class="secondary" id="ranked-import">Import teammates’ cards</button></div>
    ${r.entries.length ? `<table class="ranked-table"><thead><tr><th>Rank</th><th>Name</th><th>Score</th><th>Attempt</th><th></th></tr></thead><tbody>${r.entries.map(e => `<tr class="${e.you ? 'you' : ''}"><td>${e.rank}</td><td>${escapeHtml(e.alias)}${e.you ? ' · you' : ''}</td><td>${e.total}/100</td><td>${escapeHtml(new Date(e.date).toLocaleDateString([], { dateStyle: 'medium' }))}</td><td>${e.you ? '' : `<button type="button" class="text-button" data-remove-card="${escapeHtml(e.alias)}" aria-label="Remove ${escapeHtml(e.alias)}">Remove</button>`}</td></tr>`).join('')}</tbody></table>` : ''}
    ${r.participants >= 2 && you ? `<details class="ranked-tasks"><summary>Task by task: you vs the participants’ average</summary><ul class="rubric">${learningData.tasks.map(t => `<li><span>${escapeHtml(t.title)}</span><span>${you.tasks[t.id]} vs ${r.taskAverages[t.id]}</span></li>`).join('')}</ul></details>` : ''}
    <p class="help">Honour system: without a shared server, Impromptu checks each card is internally consistent but cannot prove who produced it. Rankings compare benchmark briefs, not job performance.</p>
    <div class="ranked-leave"><label class="checkbox-label"><input type="checkbox" id="ranked-clear">Also remove the ${r.imported} imported ${r.imported === 1 ? 'card' : 'cards'}</label><button type="button" class="text-button delete" id="ranked-leave">Leave ranked mode</button></div>`;
  fillIcons($('ranked-on'));
  if (r.hasCard) $('ranked-export').onclick = () => attempt(async () => { if (await api.exportScorecard()) toast('Score card exported. Share the file with teammates who joined ranked mode.'); });
  $('ranked-import').onclick = () => attempt(async () => {
    const result = await api.importScorecards(); if (!result) return;
    learningData = result.state; renderRanked();
    toast(`${result.added} added, ${result.updated} updated.${result.skipped.length ? ` Skipped: ${result.skipped.slice(0, 2).join('; ')}` : ''}`, Boolean(result.skipped.length && !result.added && !result.updated));
  });
  document.querySelectorAll('[data-remove-card]').forEach(button => button.onclick = () => attempt(async () => { learningData = await api.removeRanked(button.dataset.removeCard); renderRanked(); }));
  $('ranked-leave').onclick = () => attempt(async () => {
    if (!window.confirm('Leave ranked mode? You can rejoin at any time.')) return;
    learningData = await api.leaveRanked({ clearBoard: $('ranked-clear').checked }); renderRanked(); toast('You left ranked mode.');
  });
}
function setupLearning() {
  $('ranked-join').onclick = () => attempt(async () => {
    if (!$('ranked-consent').checked) throw new Error('Tick the box to confirm what your score card shares.');
    learningData = await api.joinRanked({ alias: $('ranked-alias').value, consent: true }); renderRanked();
    toast(`Joined ranked mode as “${learningData.ranked.alias}”.`);
  });
  $('benchmark-answer').oninput = updateBenchmarkEstimate;
  $('benchmark-next').onclick = () => benchmarkMove(1);
  $('benchmark-back').onclick = () => benchmarkMove(-1);
  $('benchmark-skip').onclick = () => benchmarkMove(1, true);
  $('learning-erase').onclick = () => attempt(async () => {
    if (!window.confirm('Erase your learning progress, benchmark attempts and usage counts from this device? Saved sessions, chats and skills are not affected.')) return;
    learningData = await api.eraseLearning(); bench = null; renderLearning(); toast('Learning data erased.');
  });
}
let contextData = null, activePack = null;
const toolNames = { cursor: 'Cursor', 'claude-code': 'Claude Code', codex: 'Codex CLI' };
const sourceNames = { cursor: 'Cursor', claude: 'Claude', 'claude-code': 'Claude Code', chatgpt: 'ChatGPT', codex: 'Codex', copilot: 'Copilot', gemini: 'Gemini', other: 'AI session' };
const isPack = text => /^---[ \t]*\nformat:\s*impromptu-context-pack\/1/m.test(String(text));
async function openContext() { contextData = await attempt(() => api.contextState()); if (contextData) renderContext(); }
function renderContext() {
  const { packs, inbox, skills, prompt } = contextData;
  $('handoff-text').textContent = prompt;
  $('handoff-skills').innerHTML = skills.map(s => `<div class="perm-row"><span>${escapeHtml(toolNames[s.tool])} <small>${escapeHtml(s.path)}</small></span><strong class="${s.installed ? 'granted' : ''}">${s.installed ? 'Installed' : 'Not installed'}</strong><button type="button" class="text-button" data-skill-tool="${escapeHtml(s.tool)}" data-installed="${s.installed}">${s.installed ? 'Remove' : 'Install'}</button></div>`).join('');
  $('inbox-path').textContent = inbox.path;
  $('inbox-count').textContent = inbox.files.length ? `${inbox.files.length} WAITING` : 'INBOX EMPTY';
  $('inbox-badge').hidden = !inbox.files.length; $('inbox-badge').textContent = String(inbox.files.length);
  $('inbox-list').innerHTML = inbox.files.length ? inbox.files.map(f => `<div class="inbox-item"><span><strong>${escapeHtml(f.name)}</strong><small>${escapeHtml(new Date(f.modified).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }))} · ${Math.ceil(f.size / 1024)} KB</small></span><button type="button" class="secondary" data-inbox-file="${escapeHtml(f.name)}">Import</button></div>`).join('') : `<p class="help">${inbox.exists ? 'No new packs. Ask your agent tool to hand off a session, or paste one below.' : 'The inbox folder is created when you install a hand-off skill or open it.'}</p>`;
  $('pack-count').textContent = packs.length ? `${packs.length} on this device` : '';
  $('pack-list').innerHTML = packs.length ? packs.map(p => `<button type="button" class="pack-item ${activePack?.id === p.id ? 'active' : ''}" data-pack="${escapeHtml(p.id)}"><strong>${escapeHtml(p.title)}</strong><small>${escapeHtml(sourceNames[p.source] || 'AI session')}${p.model ? ` · ${escapeHtml(p.model)}` : ''} · ≈${p.stats.estimatedTokens.toLocaleString()} tokens</small></button>`).join('') : '<div class="empty-state skills-empty"><h2>No context packs yet.</h2><p>Create one with the hand-off skill or prompt, then import it here.</p></div>';
  document.querySelectorAll('[data-skill-tool]').forEach(button => button.onclick = () => attempt(async () => {
    const tool = button.dataset.skillTool, installed = button.dataset.installed === 'true';
    if (!installed && !window.confirm(`Install the Impromptu hand-off skill for ${toolNames[tool]}? This writes one SKILL.md file to ${skills.find(s => s.tool === tool).path}.`)) return;
    contextData = installed ? await api.removeHandoff(tool) : await api.installHandoff(tool); renderContext();
    toast(installed ? `Hand-off skill removed from ${toolNames[tool]}.` : `Installed for ${toolNames[tool]}. In a session, ask: “hand off this session to Impromptu”.`);
  }));
  document.querySelectorAll('[data-inbox-file]').forEach(button => button.onclick = () => attempt(async () => { const result = await api.importPackFile({ name: button.dataset.inboxFile, redactSecrets: $('pack-redact').checked }); afterImport(result); }));
  document.querySelectorAll('[data-pack]').forEach(button => button.onclick = () => attempt(async () => { activePack = await api.contextGet(button.dataset.pack); renderContext(); }));
  renderPack();
}
function afterImport(result) {
  contextData = result.state; activePack = result.pack; $('pack-paste').value = ''; renderContext();
  toast(`Imported “${result.pack.title}”.${result.pack.redacted.length ? ` Removed ${result.pack.redacted.length} likely ${result.pack.redacted.length === 1 ? 'secret' : 'secrets'}.` : ''}`);
}
function renderPack() {
  $('pack-review').hidden = !activePack;
  if (!activePack) return;
  const p = activePack;
  $('pack-title').textContent = p.title;
  $('pack-source').textContent = (sourceNames[p.source] || 'AI session').toUpperCase();
  $('pack-meta').textContent = [p.model, p.created ? `created ${new Date(p.created).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}` : '', `imported ${new Date(p.importedAt).toLocaleDateString()}`, `${p.stats.words.toLocaleString()} words · ≈${p.stats.estimatedTokens.toLocaleString()} tokens (estimate)`].filter(Boolean).join(' · ');
  const warnings = [];
  if (p.redacted.length) warnings.push(`Removed before saving: ${[...new Set(p.redacted)].join(', ')}.`);
  if (p.missing.length) warnings.push(`Missing sections: ${p.missing.join(', ')}.`);
  if (p.text.length > 28000) warnings.push('This pack is longer than chat and the Prompt workspace accept (about 28,000 characters). Edit it down, or ask the source model for a shorter hand-off.');
  $('pack-warnings').innerHTML = warnings.map(w => `<p class="pack-warning">${escapeHtml(w)}</p>`).join('');
  $('pack-text').value = p.text;
  for (const id of ['pack-context', 'pack-handback']) $(id).disabled = p.text.length > 28000;
  renderPackProviders();
}
let chatProviders = null;
async function renderPackProviders() {
  chatProviders = await api.chatProviders().catch(() => null);
  const select = $('pack-provider'), previous = select.value;
  if (!chatProviders) { select.innerHTML = '<option value="">Could not list providers</option>'; return; }
  const local = chatProviders.local.length ? chatProviders.local.map(p => `<option value="local:${escapeHtml(p.model)}">${escapeHtml(p.label)}</option>`).join('') : `<option value="" disabled>Local LLM · ${escapeHtml(chatProviders.localMessage || 'not available')}</option>`;
  const cloud = chatProviders.cloud.map(p => `<option value="cloud:${escapeHtml(p.mode)}" ${p.available ? '' : 'disabled'}>${escapeHtml(p.label)}${p.available ? '' : ` · ${escapeHtml(p.reason)}`}</option>`).join('');
  select.innerHTML = `<optgroup label="On this computer">${local}</optgroup><optgroup label="Cloud · your configured provider${chatProviders.localOnly ? ' (blocked by local-only mode)' : ''}">${cloud}</optgroup>`;
  const enabled = [...select.options].filter(o => !o.disabled && o.value);
  select.value = enabled.some(o => o.value === previous) ? previous : enabled[0]?.value || '';
  updateProviderNote();
}
function updateProviderNote() {
  const value = $('pack-provider').value;
  const cloud = chatProviders?.cloud.find(p => `cloud:${p.mode}` === value);
  $('pack-provider-note').textContent = !value ? 'Start Ollama, or set up a cloud provider in Settings, to talk with this pack.' : cloud ? `The pack text and your questions will be sent to ${cloud.label}. Check the pack contains nothing you cannot share.` : 'Runs on this computer. The pack and your questions never leave your device.';
  $('pack-provider-note').classList.toggle('warning', Boolean(cloud));
  $('pack-chat').disabled = !value || (activePack?.text.length || 0) > 28000;
}
const nextPrompt = pack => (pack.sections?.['Suggested next prompt'] || '').replace(/^\(.*\)$/m, '').trim();
function setupContext() {
  $('copy-handoff').onclick = () => attempt(async () => { await api.copy(contextData?.prompt || (await api.contextState()).prompt); toast('Hand-off prompt copied. Paste it into your AI chat.'); });
  $('open-inbox').onclick = () => attempt(async () => { contextData = await api.openInbox(); renderContext(); });
  $('pack-import').onclick = () => attempt(async () => { const text = $('pack-paste').value; if (!text.trim()) throw new Error('Paste a context pack first.'); afterImport(await api.importPackText({ text, redactSecrets: $('pack-redact').checked })); });
  $('pack-save').onclick = () => attempt(async () => { activePack = await api.updatePack({ id: activePack.id, text: $('pack-text').value }); contextData = await api.contextState(); renderContext(); toast('Pack updated.'); });
  $('pack-export').onclick = () => attempt(async () => { if (await api.exportPack(activePack.id)) toast('Pack exported.'); });
  $('pack-delete').onclick = () => attempt(async () => { if (!window.confirm('Delete this context pack from this device?')) return; contextData = await api.deletePack(activePack.id); activePack = null; renderContext(); toast('Pack deleted.'); });
  $('pack-provider').onchange = updateProviderNote;
  $('pack-chat').onclick = () => attempt(async () => {
    if (chatBusy) throw new Error('Wait for the current chat reply to finish.');
    const pack = activePack, choice = $('pack-provider').value;
    if (!choice) throw new Error('Choose where to talk with this pack.');
    if (choice.startsWith('cloud:')) {
      activeChat = await api.chatNew({ provider: 'cloud' });
      showView('chat');
    } else {
      activeChat = null; showView('chat');
      if (localAI?.status !== 'ready') await detectLocalAI();
      renderChatModels();
      $('chat-model').value = choice.slice('local:'.length);
      if (!$('chat-model').value) throw new Error('That local model is no longer installed. Choose another one.');
    }
    const from = pack.source === 'other' ? 'an AI session' : `a ${sourceNames[pack.source]} session`;
    const model = /^[\w.:/-]{2,60}$/.test(pack.model || '') ? ` with ${pack.model}` : '';
    $('chat-input').value = `Context pack: “${pack.title}”, from ${from}${model}. Treat it as reference material. Reply with a short summary of where the work stands and the open questions, then wait for my questions.\n\n${pack.text}`;
    sendChat();
  });
  $('pack-context').onclick = () => { if (busy) { toast('Wait for the current improvement to finish.'); return; } setInput({ prompt: $('prompt').value, context: activePack.text, skillId: $('skill').value }, `Context from “${activePack.title}”.`); $('context-details').open = true; $('prompt').focus(); };
  $('pack-handback').onclick = () => {
    if (busy) { toast('Wait for the current improvement to finish.'); return; }
    const pack = activePack;
    setInput({ prompt: nextPrompt(pack) || `Continue the work on “${pack.title}”. Pick up from the open questions and propose the next step.`, context: pack.text, skillId: 'tokenmining' }, `Hand-back for “${pack.title}”. Compress or improve it, then copy it into your AI tool.`);
    setAction('compress'); $('context-details').open = true;
    toast('Hand-back prompt ready with the Tokenmining skill. Choose Compress or Improve, then copy it back.');
  };
  api.onInboxChanged(() => { if (activeView === 'context') openContext(); else api.contextState().then(data => { contextData = data; $('inbox-badge').hidden = !data.inbox.files.length; $('inbox-badge').textContent = String(data.inbox.files.length); }).catch(() => {}); });
  api.contextState().then(data => { contextData = data; $('inbox-badge').hidden = !data.inbox.files.length; $('inbox-badge').textContent = String(data.inbox.files.length); }).catch(() => {});
}
let mascotInfo = null;
function renderMascotSettings(info) {
  mascotInfo = info;
  const on = info.settings.enabled, mac = info.platform === 'darwin';
  $('mascot-toggle').textContent = on ? 'Turn off the mascot' : 'Turn on the mascot…';
  $('mascot-options').hidden = !on;
  $('mascot-summary').textContent = on ? `On since ${new Date(info.settings.consentAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}. Click the mascot at the bottom-right of your screen to use it.` : 'A floating companion that, only when you click it, copies your selected text into Impromptu or reads what is visible on screen with a local model. It can also nudge you about breaks and prompt habits.';
  for (const [kind, label] of [['accessibility', 'perm-accessibility'], ['screen', 'perm-screen']]) {
    $(label).textContent = info.permissions[kind] ? 'Granted' : 'Not granted';
    $(label).classList.toggle('granted', info.permissions[kind]);
    $(`grant-${kind}`).hidden = info.permissions[kind] || !mac;
  }
  $('perm-help').hidden = !mac || (info.permissions.accessibility && info.permissions.screen);
  const select = $('mascot-model');
  select.innerHTML = info.models.length ? info.models.map(m => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('') : '<option value="">No local models found</option>';
  select.value = info.models.includes(info.settings.visionModel) ? info.settings.visionModel : info.vision?.model || info.models[0] || '';
  $('mascot-model-status').textContent = info.vision?.ok ? `${info.vision.model} can read images. Screenshots stay on this computer.` : info.vision?.message || '';
  $('mascot-nudges').checked = info.settings.nudges;
  $('mascot-break').value = String(info.settings.breakMinutes);
  $('mascot-frames').value = String(info.settings.scrollFrames);
}
async function refreshMascotSettings() { const info = await attempt(() => api.mascotSettings()); if (info) renderMascotSettings(info); }
function setupMascot() {
  $('mascot-toggle').onclick = () => attempt(async () => {
    if (mascotInfo?.settings.enabled) { renderMascotSettings(await api.disableMascot()); toast('Mascot turned off. It can no longer read your screen or selection.'); return; }
    $('mascot-consent-check').checked = false; $('mascot-consent').showModal();
  });
  $('mascot-consent-cancel').onclick = () => $('mascot-consent').close();
  $('mascot-consent-accept').onclick = () => attempt(async () => {
    if (!$('mascot-consent-check').checked) throw new Error('Tick the box to confirm, or choose Cancel.');
    renderMascotSettings(await api.enableMascot({ consent: true })); $('mascot-consent').close();
    toast('Mascot on. Grant the permissions below, then click the mascot at the bottom-right of your screen.');
  });
  $('grant-accessibility').onclick = () => attempt(async () => renderMascotSettings(await api.mascotPermission('accessibility')));
  $('grant-screen').onclick = () => attempt(async () => renderMascotSettings(await api.mascotPermission('screen')));
  const update = () => attempt(async () => renderMascotSettings(await api.updateMascot({ visionModel: $('mascot-model').value, nudges: $('mascot-nudges').checked, breakMinutes: Number($('mascot-break').value), scrollFrames: Number($('mascot-frames').value) })));
  for (const id of ['mascot-model', 'mascot-nudges', 'mascot-break', 'mascot-frames']) $(id).onchange = update;
  api.onMascotText(({ text, target }) => { if (target === 'knowledge') incomingKnowledge(text); else { incomingMode = 'workspace'; incoming(text); } });
  api.onMascotOpenChat(id => attempt(async () => { if (chatBusy) throw new Error('Wait for the current chat reply to finish.'); activeChat = await api.chatGet(id); showView('chat'); }));
  api.onMascotRoute(({ view, action }) => { showView(view); if (action === 'explain') { setAction('explain'); if ($('prompt').value.trim()) improve(); } });
}
function setupSkills() {
  $('skillify-generate').onclick = generateSkillDraft;
  $('skillify-manual').onclick = () => openSkillEditor({}, 'Write the approach you want the AI to follow every time.');
  $('skillify-use-draft').onclick = () => { const draft = $('prompt').value.trim(); if (!draft) { toast('The Prompt workspace draft is empty.'); return; } $('skillify-source').value = draft; $('skillify-source').focus(); };
  $('edit-skill-cancel').onclick = closeSkillEditor;
  $('skill-editor').onsubmit = event => { event.preventDefault(); attempt(async () => {
    const result = await api.saveSkill({ id: editingSkillId || undefined, name: $('edit-skill-name').value, category: $('edit-skill-category').value, description: $('edit-skill-description').value, instructions: $('edit-skill-instructions').value });
    closeSkillEditor(); $('skillify-source').value = ''; refreshSkills(result.skills);
    toast(`“${result.skill.name}” saved on this device. It is now in the Prompt workspace skill list.`);
  }); };
  $('skills-export').onclick = () => attempt(async () => { if (await api.exportSkills()) toast('Skills exported. Share the file with teammates to import.'); });
  $('skills-import').onclick = () => attempt(async () => {
    const result = await api.importSkills(); if (!result) return;
    refreshSkills(result.skills);
    toast(`${result.added} ${result.added === 1 ? 'skill' : 'skills'} imported.${result.skipped.length ? ` Skipped ${result.skipped.length}: ${result.skipped.slice(0, 2).join('; ')}` : ''}`, Boolean(result.skipped.length && !result.added));
  });
}
function renderHistory() {
  $('export-history').disabled = !state.history.length;
  if (!state.history.length) { $('history-list').innerHTML = '<div class="empty-state"><h2>Keep the prompts worth revisiting.</h2><p>Improve a prompt, then choose Save. Nothing is added to your history automatically.</p><button class="secondary" id="history-start">Back to the workspace ↗</button></div>'; $('history-start').onclick = () => showView('workspace'); return; }
  $('history-list').innerHTML = state.history.map(item => `<article class="history-item"><div class="meta">${escapeHtml(new Date(item.date).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }))} · ${escapeHtml(state.skills.find(s => s.id === item.input.skillId)?.name || 'Skill')} · ${item.action === 'compress' ? 'Compressed · ' : ''}${item.result.mode === 'offline' ? 'Offline' : 'AI-assisted'}</div><h2>${escapeHtml(item.input.prompt.slice(0, 220))}${item.input.prompt.length > 220 ? '…' : ''}</h2><div class="history-actions"><button class="secondary" data-reopen="${item.id}">Reopen ↗</button><button class="text-button" data-copy-saved="${item.id}">${icon('copy')}Copy</button><div class="feedback"><span>Useful?</span><button class="${item.feedback === 'helpful' ? 'selected' : ''}" data-rate="${item.id}" data-value="helpful">Yes</button><button class="${item.feedback === 'needs-work' ? 'selected' : ''}" data-rate="${item.id}" data-value="needs-work">Needs work</button></div><button class="text-button delete" data-delete="${item.id}">Delete</button></div></article>`).join('');
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
  $('local-only-setting').checked = Boolean(state.localOnly); applyLocalOnlyOptions();
  $('ollama-status').textContent = 'Checks Ollama on this computer for installed models.';
  $('shortcut-status').textContent = state.preview ? 'Keyboard shortcuts are available in the desktop app.' : state.shortcutRegistered ? `Global shortcut active: ${state.platform === 'darwin' ? '⌘⇧I' : 'Ctrl+Shift+I'}` : 'Shortcut unavailable: another app may have claimed it. Use the menu bar to open Impromptu.';
  $('shortcut-status').classList.toggle('warning', !state.shortcutRegistered && !state.preview);
  $('version').textContent = state.version;
  $('aws-profile').value = state.connection.profile || ''; $('aws-region').value = state.connection.region || '';
  modeFields(); $('settings-dialog').showModal(); refreshMascotSettings();
  if (state.connection.mode === 'ollama') detectSettingsModels();
}
function modeFields() {
  const mode = $('connection-mode').value;
  $('ollama-detect').hidden = mode !== 'ollama';
  if (mode === 'ollama') $('model').setAttribute('list', 'ollama-models'); else $('model').removeAttribute('list');
  $('model-fields').hidden = mode === 'offline'; $('api-key-field').hidden = mode === 'offline' || mode === 'ollama' || mode === 'bedrock';
  $('aws-fields').hidden = mode !== 'bedrock'; $('endpoint-field').hidden = mode === 'bedrock';
  $('test-connection').hidden = mode === 'offline';
  $('connection-test-status').hidden = mode === 'offline';
  $('endpoint').readOnly = ['openrouter', 'huggingface'].includes(mode);
  $('connection-test-status').textContent = mode === 'ollama' ? 'Sends a fictional sample prompt to Ollama on this computer. No quota or credits.' : 'Sends a fictional sample prompt, not your draft. Uses provider quota or credits.';
  $('provider-guide').textContent = { ollama: 'Start the Ollama app on this computer, then choose Detect installed models and pick one. Impromptu never downloads, deletes or updates models.', bedrock: 'Configure your company AWS SSO profile once using aws configure sso. Enter its name and AWS region, sign in, then enter your allowed Claude model ID or inference profile ID/ARN. Test requests and improvements are billed to that AWS account.', openrouter: '1. Create a key at openrouter.ai/settings/keys. 2. Paste it below. 3. Keep openrouter/free for free routing, or enter a model ID ending in :free. Free models have quotas; other models may charge credits.', huggingface: '1. Create a token at huggingface.co/settings/tokens with Inference Providers permission. 2. Paste it below. 3. Enter a supported chat model ID. Free accounts require purchased credits; eligible plans include an allowance.' }[mode] || 'Enter the full chat endpoint and an available model ID.';
  $('mode-explanation').textContent = { bedrock: 'Use Claude through your organisation’s Amazon Bedrock account. Authentication is managed by AWS SSO; no AWS secrets are stored in Impromptu.', offline: 'No credentials needed. Adds the selected reusable skill and your context. This mode does not call an AI model.', ollama: 'Connect a model already installed in Ollama on this computer. Model output is returned for your review.', openrouter: 'Real AI prompt improvement through OpenRouter. Your prompt is sent to OpenRouter and its selected inference provider.', huggingface: 'Real AI prompt improvement through Hugging Face Inference Providers. This is not an unlimited free service.', compatible: 'Connect an endpoint supporting the Chat Completions format. API access and billing are separate from chat subscriptions.' }[mode];
}

function knowledgeStatus(status = state.knowledge) {
  state.knowledge = status;
  $('knowledge-status').textContent = status?.connected ? 'Hyland knowledge connected' : 'Connect your Hyland knowledge';
  $('knowledge-connection-note').textContent = status?.connected ? 'Confluence + Jira · your Atlassian permissions · through Codex' : 'Uses your existing Atlassian sign-in in Codex. Access follows your account’s permissions.';
  $('knowledge-connect').textContent = status?.connected ? 'Connected ✓' : 'Connect via Codex';
  $('knowledge-connect').disabled = knowledgeBusy || status?.connected;
  if (state.localOnly) {
    $('knowledge-status').textContent = 'Local-only mode is on';
    $('knowledge-connection-note').textContent = 'Knowledge lookups contact Atlassian and the model in your Codex account, so they are turned off. Turn off local-only mode in Settings to use them.';
    $('knowledge-connect').textContent = 'Unavailable'; $('knowledge-connect').disabled = true;
  }
  $('knowledge-run').disabled = knowledgeBusy || Boolean(state.localOnly);
  if (typeof renderEvidence === 'function' && $('evidence-find')) renderEvidence();
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
  updateSkill(); updateConnection(); refreshSkills(state.skills); renderEvidence(); setupKnowledge(); setupChat(); setupSkills(); setupLearning(); setupMascot(); setupContext(); setupInstaller(); setupLocalAI(); showView('knowledge');
  $('ollama-refresh').onclick = detectSettingsModels;
  $('local-only-setting').onchange = applyLocalOnlyOptions;
  document.querySelectorAll('[data-view]').forEach(button => button.onclick = () => showView(button.dataset.view));
  document.querySelector('.brand').onclick = event => { event.preventDefault(); showView('workspace'); };
  inputIds.forEach(id => $(id).addEventListener('input', invalidate));
  $('skill').onchange = () => { updateSkill(); invalidate(); };
  document.querySelectorAll('[data-sample]').forEach(button => button.onclick = () => setInput(samples[button.dataset.sample], 'Sample draft · replace it with your own.'));
  $('paste-prompt').onclick = () => attempt(async () => incoming(await api.readClipboard()));
  $('use-incoming').onclick = () => { setInput({ prompt: pendingText, skillId: $('skill').value }, 'Brought from your clipboard.'); pendingText = ''; $('incoming-banner').hidden = true; };
  $('dismiss-incoming').onclick = () => { pendingText = ''; $('incoming-banner').hidden = true; };
  $('improve').onclick = improve;
  document.querySelectorAll('[data-action]').forEach(button => button.onclick = () => setAction(button.dataset.action));
  $('explain-copy').onclick = () => attempt(async () => {
    const e = current?.result?.explanation; if (!e) throw new Error('There is no explanation to copy.');
    const section = (title, items) => items.length ? `\n\n${title}\n${items.map(item => `- ${item}`).join('\n')}` : '';
    await api.copy(`${e.summary}${section('What works', e.strengths)}${section('Unclear or missing', e.gaps)}${section('Tokenmining tips', e.tips)}`);
    toast('Explanation copied.');
  });
  $('explain-improve').onclick = () => {
    const e = current?.result?.explanation; if (!e || busy) return;
    const notes = [...e.gaps, ...e.tips].map(item => `- ${item}`).join('\n');
    $('context').value = [$('context').value.trim(), `Suggestions to apply:\n${notes}`].filter(Boolean).join('\n\n');
    $('context-details').open = true;
    setAction('improve'); improve();
  };
  $('new-draft').onclick = () => { setInput({}); $('prompt').focus(); };
  $('result-text').oninput = () => { if (current) { current.result.improved = $('result-text').value; savedId = null; $('save-result').innerHTML = `${icon('bookmark')}Save`; } };
  $('copy-result').onclick = () => attempt(async () => { const value = $('result-text').value; if (!value.trim()) throw new Error('The improved prompt is empty.'); await api.copy(withSources(value, current?.result)); toast(current?.result?.evidence?.length ? `Copied with ${current.result.evidence.length} Hyland ${current.result.evidence.length === 1 ? 'source' : 'sources'}. Paste it into your AI tool.` : 'Copied. Switch back to your AI tool and paste.'); });
  $('evidence-find').onclick = findEvidence;
  $('evidence-query').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); findEvidence(); } });
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
    modeFields();
    if (mode === 'ollama') detectSettingsModels();
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
      const result = await api.testConnection({ mode: $('connection-mode').value, endpoint: $('endpoint').value, model: $('model').value, region: $('aws-region').value.trim(), profile: $('aws-profile').value.trim(), apiKey: $('api-key').value, clearKey: $('clear-key').checked, localOnly: $('local-only-setting').checked });
      $('connection-test-status').textContent = result.message;
    } catch (error) { $('connection-test-status').textContent = error.message.replace(/^Error invoking remote method '[^']+': Error: /, ''); }
    finally { button.disabled = false; }
  };
  $('settings-form').onsubmit = event => { event.preventDefault(); attempt(async () => { if (busy) throw new Error('Wait for the current request to finish before changing connection.'); state = await api.saveSettings({ mode: $('connection-mode').value, endpoint: $('endpoint').value, model: $('model').value, region: $('aws-region').value.trim(), profile: $('aws-profile').value.trim(), apiKey: $('api-key').value, clearKey: $('clear-key').checked, importClipboard: $('clipboard-setting').checked, localOnly: $('local-only-setting').checked }); $('api-key').value = ''; setupHidden = false; if (state.connection.mode === 'ollama') detectLocalAI(); else renderSetup(); updateConnection(); knowledgeStatus(); $('settings-dialog').close(); toast('Settings saved.'); }); };
  $('hide-window').onclick = () => api.hide();
  document.addEventListener('keydown', event => { const modal = $('settings-dialog').open || $('knowledge-settings').open || $('mascot-consent').open || $('local-ai-dialog').open; if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !modal) { if (activeView === 'workspace') { event.preventDefault(); improve(); } if (activeView === 'knowledge') { event.preventDefault(); lookupKnowledge(); } if (activeView === 'chat') { event.preventDefault(); sendChat(); } } if (event.key === 'Escape' && !modal) api.hide(); });
  api.onInvoke(text => { if (isPack(text)) { showView('context'); $('pack-paste').value = text; toast('A context pack was brought in. Review it, then choose Import.'); return; } incoming(text); });
  api.onNotice(message => toast(message, true));
  api.onSettings(data => { state = data; renderAppearance(); updateConnection(); renderSetup(); knowledgeStatus(); });
  api.onAppearance(renderAppearance);
}
boot().catch(error => toast(error.message, true));
