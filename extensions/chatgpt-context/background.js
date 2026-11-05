'use strict';
// Keep pairing credentials out of the content-script and page execution contexts.
const trustedStorage = chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());
function sameConversation(left, right) {
  try {
    const a = new URL(left), b = new URL(right);
    return a.origin === 'https://chatgpt.com' && b.origin === a.origin && a.pathname === b.pathname;
  } catch { return false; }
}
async function post(settings, path, payload) {
  const response = await fetch(`http://127.0.0.1:${settings.port}/${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.token}` },
    body: JSON.stringify(payload), credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error(response.status === 401 ? 'Pair again with the code from the desktop app.' : `Desktop bridge rejected this request (${response.status}).`);
  return response.json();
}
async function handle(message, sender) {
  await trustedStorage;
  const options = sender.id === chrome.runtime.id && sender.url === chrome.runtime.getURL('options.html');
  if (options && message.type === 'pair') {
    const match = /^impromptu:(\d{1,5}):([a-f0-9]{64})$/.exec(String(message.code || '').trim());
    if (!match || Number(match[1]) < 1 || Number(match[1]) > 65535) throw new Error('Paste the pairing code from InPromptU.');
    const settings = { port: Number(match[1]), token: match[2], enabled: true };
    await post(settings, 'ping', {});
    await chrome.storage.local.set({ settings, status: 'Paired. Open a saved ChatGPT conversation to begin.' });
    return { ok: true };
  }
  if (options && message.type === 'disconnect') {
    await chrome.storage.local.remove('settings');
    await chrome.storage.local.set({ status: 'Sharing is off. Disconnect in the desktop app to forget collected messages.' });
    return { ok: true };
  }
  if (options && message.type === 'status') {
    const { settings, status } = await chrome.storage.local.get(['settings', 'status']);
    return { enabled: settings?.enabled === true, status: status || 'Not paired.' };
  }
  if (!sender.tab || sender.frameId !== 0 || !sameConversation(sender.url, sender.tab.url)) throw new Error('Untrusted sender.');
  const { settings } = await chrome.storage.local.get('settings');
  if (message.type === 'enabled') return { enabled: settings?.enabled === true };
  if (message.type !== 'snapshot' || !settings?.enabled || !sameConversation(sender.url, message.payload?.url)) throw new Error('Sharing is off or the conversation changed.');
  if (JSON.stringify(message.payload).length > 450000) throw new Error('Conversation is too large.');
  try {
    await post(settings, 'context', message.payload);
    await chrome.storage.local.set({ status: `Last shared loaded messages at ${new Date().toLocaleTimeString()}.` });
    return { ok: true };
  } catch (error) {
    await chrome.storage.local.set({ status: error.message }); throw error;
  }
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  handle(message, sender).then(respond, error => respond({ error: error.message }));
  return true;
});
