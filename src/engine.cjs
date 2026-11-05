'use strict';

const skills = [
  { id: 'general', name: 'Clear thinking', category: 'Everyday work', version: '1.0', icon: 'spark', description: 'Give the task a clear shape, without changing your intention.', instructions: 'Keep the original intent and explicit constraints. Ask a concise clarifying question if essential information is missing. State assumptions separately. Give a direct, useful answer without unnecessary detail.' },
  { id: 'support', name: 'Customer response', category: 'Customer success', version: '1.0', icon: 'message', description: 'Empathetic, evidence-led replies with clear next steps.', instructions: 'Use the customer information and support procedure actually provided. Acknowledge the concern, separate confirmed facts from assumptions, and explain the next step. Do not invent policies, refunds, deadlines or resolution promises. Ask for any essential missing information.' },
  { id: 'engineering', name: 'Code investigation', category: 'Engineering', version: '1.0', icon: 'code', description: 'Turn a vague bug report into a focused investigation.', instructions: 'Use the supplied code, logs and reproduction steps. Distinguish observations from hypotheses. Propose the smallest relevant investigation or change and explain how to verify it. Do not invent files, APIs, execution results or a confirmed root cause.' },
  { id: 'summary', name: 'Document summary', category: 'Knowledge work', version: '1.0', icon: 'file', description: 'Find the signal and keep it grounded in the source.', instructions: 'Summarize only the material provided. Preserve important qualifications and disagreements. Separate key points, decisions and open questions. Cite source sections when available. Do not invent missing facts, owners or dates.' },
  { id: 'tokenmining', name: 'Tokenmining', category: 'Cost-aware AI', version: '1.0', icon: 'bulb', description: 'Get the same result with fewer tokens: one clear ask, only the context it needs, a tight output.', instructions: 'State the task in one sentence. Include only the context this answer needs; refer to material the model already has instead of pasting it again. Specify a compact output format and length limit. Ask for the answer only, with no restated question or preamble. Prefer one well-specified request over several vague follow-ups. Keep every explicit constraint, identifier and fact.' },
  { id: 'analysis', name: 'Business analysis', category: 'Operations', version: '1.0', icon: 'chart', description: 'Useful comparisons, explicit assumptions and supported conclusions.', instructions: 'Use the supplied data and decision criteria. Separate evidence, calculations and assumptions. Identify missing data and relevant limitations. Explain trade-offs and support recommendations with the available evidence. Do not invent metrics or imply causation from correlation.' }
];

function text(value, name, max = 30000) {
  if (typeof value !== 'string' || value.length > max) throw new Error(`${name} must be text under ${max.toLocaleString()} characters.`);
  return value.trim();
}

function normalizeInput(input, catalog = skills) {
  if (!input || typeof input !== 'object') throw new Error('Add a prompt to get started.');
  const prompt = text(input.prompt, 'Prompt');
  if (!prompt) throw new Error('Add a prompt to get started.');
  const skill = catalog.find(s => s.id === input.skillId) || catalog[0];
  return { prompt, context: text(input.context ?? '', 'Context'), audience: text(input.audience ?? '', 'Audience', 500), format: text(input.format ?? '', 'Format', 500), skillId: skill.id };
}

