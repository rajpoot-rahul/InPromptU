'use strict';
// Shared by the renderer (classic script, window.ImpromptuSetup) and the main process / tests (CommonJS).
(function (root, factory) {
  const flow = factory();
  if (typeof module === 'object' && module.exports) module.exports = flow;
  else root.ImpromptuSetup = flow;
})(typeof window !== 'undefined' ? window : globalThis, () => {
  const OPENROUTER = Object.freeze({ endpoint: 'https://openrouter.ai/api/v1/chat/completions', model: 'openrouter/free' });
  const LOCAL_ENDPOINT = 'http://localhost:11434/api/chat';
  const CLOUD_ORDER = Object.freeze(['openrouter', 'bedrock', 'huggingface', 'compatible']);
  const MODE_ORDER = Object.freeze(['openrouter', 'bedrock', 'huggingface', 'ollama', 'compatible', 'offline']);
  const rank = (order, mode) => { const index = order.indexOf(mode); return index === -1 ? order.length : index; };
  const sortByMode = (items, order = CLOUD_ORDER, key = item => item.mode) => [...items].sort((a, b) => rank(order, key(a)) - rank(order, key(b)));

  // Local AI is a Phase 2 preview: every user-facing description of the local runtime comes from here,
  // and stays calm and product-neutral whether the runtime is missing, stopped or unreadable.
  const LOCAL_UNAVAILABLE = 'Local AI (Phase 2 preview) isn\'t set up on this computer.';
  const LOCAL_PHASE2 = 'Local AI is a Phase 2 preview. Set it up when it\'s available for your team.';
  const SCREEN_PHASE2 = 'Screen reading arrives with Phase 2 local AI.';
  function localMessage(status, { count = 0 } = {}) {
    if (status === 'ready') return `Local AI is ready with ${count} installed ${count === 1 ? 'model' : 'models'}.`;
    if (status === 'no-models') return 'Local AI is set up, but no models are installed yet.';
    return LOCAL_UNAVAILABLE;
  }

  // What the top of the Prompt workspace shows: the OpenRouter first-run card, its local-only variant, or nothing.
  // Local AI never raises a card here; its state is shown only in the Local AI tab.
  function workspaceCard({ mode, dismissed = false, hidden = false, preview = false, completed = false, localOnly = false } = {}) {
    if (preview) return null;
    if (completed) return 'first-run-done';
    if (mode !== 'offline' || dismissed || hidden) return null;
    return localOnly ? 'first-run-local-only' : 'first-run';
  }

  function localNeedsAttention(mode, model, localAI) {
    if (mode !== 'ollama' || !localAI) return false;
    return localAI.status !== 'ready' || !localAI.models.some(m => m.name === model);
  }

  function runtimeStatus(localAI, checking = false) {
    if (checking || !localAI) return 'checking';
    return ['ready', 'no-models'].includes(localAI.status) ? localAI.status : 'not-set-up';
  }

  return { OPENROUTER, LOCAL_ENDPOINT, CLOUD_ORDER, MODE_ORDER, LOCAL_UNAVAILABLE, LOCAL_PHASE2, SCREEN_PHASE2, sortByMode, localMessage, workspaceCard, localNeedsAttention, runtimeStatus };
});
