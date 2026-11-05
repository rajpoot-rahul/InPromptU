'use strict';
// Learner track and personal benchmark. Everything is computed from data on this device.
const crypto = require('node:crypto');
const { analyze, textStats } = require('./engine.cjs');

const MILESTONES = [
  { id: 'basics', level: 1, title: 'Prompt basics', summary: 'Say what you want, give the context it needs, name the audience and the format, and set boundaries.', why: 'Most weak answers come from a missing task, context or format rather than a weak model.', practice: 'Save three prompts whose original brief covers at least four of the five signals: task, context, audience, format, boundaries.', action: { view: 'workspace', label: 'Open the Prompt workspace' }, auto: true,
    readings: [{ title: 'Prompt engineering guide (OpenAI)', url: 'https://platform.openai.com/docs/guides/prompt-engineering' }, { title: 'Prompt engineering overview (Anthropic)', url: 'https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/overview' }, { title: 'Prompting strategies (Google Gemini)', url: 'https://ai.google.dev/gemini-api/docs/prompting-strategies' }] },
  { id: 'tokenmining', level: 2, title: 'Tokenmining', summary: 'Get the same result with fewer tokens: one clear ask, only the context it needs, a compact output.', why: 'Shorter, sharper requests cost less, run faster and need fewer follow-ups.', practice: 'Use Compress on one prompt and Explain on another.', action: { view: 'workspace', label: 'Try Compress and Explain', promptAction: 'compress' }, auto: true,
    readings: [{ title: 'Prompt chaining (Prompting Guide)', url: 'https://www.promptingguide.ai/techniques/prompt_chaining' }, { title: 'Prompt caching (Anthropic)', url: 'https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching' }] },
  { id: 'skills', level: 3, title: 'Skills', summary: 'Turn an approach that works into a reusable skill, so you and your team stop rewriting the same instructions.', why: 'Reusable instructions make results consistent and save the tokens of repeating them.', practice: 'Save one skill of your own, then use your skills three times.', action: { view: 'skills', label: 'Open Skillify' }, auto: true,
    readings: [{ title: 'Prompting Guide: techniques', url: 'https://www.promptingguide.ai/' }] },
  { id: 'agents', level: 4, title: 'Agents', summary: 'An agent is a model that can use tools (search, code, APIs) in a loop to reach a goal you set.', why: 'Knowing when a tool-using agent helps, and when a single prompt is enough, avoids expensive, fragile setups.', practice: 'In Local chat, describe a task from your job and ask which steps would need a tool, which a person, and which a single prompt. Mark done when you can explain the difference.', action: { view: 'chat', label: 'Practise in Local chat', chatPrompt: 'I want to understand AI agents. Here is a task from my job: [describe it]. Break it into steps and say for each one whether it needs a tool (search, code, an app), a person, or just a single prompt. Keep it under 200 words.' }, auto: false,
    readings: [{ title: 'Building effective agents (Anthropic)', url: 'https://www.anthropic.com/engineering/building-effective-agents' }, { title: 'Tool use overview (Anthropic)', url: 'https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/overview' }, { title: 'Function calling (OpenAI)', url: 'https://platform.openai.com/docs/guides/function-calling' }] },
  { id: 'workflows', level: 5, title: 'Agentic workflows', summary: 'Chain steps with checkpoints: plan, act, check the result, and ask a person before anything irreversible.', why: 'Workflows with review points are more reliable and easier to trust than one long autonomous run.', practice: 'In Local chat, design a three-step workflow for a recurring task, with a check after each step and the point where a person approves. Mark done when you are happy with it.', action: { view: 'chat', label: 'Design one in Local chat', chatPrompt: 'Help me design an agentic workflow for this recurring task: [describe it]. Give three to five steps. For each step: the input, what the AI does, how the result is checked, and whether a person must approve before continuing.' }, auto: false,
    readings: [{ title: 'A practical guide to building agents (OpenAI, PDF)', url: 'https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf' }, { title: 'Building effective agents: workflows (Anthropic)', url: 'https://www.anthropic.com/engineering/building-effective-agents' }] },
  { id: 'multiagent', level: 6, title: 'Multi-agent workflows', summary: 'Split a large job across specialised agents (researcher, writer, reviewer) with clear hand-offs and an evaluator.', why: 'Multiple agents can work in parallel but multiply cost; they pay off only for broad, separable work.', practice: 'In Local chat, sketch a team of two or three agents for a large task, including their hand-offs and how the final result is checked. Mark done when you can say why one agent would not be enough.', action: { view: 'chat', label: 'Sketch a team in Local chat', chatPrompt: 'Sketch a multi-agent setup for this large task: [describe it]. Name two or three agents, what each one does, what they hand to each other, and how the final result is evaluated. Then say honestly whether a single agent would be cheaper and good enough.' }, auto: false,
    readings: [{ title: 'How we built our multi-agent research system (Anthropic)', url: 'https://www.anthropic.com/engineering/multi-agent-research-system' }, { title: 'Multi-agent systems (LangGraph)', url: 'https://langchain-ai.github.io/langgraph/concepts/multi_agent/' }, { title: 'AutoGen documentation (Microsoft)', url: 'https://microsoft.github.io/autogen/stable/' }] }
];

