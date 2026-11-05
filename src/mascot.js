'use strict';
const api = window.mascot;
const $ = id => document.getElementById(id);
let open = false, info = null;

function setOpen(value) {
  open = value;
  $('panel').hidden = !value;
  $('face').setAttribute('aria-expanded', String(value));
  $('face').setAttribute('aria-label', value ? 'Close the Impromptu mascot' : 'Open the Impromptu mascot');
  api.expand(value);
}
function bubble(message, tone = '', actions = [], detail = '') {
  $('bubble').hidden = !message;
  $('bubble').className = `bubble ${tone}`;
  $('bubble-text').textContent = message || '';
  $('bubble-detail').hidden = !detail; $('bubble-detail').textContent = detail || '';
  $('bubble-actions').replaceChildren(...actions.map(action => {
    const button = document.createElement('button');
    button.type = 'button'; button.textContent = action.label;
    button.onclick = () => { if (action.name === 'dismiss') bubble(''); else run(action.name, action.payload); };
    return button;
  }));
}
function render(state) {
  info = state;
  $('root').dataset.state = state.busy ? 'busy' : state.nudge ? 'nudge' : 'idle';
  $('dot').hidden = !(state.capturing || state.nudge);
  $('status').textContent = state.busy || 'Ready';
  const screenReady = state.vision.ok && state.permissions.screen;
  for (const name of ['explain-screen', 'read-page']) document.querySelector(`[data-action="${name}"]`).disabled = Boolean(state.busy) || !screenReady;
  for (const name of ['selection-workspace', 'selection-knowledge']) document.querySelector(`[data-action="${name}"]`).disabled = Boolean(state.busy) || !state.permissions.accessibility;
  $('ask').disabled = Boolean(state.busy) || !screenReady;
  $('read-page').textContent = `Read this page (scrolls up to ${state.scrollFrames} ${state.scrollFrames === 1 ? 'screen' : 'screens'})`;
  const missing = [!state.permissions.accessibility && 'Accessibility', state.vision.ok && !state.permissions.screen && 'Screen Recording'].filter(Boolean);
  $('privacy').textContent = [!state.vision.ok && state.vision.message, missing.length && `Grant ${missing.join(' and ')} in Impromptu Settings → Mascot to use ${state.vision.ok ? 'every action' : 'the selection actions'}.`].filter(Boolean).join(' ')
    || 'Screen reading runs only when you click, and only on this computer. Nothing is recorded in the background.';
  if (state.capturing) bubble('Reading your screen now. Impromptu captures only what is visible, and only for this request.', 'capturing');
  else if (state.busy) bubble(state.busy);
  else if (state.message) bubble(state.message.text, state.message.tone || '', state.message.actions || [{ name: 'dismiss', label: 'OK' }], state.message.detail || '');
  else if (state.nudge) bubble(state.nudge.message, state.nudge.kind === 'verify' ? 'warning' : '', [...(state.nudge.actions || []).map(label => ({ name: 'nudge-action', label, payload: { kind: state.nudge.kind, label } })), { name: 'nudge-dismiss', label: 'Dismiss' }]);
  else bubble('');
  if ((state.nudge || state.message) && !open) setOpen(true);
}
async function run(name, payload) {
  try { render(await api.action(name, payload)); }
  catch (error) { bubble(String(error.message).replace(/^Error invoking remote method '[^']+': Error: /, ''), 'warning', [{ name: 'dismiss', label: 'OK' }]); }
}
$('ask').addEventListener('pointerdown', () => api.typing(true));
$('ask').addEventListener('blur', () => api.typing(false));
$('face').onclick = () => setOpen(!open);
$('close').onclick = () => setOpen(false);
document.querySelectorAll('[data-action]').forEach(button => button.onclick = () => run(button.dataset.action));
$('ask-form').onsubmit = event => { event.preventDefault(); const question = $('ask').value.trim(); if (!question) return; $('ask').value = ''; $('ask').blur(); api.typing(false); run('ask-screen', { question }); };
document.addEventListener('keydown', event => { if (event.key === 'Escape' && open) setOpen(false); });
api.onUpdate(render);
api.state().then(render);
