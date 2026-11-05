const test = require('node:test');
const assert = require('node:assert/strict');
const { requestImprovement, parseExplanation } = require('../src/provider.cjs');
const { textStats, keyDetails, missingDetails, skills, improve } = require('../src/engine.cjs');
const local = { mode: 'ollama', endpoint: 'http://localhost:11434/api/chat', model: 'gemma4:latest' };
const reply = content => async () => new Response(JSON.stringify({ message: { content: JSON.stringify(content) }, prompt_eval_count: 120, eval_count: 40 }));
const long = 'Hi! Could you please, if possible, help me investigate ERR-504 on API_V2? It started at 09:30. Do not restart production. Please make sure you really look into it carefully and thoroughly.';

test('compress returns measured-by-estimate savings and flags dropped details', async () => {
  let system;
  const kept = await requestImprovement({ prompt: long, action: 'compress' }, local, '', async (_url, options) => {
    system = JSON.parse(options.body).messages[0].content;
    return reply({ compressed: 'Investigate ERR-504 on API_V2 (started 09:30). Do not restart production.', changes: ['Removed politeness padding.'], questions: [] })();
  });
  assert.match(system, /compress prompts/);
  assert.equal(kept.action, 'compress');
  assert.ok(kept.stats.result.estimatedTokens < kept.stats.original.estimatedTokens);
  assert.deepEqual(kept.missing, []);
  assert.deepEqual(kept.usage, { input: 120, output: 40 });
  const dropped = await requestImprovement({ prompt: long, action: 'compress' }, local, '', reply({ 'compressed prompt': 'Investigate the API error.', changes: [] }));
  for (const detail of ['ERR-504', 'API_V2', '09:30', 'do not']) assert.ok(dropped.missing.includes(detail), detail);
});

test('explain returns a validated teaching structure, not a rewrite', async () => {
  let system;
  const result = await requestImprovement({ prompt: 'Summarise these notes.', action: 'explain' }, local, '', async (_url, options) => {
    system = JSON.parse(options.body).messages[0].content;
    return reply({ summary: 'Asks for a summary of unspecified notes.', strengths: ['Clear action.'], gaps: ['No notes supplied.'], tips: ['Name the output length.'] })();
  });
  assert.match(system, /explain prompts/);
  assert.equal(result.action, 'explain');
  assert.equal(result.improved, undefined);
  assert.deepEqual(result.explanation.tips, ['Name the output length.']);
  assert.throws(() => parseExplanation(JSON.stringify({ strengths: [] })), /did not return an explanation/);
  assert.throws(() => parseExplanation(JSON.stringify({ summary: 'ok', tips: [7] })), /invalid explanation/);
  assert.deepEqual(parseExplanation(JSON.stringify({ summary: 'ok' })), { summary: 'ok', strengths: [], gaps: [], tips: [] });
});

test('offline mode refuses Compress and Explain instead of faking AI output', async () => {
  for (const action of ['compress', 'explain']) {
    await assert.rejects(requestImprovement({ prompt: long, action }, { mode: 'offline' }, '', () => { throw new Error('must not fetch'); }), /needs an AI model/);
  }
  assert.equal((await requestImprovement({ prompt: long, action: 'improve' }, { mode: 'offline' })).mode, 'offline');
});

test('text statistics and key-detail checks are deterministic', () => {
  assert.deepEqual(textStats('four four four four'), { characters: 19, words: 4, estimatedTokens: 5 });
  const details = keyDetails(long);
  for (const detail of ['ERR-504', 'API_V2', '09:30', 'do not']) assert.ok(details.includes(detail), detail);
  assert.deepEqual(missingDetails('Do not send "draft v2" to anyone', "Don't send \"draft v2\" to anyone"), []);
  assert.deepEqual(missingDetails('Never share "draft v2"', 'Share the draft'), ['"draft v2"', 'never']);
  assert.deepEqual(missingDetails('Do not send it', 'do not send it'), []);
});

test('the Tokenmining starter skill is available offline', () => {
  const skill = skills.find(s => s.id === 'tokenmining');
  assert.ok(skill && /fewer tokens/.test(skill.description));
  assert.match(improve({ prompt: 'Draft a status update.', skillId: 'tokenmining' }).improved, /compact output format/);
});
