const test = require('node:test');
const assert = require('node:assert/strict');
const { improve, analyze, normalizeInput, skills } = require('../src/engine.cjs');

test('offline improvement preserves identifiers, negations and exact original wording', () => {
  const prompt = 'Do NOT change API_V2. Investigate ERR-504; do not promise a refund.';
  const result = improve({ prompt, skillId: 'support', context: 'No resolution is confirmed.' });
  assert.ok(result.improved.startsWith(prompt + '\n\n'));
  assert.ok(result.improved.includes('No resolution is confirmed.'));
  assert.equal(result.mode, 'offline'); assert.equal(result.usage, null);
});
test('every skill works without fabricating missing customer or business context', () => {
  for (const skill of skills) {
    const result = improve({ prompt: 'Help me with this.', skillId: skill.id });
    assert.ok(result.questions.some(q => q.includes('background')));
    assert.ok(!result.improved.includes('Relevant context:'));
    assert.ok(!result.improved.includes('Audience:'));
  }
});
test('source text is treated as text and simple signals are not employee scores', () => {
  const analysis = analyze({ prompt: '<script>alert(1)</script> Write a summary for my team using the following notes. Cite evidence.' });
  assert.equal(analysis.detected, 5);
  assert.equal(analysis.recommended, 'summary');
  assert.equal(analysis.score, undefined);
});
test('empty, wrong-type and oversized inputs fail with a useful error', () => {
  assert.throws(() => normalizeInput({ prompt: '   ' }), /Add a prompt/);
  assert.throws(() => normalizeInput({ prompt: 5 }), /must be text/);
  assert.throws(() => normalizeInput({ prompt: 'x'.repeat(30001) }), /30,000/);
  assert.equal(normalizeInput({ prompt: 'Hello', skillId: '__proto__' }).skillId, 'general');
});
