const test = require('node:test');
const assert = require('node:assert/strict');
const { MILESTONES, TASKS, scorePrompt, scoreRun, progress, readingAllowed, REFERENCE, REFERENCE_TOTAL } = require('../src/learning.cjs');

test('the curriculum runs from prompts to multi-agent workflows with real reading links', () => {
  assert.deepEqual(MILESTONES.map(m => m.id), ['basics', 'tokenmining', 'skills', 'agents', 'workflows', 'multiagent']);
  for (const m of MILESTONES) {
    assert.ok(m.readings.length >= 1);
    for (const r of m.readings) { assert.match(r.url, /^https:\/\//); assert.equal(readingAllowed(r.url), true); }
  }
  assert.equal(readingAllowed('https://evil.example/'), false);
  assert.deepEqual(MILESTONES.filter(m => !m.auto).map(m => m.id), ['agents', 'workflows', 'multiagent']);
});

test('the rubric is transparent, rewards complete concise briefs and penalises padding', () => {
  for (const task of TASKS) assert.ok(REFERENCE[task.id] >= 80, `${task.id} reference scored ${REFERENCE[task.id]}`);
  assert.ok(REFERENCE_TOTAL >= 90);
  const meeting = TASKS.find(t => t.id === 'meeting-summary');
  const weak = scorePrompt(meeting, 'Summarise the meeting');
  assert.ok(weak.score < 40);
  assert.ok(weak.tips.length > 0);
  assert.equal(weak.items.reduce((n, i) => n + i.points, 0), 100);
  const padded = scorePrompt(meeting, `${meeting.reference} ${'Please make sure you really do this carefully and thoroughly. '.repeat(12)}`);
  assert.ok(padded.score < REFERENCE[meeting.id]);
  assert.equal(scorePrompt(meeting, '').score, 0);
});

test('a benchmark run averages answered tasks only and rejects an empty run', () => {
  const answers = { 'meeting-summary': TASKS[0].reference, 'customer-reply': 'Reply to the customer.' };
  const run = scoreRun(answers);
  assert.equal(run.answered, 2);
  assert.equal(run.total, Math.round((run.tasks[0].score + run.tasks[1].score) / 2));
  assert.equal(run.tasks.find(t => t.id === 'bug-report').prompt, '');
  assert.throws(() => scoreRun({}), /at least one/);
  assert.throws(() => scoreRun(null), /at least one/);
});

test('progress comes from real local activity; agent stages are self-reported', () => {
  const strong = { result: { analysis: { signals: [1, 2, 3, 4].map(() => ({ present: true })).concat({ present: false }) } } };
  const empty = progress({});
  assert.equal(empty.completed, 0); assert.equal(empty.next, 'basics');
  const partial = progress({ history: [strong, strong], events: { compress: 1 } });
  assert.match(partial.milestones[0].detail, /2 of 3/);
  assert.equal(partial.milestones[1].done, false);
  const done = progress({ history: [strong, strong, strong], events: { compress: 1, explain: 2 }, skills: [{ custom: true, uses: 3 }], manual: { agents: new Date().toISOString() }, runs: [{ total: 82 }] });
  assert.deepEqual(done.milestones.filter(m => m.done).map(m => m.id), ['basics', 'tokenmining', 'skills', 'agents']);
  assert.equal(done.next, 'workflows');
  assert.equal(done.readyForMore, true);
});

test('score cards carry scores only, reject tampering, and the leaderboard ranks ties fairly', () => {
  const { makeScorecard, validateScorecard, leaderboard, validAlias } = require('../src/learning.cjs');
  const full = scoreRun(Object.fromEntries(TASKS.map(task => [task.id, `${task.reference} private detail`])));
  const card = makeScorecard(full, 'Asha', '0.2.7');
  assert.ok(!JSON.stringify(card).includes('private detail'));
  assert.deepEqual(validateScorecard(card).tasks, card.tasks);
  assert.throws(() => makeScorecard(scoreRun({ 'meeting-summary': 'x' }), 'Asha'), /all 6 tasks/);
  assert.throws(() => validateScorecard({ ...card, total: card.total + 5 }), /does not match/);
  assert.throws(() => validateScorecard({ ...card, tasks: { ...card.tasks, 'bug-report': 101 } }), /invalid/);
  assert.throws(() => validateScorecard({ ...card, format: 'other' }), /Not an Impromptu/);
  assert.throws(() => validAlias('<script>'), /display name/);
  const entry = (alias, total, date) => ({ alias, total, date, tasks: Object.fromEntries(TASKS.map(t => [t.id, total])) });
  const board = leaderboard([entry('Ben', 80, '2026-01-02'), entry('Cara', 80, '2026-01-01'), entry('Dev', 50, '2026-01-01')], entry('Asha', 90, '2026-01-03'));
  assert.deepEqual(board.entries.map(e => [e.rank, e.alias]), [[1, 'Asha'], [2, 'Cara'], [2, 'Ben'], [4, 'Dev']]);
  assert.equal(board.average, 75);
  assert.equal(board.entries[0].you, true);
  assert.deepEqual(leaderboard([], null), { entries: [], participants: 0, average: null, taskAverages: {} });
});