function analyze(raw) {
  const input = normalizeInput(raw);
  const combined = `${input.prompt}\n${input.context}`;
  const signals = [
    { id: 'task', label: 'Task', present: /\b(write|draft|summari[sz]e|explain|find|compare|review|create|help|fix|debug|analy[sz]e|respond|translate|design|plan|build|list|extract)\b/i.test(input.prompt), tip: 'Name the action you want the model to take.' },
    { id: 'context', label: 'Context', present: Boolean(input.context) || /\b(because|background|context|attached|following|given|based on|using this|here is|below|pasted|provided|from the (data|notes|transcript|policy|figures|logs?))\b/i.test(input.prompt), tip: 'Add relevant source material or explain the situation.' },
    { id: 'audience', label: 'Audience', present: Boolean(input.audience) || /\b(customers?|clients?|executives?|managers?|beginners?|engineers?|team|audience|readers?|stakeholders?|investors?|(new )?joiners?|employees?|colleagues?|users?|board|students?|partners?)\b/i.test(combined), tip: 'Name the audience when it affects the answer.' },
    { id: 'format', label: 'Format', present: Boolean(input.format) || /\b(bullets?|table|json|email|steps?|paragraph|checklist|markdown|summary|brief|report|update|list|\d+[- ]?(words?|sentences?|lines?|points?))\b/i.test(input.prompt), tip: 'Suggest a useful output format.' },
    { id: 'boundaries', label: 'Boundaries', present: /\b(do not|don't|only|must|avoid|under|limit|without|cite|evidence|assumptions?)\b/i.test(combined), tip: 'State constraints, evidence requirements or what to avoid.' }
  ];
  const questions = [];
  if (!signals[1].present) questions.push('What background or source material should the answer use?');
  if (!signals[2].present) questions.push('Who is the answer for?');
  if (!signals[3].present) questions.push('What would a useful finished answer look like?');
  let recommended = 'general';
  if (/\b(customer|complaint|refund|support|client)\b/i.test(input.prompt)) recommended = 'support';
  else if (/\b(code|bug|debug|error|stack|function|test|api)\b/i.test(input.prompt)) recommended = 'engineering';
  else if (/\b(summari[sz]e|document|summary|meeting|notes|article)\b/i.test(input.prompt)) recommended = 'summary';
  else if (/\b(analy[sz]e|analysis|revenue|compare|budget|sales|data)\b/i.test(input.prompt)) recommended = 'analysis';
  return { signals, questions, recommended, detected: signals.filter(s => s.present).length };
}

function improve(raw, catalog = skills) {
  const input = normalizeInput(raw, catalog);
  const skill = catalog.find(s => s.id === input.skillId);
  const analysis = analyze(input);
  const parts = [input.prompt];
  if (input.context) parts.push(`Relevant context:\n${input.context}`);
  if (input.audience) parts.push(`Audience: ${input.audience}`);
  if (input.format) parts.push(`Preferred output: ${input.format}`);
  parts.push(`Working approach:\n${skill.instructions}`);
  return {
    improved: parts.join('\n\n'),
    changes: ['Kept your original request intact.', `Added the ${skill.name.toLowerCase()} working approach.`, ...(input.context ? ['Included the background you supplied.'] : []), ...(input.audience || input.format ? ['Made your output preferences explicit.'] : []), 'Added a boundary against inventing missing facts.'],
    questions: analysis.questions, analysis, skillId: skill.id, mode: 'offline', usage: null,
    tip: analysis.signals.find(s => !s.present)?.tip || 'Your brief already covers these signals. Keep only instructions that help this particular task.'
  };
}

// A rough cross-model estimate; real tokenizers differ, so the UI always labels it as an estimate.
function textStats(value) {
  const text = String(value || '');
  return { characters: text.length, words: (text.match(/\S+/g) || []).length, estimatedTokens: Math.ceil(text.length / 4) };
}
// Identifiers, numbers and quoted phrases a compressed prompt must keep.
function keyDetails(value) {
  const text = String(value || '');
  const found = [
    ...(text.match(/\b[A-Za-z]+[-_][A-Za-z0-9_-]*\d[A-Za-z0-9_-]*\b|\b[A-Z][A-Z0-9]*[-_][A-Z0-9_]+\b/g) || []),
    ...(text.match(/\b\d[\d,.:%/-]*\b/g) || []),
    ...(text.match(/"[^"\n]{2,80}"|“[^”\n]{2,80}”/g) || []),
    ...(text.match(/\b(?:not|never|don't|do not|without|only|must)\b/gi) || []).map(word => word.toLowerCase())
  ];
  return [...new Set(found)].slice(0, 40);
}
function missingDetails(original, compressed) {
  const target = String(compressed || '').toLowerCase();
  return keyDetails(original).filter(detail => !target.includes(detail.toLowerCase()) && !(detail === 'do not' && target.includes("don't")) && !(detail === "don't" && target.includes('do not')));
}

module.exports = { skills, normalizeInput, analyze, improve, textStats, keyDetails, missingDetails };
