const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SkillStore, validateSkill, generateSkill } = require('../src/skills.cjs');
const { requestImprovement } = require('../src/provider.cjs');
const local = { mode: 'ollama', endpoint: 'http://localhost:11434/api/chat', model: 'gemma4:latest' };
const skill = { name: 'Weekly ticket digest', category: 'Support', description: 'Summarise a week of tickets for a manager.', instructions: 'Group tickets by product. Flag anything older than five days. End with three priorities.' };

function storeFile(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'impromptu-skills-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, 'skills.json');
}

test('custom skills are saved privately, versioned on edit, and starters stay read-only', t => {
  const file = storeFile(t);
  const store = new SkillStore(file);
  const saved = store.save(skill);
  assert.match(saved.id, /^custom-/);
  assert.equal(saved.version, '1');
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(store.save({ ...skill, id: saved.id, instructions: 'Group tickets by product only.' }).version, '2');
  assert.throws(() => store.save({ ...skill, id: 'general' }), /read-only/);
  assert.throws(() => store.save({ ...skill, name: 'Clear thinking' }), /already exists/);
  assert.throws(() => store.delete('general'), /Only your own/);
  store.recordUse(saved.id); store.recordUse(saved.id); store.recordUse('general');
  const reopened = new SkillStore(file);
  assert.equal(reopened.custom[0].uses, 2);
  assert.equal(reopened.all().filter(s => !s.custom).length, 6);
  reopened.delete(saved.id);
  assert.equal(new SkillStore(file).custom.length, 0);
});

test('validation trims, bounds and rejects incomplete skills', () => {
  assert.throws(() => validateSkill({ name: '', instructions: 'x' }), /Add a name/);
  assert.throws(() => validateSkill({ name: 'x', instructions: '   ' }), /Add a working approach/);
  assert.throws(() => validateSkill({ name: 'x'.repeat(61), instructions: 'x' }), /under 60/);
  const valid = validateSkill({ name: '  Tidy   name ', instructions: 'Do it.', icon: '<script>' });
  assert.deepEqual([valid.name, valid.category, valid.icon], ['Tidy name', 'My skills', 'layers']);
});

test('import adds valid skills, reports skipped ones, and export omits private metadata', t => {
  const store = new SkillStore(storeFile(t));
  const result = store.importSkills({ skills: [skill, { name: 'No approach' }, { ...skill }] });
  assert.equal(result.added, 1);
  assert.equal(result.skipped.length, 2);
  assert.throws(() => store.importSkills({ nope: [] }), /does not contain/);
  store.recordUse(store.custom[0].id);
  const exported = store.exportable();
  assert.equal(exported.format, 'impromptu-skills');
  assert.deepEqual(Object.keys(exported.skills[0]).sort(), ['category', 'description', 'icon', 'instructions', 'name', 'version']);
});

test('generation drafts a validated skill through the configured model and never saves it', async t => {
  let body;
  const result = await generateSkill('Every Monday I summarise tickets for my manager, grouped by product.', local, '', async (_url, options) => {
    body = JSON.parse(options.body);
    return new Response(JSON.stringify({ message: { content: JSON.stringify({ ...skill, instructions: ['Group by product.', 'Flag old tickets.'] }) } }));
  });
  assert.match(body.messages[0].content, /reusable "skill"/);
  assert.equal(result.draft.name, skill.name);
  assert.equal(result.draft.instructions, 'Group by product. Flag old tickets.');
  assert.equal(result.mode, 'ollama');
  await assert.rejects(generateSkill('Something', { mode: 'offline' }, '', () => { throw new Error('must not fetch'); }), /needs an AI model/);
  await assert.rejects(generateSkill('Something', local, '', async () => new Response(JSON.stringify({ message: { content: 'Sure! Here is a skill.' } }))), /did not return a skill/);
  await assert.rejects(generateSkill('   ', local), /Add a prompt or workflow/);
});

test('a custom skill drives Improve and the offline template', async t => {
  const store = new SkillStore(storeFile(t));
  const saved = store.save(skill);
  const offline = await requestImprovement({ prompt: 'Summarise this week.', skillId: saved.id }, { mode: 'offline' }, '', undefined, store.all());
  assert.equal(offline.skillId, saved.id);
  assert.match(offline.improved, /Flag anything older than five days/);
  let payload;
  await requestImprovement({ prompt: 'Summarise this week.', skillId: saved.id }, local, '', async (_url, options) => {
    payload = JSON.parse(JSON.parse(options.body).messages[1].content);
    return new Response(JSON.stringify({ message: { content: JSON.stringify({ improved: 'x', changes: [], questions: [] }) } }));
  }, store.all());
  assert.match(payload.skill, /three priorities/);
});