const has = pattern => text => new RegExp(pattern, 'i').test(text);
const TASKS = [
  { id: 'meeting-summary', title: 'Meeting summary for a busy manager', scenario: 'You have the transcript of a 40-minute project meeting. Ask an AI to summarise it for your manager, who has two minutes to read it.', budget: 70,
    checks: [{ label: 'Points to the transcript or notes it should use', test: has('\\b(transcript|notes|below|attached|following)\\b'), points: 10 }, { label: 'Asks for decisions, owners or next steps', test: has('\\b(decision|action item|owner|next step|deadline)'), points: 15 }, { label: 'Sets a length or shape', test: has('\\b(\\d+\\s*(words|bullets|points|sentences|lines)|bullets?|one paragraph|brief)\\b'), points: 10 }],
    reference: 'Summarise the meeting transcript below for my manager, who has two minutes. Use 5 bullets: key decisions, owners and next steps with deadlines. Only use what is in the transcript; do not add assumptions.' },
  { id: 'customer-reply', title: 'Reply to a damaged-order complaint', scenario: 'A customer says their order arrived damaged. Ask an AI to draft a reply. You can offer a replacement, but refunds need a manager’s approval.', budget: 80,
    checks: [{ label: 'Offers the replacement', test: has('replac'), points: 10 }, { label: 'Keeps the refund rule (no refund without approval)', test: text => /refund/i.test(text) && /(do not|don't|never|without|not|only after|needs?|requires?).{0,50}(refund|approv)|(refund).{0,50}(approv|not|without)/i.test(text), points: 15 }, { label: 'Sets the tone', test: has('\\b(empath|apolog|polite|friendly|warm|calm|kind)'), points: 10 }],
    reference: 'Draft a short, empathetic email reply to the customer complaint below about a damaged order. Apologise, offer a free replacement, and explain the next step. Do not promise a refund; refunds need manager approval. Under 120 words.' },
  { id: 'policy-explainer', title: 'Explain a policy to new joiners', scenario: 'Ask an AI to explain your company’s new hybrid-working policy, which you will paste in, to new joiners in plain language.', budget: 70,
    checks: [{ label: 'Points to the pasted policy', test: has('\\b(below|pasted|attached|following|this policy|the policy)\\b'), points: 10 }, { label: 'Asks for plain language', test: has('\\b(plain|simple|jargon|easy to understand|clear language)'), points: 10 }, { label: 'Forbids inventing rules', test: has('(only|do not|don.t|never|without).{0,50}(policy|invent|add|assum|made.up)'), points: 15 }],
    reference: 'Explain the hybrid-working policy below to new joiners in plain language. Use a short intro and 5 bullets covering who, when and how. Only use the policy text; do not invent rules. Flag anything unclear as a question.' },
  { id: 'sales-trends', title: 'Find trends in sales figures', scenario: 'You have monthly sales figures for three regions over a year. Ask an AI to find the main trends and suggest what to investigate.', budget: 80,
    checks: [{ label: 'Points to the data it should use', test: has('\\b(data|figures|table|below|attached|following|csv)\\b'), points: 10 }, { label: 'Asks for comparisons or trends', test: has('\\b(trend|compare|comparison|change|growth|decline)'), points: 10 }, { label: 'Guards against over-claiming', test: has('(assum|caus|correlat|uncertain|confidence|evidence|limitation)'), points: 15 }],
    reference: 'Analyse the monthly sales figures below for three regions. Compare the regions, describe the 3 main trends with the numbers, and suggest 2 things to investigate. State assumptions; do not claim causes the data cannot show.' },
  { id: 'bug-report', title: 'Get help with a failing form', scenario: 'A web form shows an error when users submit it. Ask an AI to help you find the cause.', budget: 90,
    checks: [{ label: 'Includes the error message or logs', test: has('\\b(error|log|stack|message|console)'), points: 10 }, { label: 'Describes when it happens', test: has('\\b(steps|reproduce|when|after|only on|every time)\\b'), points: 10 }, { label: 'Names the environment', test: has('\\b(browser|version|framework|react|node|python|java|chrome|safari|firefox|api)\\b'), points: 5 }, { label: 'Asks for likely causes and how to verify', test: has('(hypothes|verify|likely cause|check|test|confirm)'), points: 10 }],
    reference: 'Help me debug a web form that fails on submit. The error, browser console log and steps to reproduce are below (React 18, Chrome). List the 3 most likely causes, how to verify each, and the smallest fix. Do not assume code you cannot see.' },
  { id: 'tokenmining-rewrite', title: 'Tokenmining: same result, fewer tokens', scenario: 'A colleague wrote: “Hi there! I was wondering if you could maybe help me out by writing something like a short update, around 300 words or so, for our investors about how Q3 went, if that’s okay? It should be upbeat but honest, and it’s due Friday.” Write a shorter prompt that gets the same result.', budget: 30,
    checks: [{ label: 'Keeps the length (300 words)', test: has('300'), points: 10 }, { label: 'Keeps the audience (investors)', test: has('investor'), points: 10 }, { label: 'Keeps the topic (Q3)', test: has('\\bQ3\\b|third quarter'), points: 5 }, { label: 'Keeps the tone (upbeat but honest)', test: text => /(upbeat|positive|optimistic)/i.test(text) && /honest|candid|balanced/i.test(text), points: 10 }],
    reference: 'Write a 300-word investor update on Q3 from the notes below. Upbeat but honest; do not invent figures.' }
];

function scorePrompt(task, raw) {
  const prompt = String(raw || '').trim().slice(0, 4000);
  if (!prompt) return { score: 0, items: [{ label: 'No prompt written', earned: 0, points: 100 }], tips: ['Write a prompt for this task to get a score.'] };
  const signals = analyze({ prompt }).signals;
  const items = signals.map(s => ({ label: `${s.label} signal`, earned: s.present ? 10 : 0, points: 10, tip: s.tip }));
  for (const check of task.checks) items.push({ label: check.label, earned: check.test(prompt) ? check.points : 0, points: check.points });
  const stats = textStats(prompt);
  const efficiency = stats.words < 6 ? 0 : stats.estimatedTokens <= task.budget ? 15 : stats.estimatedTokens <= task.budget * 2 ? 8 : 0;
  items.push({ label: `Concise (about ${task.budget} tokens or fewer; yours ≈${stats.estimatedTokens})`, earned: efficiency, points: 15, tip: stats.words < 6 ? 'Too short to carry the task and its context.' : 'Cut filler and repetition; keep every requirement.' });
  const score = items.reduce((n, item) => n + item.earned, 0);
  const tips = items.filter(item => item.earned < item.points).map(item => item.tip || `Add: ${item.label.toLowerCase()}.`).slice(0, 4);
  return { score, items, tips, stats };
}
function scoreRun(answers) {
  if (!answers || typeof answers !== 'object') throw new Error('Write at least one benchmark prompt.');
  const tasks = TASKS.map(task => {
    const prompt = typeof answers[task.id] === 'string' ? answers[task.id].trim().slice(0, 4000) : '';
    return { id: task.id, prompt, ...scorePrompt(task, prompt) };
  });
  if (!tasks.some(task => task.prompt)) throw new Error('Write at least one benchmark prompt.');
  const answered = tasks.filter(task => task.prompt);
  return { id: crypto.randomUUID(), date: new Date().toISOString(), answered: answered.length, total: Math.round(answered.reduce((n, t) => n + t.score, 0) / answered.length), tasks };
}
const REFERENCE = Object.fromEntries(TASKS.map(task => [task.id, scorePrompt(task, task.reference).score]));
const REFERENCE_TOTAL = Math.round(Object.values(REFERENCE).reduce((a, b) => a + b, 0) / TASKS.length);

function progress({ history = [], events = {}, skills = [], manual = {}, runs = [] }) {
  const strongBriefs = history.filter(h => (h.result?.analysis?.signals || []).filter(s => s.present).length >= 4).length;
  const custom = skills.filter(s => s.custom);
  const skillUses = custom.reduce((n, s) => n + (s.uses || 0), 0);
  const state = {
    basics: { done: strongBriefs >= 3, detail: `${Math.min(strongBriefs, 3)} of 3 well-specified briefs saved` },
    tokenmining: { done: (events.compress || 0) >= 1 && (events.explain || 0) >= 1, detail: `Compress used ${events.compress || 0}×, Explain used ${events.explain || 0}×` },
    skills: { done: custom.length >= 1 && skillUses >= 3, detail: `${custom.length} ${custom.length === 1 ? 'skill' : 'skills'} saved, used ${skillUses} of 3 times` }
  };
  const milestones = MILESTONES.map(m => {
    const auto = state[m.id];
    const done = auto ? auto.done : Boolean(manual[m.id]);
    return { id: m.id, done, detail: auto ? auto.detail : manual[m.id] ? `Marked done ${new Date(manual[m.id]).toLocaleDateString()}` : 'Self-reported: mark done after the practice', doneAt: manual[m.id] || '' };
  });
  const next = milestones.find(m => !m.done)?.id || null;
  const latest = runs[0];
  const readyForMore = Boolean(latest && latest.total >= 70 && milestones.find(m => m.id === 'basics').done);
  return { milestones, next, completed: milestones.filter(m => m.done).length, readyForMore };
}

// Opt-in ranked mode without a server: score cards carry scores only, never prompt text.
const ALIAS = /^[\p{L}\p{N} ._-]{2,40}$/u;
function validAlias(raw) {
  const alias = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
  if (!ALIAS.test(alias)) throw new Error('Choose a display name of 2–40 letters, numbers, spaces, dots, dashes or underscores. An alias is fine.');
  return alias;
}
function makeScorecard(run, alias, appVersion = '') {
  if (!run || run.answered !== TASKS.length) throw new Error(`Ranked score cards need an attempt with all ${TASKS.length} tasks answered, so everyone is compared on the same tasks.`);
  return { format: 'impromptu-scorecard', version: 1, alias: validAlias(alias), total: run.total, answered: run.answered, tasks: Object.fromEntries(run.tasks.map(t => [t.id, t.score])), date: run.date, app: String(appVersion).slice(0, 20) };
}
function validateScorecard(raw) {
  if (!raw || raw.format !== 'impromptu-scorecard' || raw.version !== 1) throw new Error('Not an Impromptu score card.');
  const alias = validAlias(raw.alias);
  const ids = TASKS.map(t => t.id);
  if (!raw.tasks || typeof raw.tasks !== 'object' || Object.keys(raw.tasks).length !== ids.length || !ids.every(id => Number.isInteger(raw.tasks[id]) && raw.tasks[id] >= 0 && raw.tasks[id] <= 100)) throw new Error(`${alias}: task scores are missing or invalid.`);
  const total = Math.round(ids.reduce((n, id) => n + raw.tasks[id], 0) / ids.length);
  if (raw.total !== total || raw.answered !== ids.length) throw new Error(`${alias}: the total does not match the task scores.`);
  if (typeof raw.date !== 'string' || Number.isNaN(Date.parse(raw.date))) throw new Error(`${alias}: the attempt date is invalid.`);
  return { alias, total, answered: ids.length, tasks: Object.fromEntries(ids.map(id => [id, raw.tasks[id]])), date: new Date(raw.date).toISOString() };
}
function leaderboard(board, own) {
  const entries = [...board.filter(entry => !own || entry.alias.toLowerCase() !== own.alias.toLowerCase()), ...(own ? [{ ...own, you: true }] : [])];
  entries.sort((a, b) => b.total - a.total || a.date.localeCompare(b.date));
  let rank = 0, previous = null;
  const ranked = entries.map((entry, index) => { if (entry.total !== previous) { rank = index + 1; previous = entry.total; } return { ...entry, rank }; });
  const average = entries.length ? Math.round(entries.reduce((n, e) => n + e.total, 0) / entries.length) : null;
  const taskAverages = entries.length ? Object.fromEntries(TASKS.map(t => [t.id, Math.round(entries.reduce((n, e) => n + e.tasks[t.id], 0) / entries.length)])) : {};
  return { entries: ranked, participants: entries.length, average, taskAverages };
}

function publicCurriculum() {
  return { milestones: MILESTONES, tasks: TASKS.map(({ id, title, scenario, budget, reference }) => ({ id, title, scenario, budget, reference, referenceScore: REFERENCE[id] })), referenceTotal: REFERENCE_TOTAL };
}
function readingAllowed(url) { return MILESTONES.some(m => m.readings.some(r => r.url === url)); }

module.exports = { MILESTONES, TASKS, scorePrompt, scoreRun, progress, publicCurriculum, readingAllowed, REFERENCE, REFERENCE_TOTAL, validAlias, makeScorecard, validateScorecard, leaderboard };
