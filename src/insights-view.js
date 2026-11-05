'use strict';
// My progress: insights from the local prompt log. Loaded after renderer.js and uses its helpers.
let insightsData = null, coachBusy = false, coachResult = null;
const modeNames = { offline: 'Offline template', ollama: 'Local model', compatible: 'Custom API', openrouter: 'OpenRouter', huggingface: 'Hugging Face', bedrock: 'Amazon Bedrock' };
const skillName = id => state.skills.find(s => s.id === id)?.name || 'Removed skill';
const shortDate = value => new Date(value).toLocaleDateString([], { month: 'short', day: 'numeric' });
const band = score => score >= 75 ? 'Specific' : score >= 50 ? 'Getting there' : 'Often vague';
const signed = n => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(n)}`;

async function renderProgress() {
  const data = await attempt(() => api.insightsState());
  if (!data) return;
  insightsData = data; renderInsights();
}

function sparkline(weeks) {
  const width = 260, height = 64, pad = 7, step = (width - pad * 2) / (weeks.length - 1);
  const x = i => +(pad + i * step).toFixed(1), y = v => +(pad + (height - pad * 2) * (1 - v / 100)).toFixed(1);
  const runs = []; let run = [];
  weeks.forEach((w, i) => { if (w.average === null) { if (run.length) runs.push(run); run = []; } else run.push([x(i), y(w.average)]); });
  if (run.length) runs.push(run);
  const label = weeks.map((w, i) => `${i === weeks.length - 1 ? 'this week' : `${weeks.length - 1 - i} weeks ago`}: ${w.average === null ? 'no prompts' : w.average}`).join(', ');
  return `<svg class="ins-spark" viewBox="0 0 ${width} ${height}" role="img" aria-label="Weekly average Prompt Specificity. ${escapeHtml(label)}"><line class="ins-spark-guide" x1="${pad}" x2="${width - pad}" y1="${y(50)}" y2="${y(50)}"></line><line class="ins-spark-guide" x1="${pad}" x2="${width - pad}" y1="${y(75)}" y2="${y(75)}"></line>${runs.map(points => points.length > 1 ? `<polyline points="${points.map(p => p.join(',')).join(' ')}"></polyline>` : '').join('')}${runs.flat().map(([cx, cy]) => `<circle cx="${cx}" cy="${cy}" r="2.6"></circle>`).join('')}</svg><div class="ins-spark-axis"><span>${weeks.length - 1} weeks ago</span><span>This week</span></div>`;
}

function headlinePanel(s) {
  const sp = s.specificity;
  const trend = sp.delta === null ? (sp.earlier === null ? 'All your prompts are from the last 7 days, so there is no trend yet.' : 'No prompts in the last 7 days.') : `Last 7 days: <strong>${sp.recent}</strong> (${signed(sp.delta)} vs before, over ${sp.recentCount} ${sp.recentCount === 1 ? 'prompt' : 'prompts'}).`;
  return `<section class="progress-panel ins-score"><div class="eyebrow">PROMPT SPECIFICITY</div><div class="ins-score-row"><strong>${sp.average}<small>/100</small></strong><div><span class="ins-band">${band(sp.average)}</span><p>Average over your ${s.total} ${s.total === 1 ? 'prompt' : 'prompts'} since ${escapeHtml(shortDate(s.firstAt))}. ${trend}</p></div></div>${sparkline(sp.weeks)}<p class="ins-parts">Signals ${sp.parts.signals}/60 · Concrete details ${sp.parts.details}/25 · Length ${sp.parts.length}/15</p><details class="ins-formula"><summary>How this score works</summary><ul>${s.formula.map(line => `<li>${escapeHtml(line)}</li>`).join('')}</ul><p>It checks the text you wrote, not the answer you got, and cannot see earlier conversation. Use it as a mirror, not a grade.</p></details></section>`;
}

function coveragePanel(s) {
  return `<section class="progress-panel ins-coverage"><h2>What your prompts include</h2><p>Share of your prompts where each signal was found, including any context you added. Arrows compare the last 7 days with before.</p>${s.coverage.map(c => {
    const delta = c.recentPct !== null && c.earlierPct !== null ? c.recentPct - c.earlierPct : null;
    const arrow = delta === null ? '' : `<span class="ins-delta ${delta > 0 ? 'up' : delta < 0 ? 'down' : ''}" title="Last 7 days ${c.recentPct}% vs before ${c.earlierPct}%">${delta > 0 ? '↑' : delta < 0 ? '↓' : '→'}${Math.abs(delta)}</span>`;
    return `<div class="bar-row"><span>${escapeHtml(c.label)}</span><progress value="${c.pct}" max="100" aria-label="${escapeHtml(c.label)}: ${c.pct}% of prompts"></progress><span>${c.pct}% ${arrow}</span></div>`;
  }).join('')}</section>`;
}

function areaCard(w) {
  const examples = w.examples.map(e => `<figure class="ins-example"><figcaption>Your prompt · ${escapeHtml(shortDate(e.at))} · Specificity ${e.score}</figcaption><blockquote>${escapeHtml(e.excerpt)} <ins class="ins-add" title="Suggested addition">＋ ${escapeHtml(e.addition)}</ins></blockquote><div class="ins-missing"><span>Missing:</span>${e.missing.map(m => `<span class="ins-chip">${escapeHtml(m)}</span>`).join('')}</div><button type="button" class="secondary" data-ins-try="${escapeHtml(w.id)}" data-example="${escapeHtml(e.id)}">Try it ↗</button></figure>`).join('');
  const actions = w.actions.filter(a => a.kind !== 'explain').map(a => a.kind === 'learn' ? `<button type="button" class="text-button" data-ins-learn="${escapeHtml(a.milestone)}">${escapeHtml(a.label)} ↗</button>` : `<button type="button" class="text-button" data-ins-skill="${escapeHtml(a.skillId)}">${escapeHtml(a.label)} ↗</button>`).join('');
  return `<article class="ins-area"><header><h3>${escapeHtml(w.title)}</h3><span class="ins-gap">${w.count} of your last ${w.of} prompts</span></header><p class="ins-why">${escapeHtml(w.why)}</p>${examples}<div class="ins-learn"><strong>Learn</strong><div class="ins-actions">${actions}</div><ul class="readings">${w.readings.map(r => `<li><button type="button" class="text-button" data-ins-reading="${escapeHtml(r.url)}">${escapeHtml(r.title)} · ${escapeHtml(r.source)} ↗</button></li>`).join('')}</ul></div></article>`;
}

function areasPanel(s) {
  const body = s.weaknesses.length ? `<div class="ins-areas">${s.weaknesses.map(areaCard).join('')}</div>` : `<p class="ins-none">No clear weak spot in your recent prompts: each signal shows up in at least 70% of them. Keep an eye on the coverage bars, and try the Learner track benchmark for a harder test.</p>`;
  return `<section class="ins-section"><h2 class="ins-heading">Your areas to improve</h2><p class="help">Ranked by how often each is missing in your most recent prompts. Examples are your own prompts, with a suggested addition.</p>${body}</section>`;
}

function habitsPanel(s) {
  const h = s.habits, dup = h.duplicates;
  const stat = (value, label, note = '') => `<div class="stat"><strong>${value}</strong><span>${label}</span>${note ? `<small>${note}</small>` : ''}</div>`;
  const list = items => items.slice(0, 3).map(i => `${escapeHtml(i.name)} ${i.count}×`).join(' · ');
  return `<section class="ins-section"><h2 class="ins-heading">Your habits</h2><div class="stat-grid ins-habits">${[
    stat(s.total, 'Prompts analysed', `On ${h.activeDays} ${h.activeDays === 1 ? 'day' : 'days'} · latest ${escapeHtml(shortDate(s.lastAt))}`),
    stat(`${h.avgWords}<small> words</small>`, 'Average prompt length', `≈${h.avgTokens} tokens (estimate) · median ${h.medianWords} words`),
    stat(`${h.withContextPct}<small>%</small>`, 'Added separate context', 'Background in the context box keeps the ask clear'),
    stat(`${h.actions.improve} · ${h.actions.compress} · ${h.actions.explain}`, 'Improve · Compress · Explain', h.actions.explain ? '' : 'Explain shows what a prompt is missing'),
    stat(h.compress.count ? `${h.compress.avgSavingsPct}<small>%</small>` : '—', 'Average Compress saving', h.compress.count ? `≈${h.compress.tokensSaved.toLocaleString()} tokens saved over ${h.compress.count} ${h.compress.count === 1 ? 'use' : 'uses'}` : 'Not used yet: try it on a long prompt'),
    stat(dup.groups ? dup.groups : '0', 'Repeated prompts', dup.top ? `“${escapeHtml(dup.top.excerpt)}” ${dup.top.count}× · <button type="button" class="text-button" id="ins-skillify">Make it a skill ↗</button>` : 'No near-duplicates found')
  ].join('')}</div><p class="ins-meta">Skills: ${list(h.skills.map(i => ({ name: skillName(i.id), count: i.count })))} &nbsp;·&nbsp; Providers: ${list(h.providers.map(i => ({ name: modeNames[i.id] || i.id, count: i.count })))}</p></section>`;
}

function coachPanel() {
  const { canCoach, localConnection } = insightsData;
  const where = !canCoach ? 'It needs an AI model; set one up in Settings. Everything else on this page works without one.' : localConnection ? 'It runs on your local model, on this computer.' : `It sends the data to your configured cloud provider, ${escapeHtml(modeNames[state.connection.mode] || 'Custom API')}.`;
  const r = coachResult;
  const result = r ? `<div class="ins-coach-result"><span class="small-tag">AI-GENERATED</span><p>${escapeHtml(r.summary)}</p>${r.focus.length ? `<h3>FOCUS ON</h3><ul>${r.focus.map(i => `<li>${escapeHtml(i)}</li>`).join('')}</ul>` : ''}${r.tips.length ? `<h3>TIPS</h3><ul>${r.tips.map(i => `<li>${escapeHtml(i)}</li>`).join('')}</ul>` : ''}<p class="help">${r.local ? 'On this computer · ' : ''}${escapeHtml(r.model)} · ${(r.durationMs / 1000).toFixed(1)} seconds. Written by a model from your statistics and prompts; it can be wrong. Not saved.</p></div>` : '';
  return `<section class="progress-panel ins-coach"><h2>AI coaching summary <span class="optional">optional</span></h2><p>A short, personal summary written by a model. When you click, it reads your statistics and up to 8 recent prompt excerpts, framed as data rather than instructions. ${where}</p><button type="button" class="secondary" id="ins-coach" ${!canCoach || coachBusy ? 'disabled' : ''} aria-busy="${coachBusy}">${coachBusy ? 'Writing your summary…' : 'Get an AI coaching summary'}</button>${result}</section>`;
}

function privacyPanel() {
  const { enabled, count } = insightsData;
  return `<section class="progress-panel ins-privacy"><h2>Your prompt history</h2><label class="checkbox-label"><input type="checkbox" id="ins-enabled" ${enabled ? 'checked' : ''}>Keep a local prompt history for insights</label><p class="help">${count.toLocaleString()} ${count === 1 ? 'prompt' : 'prompts'} stored in prompt-log.json on this device, the latest 1,000 at most. Each entry has the date, action, skill, provider type, signals, length and the prompt text, so this page can show your own examples; context you add is not stored. Nothing is tracked or sent anywhere, except the excerpts in an AI coaching summary you ask for. ${enabled ? 'Turning this off records nothing new.' : 'It is off: new prompts are not recorded.'}</p><div class="ins-privacy-actions"><button type="button" class="secondary" id="ins-export" ${count ? '' : 'disabled'}><span data-icon="download"></span>Export JSON</button><button type="button" class="text-button delete" id="ins-erase" ${count ? '' : 'disabled'}>Erase prompt history</button></div></section>`;
}

function renderInsights() {
  const { summary, enabled } = insightsData;
  const root = $('progress-content');
  if (!summary.total) {
    root.innerHTML = `<div class="empty-state ins-empty"><h2>Your insights start with your next prompt.</h2><p>${enabled ? 'Improve, Compress or Explain a prompt in the Prompt workspace. Each one is noted on this device, and after a few prompts this page shows your Prompt Specificity, your areas to improve, and reading that helps.' : 'Prompt history is off, so nothing is being recorded. Turn it on below to see insights about how you prompt.'}</p><button type="button" id="ins-start" class="secondary">Open the Prompt workspace ↗</button></div>${privacyPanel()}`;
  } else root.innerHTML = `<div class="ins-top">${headlinePanel(summary)}${coveragePanel(summary)}</div>${areasPanel(summary)}${habitsPanel(summary)}${coachPanel()}${privacyPanel()}`;
  fillIcons(root); bindInsights();
}

function findExample(areaId, exampleId) { return insightsData.summary.weaknesses.find(w => w.id === areaId)?.examples.find(e => e.id === exampleId); }
function bindInsights() {
  const on = (id, handler) => { if ($(id)) $(id).onclick = handler; };
  on('ins-start', () => showView('workspace'));
  on('ins-skillify', () => showView('skills'));
  document.querySelectorAll('[data-ins-try]').forEach(button => button.onclick = () => {
    if (busy) { toast('Wait for the current improvement to finish.'); return; }
    const example = findExample(button.dataset.insTry, button.dataset.example); if (!example) return;
    setInput({ prompt: example.prompt, skillId: $('skill').value }, 'Your earlier prompt, from My progress.');
    const offline = state.connection.mode === 'offline';
    setAction(offline ? 'improve' : 'explain');
    toast(offline ? 'Your prompt is loaded. Explain needs an AI model, so Improve is selected; watch the signals as you edit.' : 'Your prompt is loaded. Choose Explain my prompt to see what it is missing.');
  });
  document.querySelectorAll('[data-ins-learn]').forEach(button => button.onclick = () => showView('learn'));
  document.querySelectorAll('[data-ins-skill]').forEach(button => button.onclick = () => {
    const id = button.dataset.insSkill; if (busy || !state.skills.some(s => s.id === id)) return;
    $('skill').value = id; updateSkill(); showView('workspace'); invalidate();
    toast(`${skillName(id)} skill selected. Write or paste a prompt to use it.`);
  });
  document.querySelectorAll('[data-ins-reading]').forEach(button => button.onclick = () => attempt(() => api.openReading(button.dataset.insReading)));
  on('ins-coach', async () => {
    if (coachBusy) return;
    coachBusy = true; renderInsights();
    try { coachResult = await api.insightsCoach(); } catch (error) { toast(cleanError(error.message), true); } finally { coachBusy = false; renderInsights(); }
  });
  if ($('ins-enabled')) $('ins-enabled').onchange = event => setPromptLog(event.target.checked);
  on('ins-export', () => attempt(async () => { if (await api.exportInsights()) toast('Prompt history exported.'); }));
  on('ins-erase', () => attempt(async () => {
    if (!window.confirm('Erase your prompt history from this device? My progress starts again from your next prompt. Saved sessions, chats and the Learner track are not affected.')) return;
    insightsData = await api.eraseInsights(); coachResult = null; renderInsights(); toast('Prompt history erased.');
  }));
}
async function setPromptLog(enabled) {
  const data = await attempt(() => api.insightsSettings({ enabled }));
  if (!data) return;
  insightsData = data; $('prompt-log-setting').checked = data.enabled;
  if (activeView === 'progress') renderInsights();
  toast(data.enabled ? 'Prompt history is on. New prompts are recorded on this device.' : 'Prompt history is off. Nothing new is recorded.');
}
const syncPromptLogSetting = () => attempt(async () => { $('prompt-log-setting').checked = (await api.insightsState()).enabled; });
$('open-settings').addEventListener('click', syncPromptLogSetting);
$('connection-badge').addEventListener('click', syncPromptLogSetting);
$('prompt-log-setting').onchange = event => setPromptLog(event.target.checked);
