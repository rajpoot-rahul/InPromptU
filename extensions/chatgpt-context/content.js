'use strict';
(() => {
  let lastPath = '', lastSnapshot = '', lastSent = 0, busy = false;
  async function collect() {
    if (busy) return;
    busy = true;
    try {
      const url = location.origin + location.pathname;
      if (lastPath !== url) { lastPath = url; lastSnapshot = ''; return; }
      if (!/^\/(?:g\/[a-zA-Z0-9_-]+\/)?c\/[a-zA-Z0-9_-]+\/?$/.test(location.pathname)) return;
      if (!(await chrome.runtime.sendMessage({ type: 'enabled' }))?.enabled) return;
      const nodes = [...document.querySelectorAll('[data-message-author-role="user"], [data-message-author-role="assistant"]')];
      let remaining = 12000;
      const messages = [];
      for (const node of nodes.slice(-40).reverse()) {
        const text = (node.innerText || '').trim().slice(-remaining);
        if (!text) continue;
        messages.unshift({ role: node.getAttribute('data-message-author-role'), text });
        remaining -= text.length;
        if (remaining <= 0) break;
      }
      if (!messages.length || location.origin + location.pathname !== url) return;
      const payload = { url, title: document.title.slice(0, 160), messages };
      const snapshot = JSON.stringify(payload);
      if (snapshot === lastSnapshot && Date.now() - lastSent < 60000) return;
      const response = await chrome.runtime.sendMessage({ type: 'snapshot', payload });
      if (response?.ok) { lastSnapshot = snapshot; lastSent = Date.now(); }
    } catch { /* Extension options show connection errors; never log conversation content. */ }
    finally { busy = false; }
  }
  setInterval(collect, 4000);
  void collect();
})();
