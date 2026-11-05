'use strict';
const status = document.getElementById('status');
async function refresh() {
  const result = await chrome.runtime.sendMessage({ type: 'status' });
  status.textContent = result.error || result.status;
  document.getElementById('disconnect').disabled = !result.enabled;
}
document.getElementById('pair-form').onsubmit = async event => {
  event.preventDefault();
  const button = event.submitter; button.disabled = true;
  status.textContent = 'Connecting to the local desktop app…';
  try {
    const response = await chrome.runtime.sendMessage({ type: 'pair', code: document.getElementById('code').value });
    if (response.error) { status.textContent = response.error; return; }
    document.getElementById('code').value = ''; await refresh();
  } catch { status.textContent = 'Could not connect. Open InPromptU, enable its ChatGPT bridge, and copy a new code.'; }
  finally { button.disabled = false; }
};
document.getElementById('disconnect').onclick = async () => { await chrome.runtime.sendMessage({ type: 'disconnect' }); await refresh(); };
void refresh();
