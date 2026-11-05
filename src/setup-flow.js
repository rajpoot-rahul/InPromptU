'use strict';
// Shared by the renderer (classic script, window.ImpromptuSetup) and the main process / tests (CommonJS).
(function (root, factory) {
  const flow = factory();
  if (typeof module === 'object' && module.exports) module.exports = flow;
  else root.ImpromptuSetup = flow;
})(typeof window !== 'undefined' ? window : globalThis, () => {
  const OPENROUTER = Object.freeze({ endpoint: 'https://openrouter.ai/api/v1/chat/completions', model: 'openrouter/free' });
  const CLOUD_ORDER = Object.freeze(['openrouter', 'bedrock', 'huggingface', 'compatible']);
  const MODE_ORDER = Object.freeze(['openrouter', 'bedrock', 'huggingface', 'ollama', 'compatible', 'offline']);
  const rank = (order, mode) => { const index = order.indexOf(mode); return index === -1 ? order.length : index; };
  const sortByMode = (items, order = CLOUD_ORDER, key = item => item.mode) => [...items].sort((a, b) => rank(order, key(a)) - rank(order, key(b)));

  // What the top of the Prompt workspace shows: the OpenRouter first-run card, its local-only variant,
  // a pointer to the Local AI tab when the configured local model needs attention, or nothing.
  function workspaceCard({ mode, dismissed = false, hidden = false, preview = false, completed = false, localOnly = false, localNeedsAttention = false } = {}) {
    if (preview) return null;
    if (completed) return 'first-run-done';
    if (mode === 'ollama') return localNeedsAttention && !hidden ? 'local-attention' : null;
    if (mode !== 'offline' || dismissed || hidden) return null;
    return localOnly ? 'first-run-local-only' : 'first-run';
  }

  function localNeedsAttention(mode, model, localAI) {
    if (mode !== 'ollama' || !localAI) return false;
    return localAI.status !== 'ready' || !localAI.models.some(m => m.name === model);
  }

  function runtimeStatus(localAI, checking = false) {
    if (checking || !localAI) return 'checking';
    return ['ready', 'no-models', 'not-running', 'error'].includes(localAI.status) ? localAI.status : 'error';
  }

  return { OPENROUTER, CLOUD_ORDER, MODE_ORDER, sortByMode, workspaceCard, localNeedsAttention, runtimeStatus };
});
