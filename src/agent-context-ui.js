'use strict';
(() => {
  const api = window.impromptu;
  const el = id => document.getElementById(id);
  let sources, revision = 0, timer, loading = false;
  window.agentContextUI = { request: () => ({ agentContext: el('agent-context-use').checked, agentTarget: el('agent-context-target').value }) };
  async function preview() {
    const version = ++revision;
    const result = await api.previewAgentContext({ prompt: el('prompt').value, target: el('agent-context-target').value });
    if (version !== revision) return;
    el('agent-context-match').textContent = `${result.reason}${result.entry ? ` ${result.entry.title} · ${new Date(result.entry.updatedAt).toLocaleString()}` : ''}`;
    el('agent-context-preview').textContent = result.entry ? `${result.entry.scope}\n\n${result.entry.text}` : 'No conversation selected.';
  }
  async function refresh() {
    sources = await api.agentContextState();
    const select = el('agent-context-target'), selected = select.value;
    select.replaceChildren(new Option('Automatically match my prompt', 'auto'));
    for (const entry of sources.entries) select.add(new Option(`${entry.source === 'codex' ? 'Codex' : 'ChatGPT'} · ${entry.title}`, entry.id));
    if ([...select.options].some(option => option.value === selected)) select.value = selected;
    else if (selected !== 'auto') { select.add(new Option('Selected conversation is unavailable — choose another', selected)); select.value = selected; }
    const codex = sources.codex;
    el('agent-context-count').textContent = `${sources.entries.length} conversations available`;
    el('agent-codex-connect').textContent = codex.enabled ? 'Disconnect & forget Codex' : 'Connect Codex history';
    el('agent-codex-refresh').disabled = !codex.enabled || codex.syncing;
    el('agent-browser-connect').textContent = sources.browser.enabled ? 'Disconnect & forget ChatGPT' : 'Enable ChatGPT bridge';
    el('agent-browser-pair').hidden = !sources.browser.enabled;
    el('agent-source-status').textContent = [
      codex.enabled ? `Codex: ${codex.syncing ? 'syncing…' : codex.error || `last checked ${codex.lastSync ? new Date(codex.lastSync).toLocaleTimeString() : 'not yet'}`}. Up to 80 recent unarchived tasks, including saved subagents; 8 recent turns per task, polled every 30 seconds.` : 'Codex collection is off.',
      codex.capped ? 'More Codex tasks exist beyond this window.' : '',
      codex.failed ? `${codex.failed} tasks could not be read.` : '',
      sources.browser.enabled ? 'ChatGPT bridge is waiting for or receiving paired browser conversations.' : 'ChatGPT collection is off.'
    ].filter(Boolean).join(' ');
    await preview();
  }
  async function action(button, operation) {
    if (loading) return;
    loading = true; button.disabled = true;
    try { await operation(); await refresh(); }
    catch (error) { el('agent-source-status').textContent = error.message; }
    finally { button.disabled = false; loading = false; }
  }
  el('agent-codex-connect').onclick = event => action(event.currentTarget, () => sources?.codex.enabled ? api.disconnectAgentContext() : api.connectAgentContext());
  el('agent-codex-refresh').onclick = event => action(event.currentTarget, () => api.refreshAgentContext());
  el('agent-codex-locate').onclick = event => action(event.currentTarget, () => api.locateCodex());
  el('agent-browser-connect').onclick = event => action(event.currentTarget, () => api.browserAgentContext(!sources?.browser.enabled));
  el('agent-browser-pair').onclick = event => action(event.currentTarget, async () => { await api.copyContextPairing(); });
  el('agent-browser-extension').onclick = event => action(event.currentTarget, async () => {
    const folder = await api.openContextExtension();
    el('agent-extension-folder').textContent = `In Chrome or Edge, choose Load unpacked and select: ${folder}`;
    el('agent-extension-folder').hidden = false;
  });
  el('agent-context-target').onchange = () => preview().catch(() => {});
  el('prompt').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => preview().catch(() => {}), 350); });
  api.onAgentContext(() => refresh().catch(() => {}));
  refresh().catch(error => { el('agent-source-status').textContent = error.message; });
})();
