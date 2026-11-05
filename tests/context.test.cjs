const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parsePack, redact, PackStore, inboxFiles, readInboxFile, archiveInboxFile, handoffPrompt, skillFile, FORMAT } = require('../src/context.cjs');

const pack = `---
format: ${FORMAT}
source: cursor
model: claude-opus-5.5
title: Bedrock retry logic
created: 2026-11-05T19:00:00Z
---
## Goal
Add retries to the Bedrock client.
## Decisions
Retry only on throttling, max 3 attempts.
## Facts and constraints
Region us-east-1. Do not retry validation errors.
## Open questions
Should timeouts count as throttling?
## Key artefacts
src/bedrock.cjs — the client.
## Suggested next prompt
Write the retry wrapper with tests.`;
const temp = t => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'impromptu-context-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; };

test('packs parse front matter and the six hand-off sections, and reject non-packs', () => {
  const parsed = parsePack(pack);
  assert.deepEqual([parsed.title, parsed.source, parsed.model, parsed.missing.length], ['Bedrock retry logic', 'cursor', 'claude-opus-5.5', 0]);
  assert.equal(parsed.sections['Suggested next prompt'], 'Write the retry wrapper with tests.');
  assert.equal(parsed.sections['Decisions made'], 'Retry only on throttling, max 3 attempts.');
  assert.equal(parsePack('## Goal\nShip it\n## Open questions\nWhen?').source, 'other');
  assert.throws(() => parsePack('Just some chat text.'), /does not look like a context pack/);
  assert.throws(() => parsePack(pack.replace(FORMAT, 'other-format/9')), /Unsupported/);
  assert.throws(() => parsePack('x'.repeat(100001)), /under 100,000/);
});

test('likely secrets are redacted before a pack is stored', () => {
  const secrets = `key AKIAABCDEFGHIJKLMNOP and sk-proj-abcdefghijklmnopqrstuvwx and ghp_${'a'.repeat(36)}\npassword: hunter2hunter2\nAuthorization: Bearer abcdefghijklmnopqrstuvwxyz123456`;
  const result = redact(secrets);
  for (const leaked of ['AKIAABCDEFGHIJKLMNOP', 'sk-proj-abcdefghij', 'ghp_aaaa', 'hunter2hunter2', 'abcdefghijklmnopqrstuvwxyz123456']) assert.ok(!result.text.includes(leaked), leaked);
  assert.ok(result.findings.length >= 5);
  assert.deepEqual(redact('Nothing secret here.').findings, []);
});

test('the store saves privately, edits re-parse, and secrets never reach disk by default', t => {
  const file = path.join(temp(t), 'context-packs.json');
  const store = new PackStore(file);
  const saved = store.add(`${pack}\nToken: sk-ant-${'b'.repeat(30)}`, { origin: 'paste' });
  assert.deepEqual(saved.redacted, ['API key']);
  assert.ok(!fs.readFileSync(file, 'utf8').includes('sk-ant-'));
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(store.update(saved.id, pack.replace('Bedrock retry logic', 'Retry logic v2')).title, 'Retry logic v2');
  assert.equal(new PackStore(file).packs[0].title, 'Retry logic v2');
  assert.equal(store.delete(saved.id).length, 0);
});

test('inbox reads only plain pack files by name and archives them after import', t => {
  const dir = temp(t);
  fs.writeFileSync(path.join(dir, '2026-11-05-retry.md'), pack);
  fs.writeFileSync(path.join(dir, 'notes.pdf'), 'binary');
  assert.deepEqual(inboxFiles(dir).map(f => f.name), ['2026-11-05-retry.md']);
  assert.equal(readInboxFile(dir, '2026-11-05-retry.md'), pack);
  for (const name of ['../secret.md', '/etc/passwd', 'notes.pdf']) assert.throws(() => readInboxFile(dir, name), /Choose a pack file/);
  archiveInboxFile(dir, '2026-11-05-retry.md');
  assert.deepEqual(inboxFiles(dir), []);
  assert.equal(fs.readdirSync(path.join(dir, 'imported')).length, 1);
  assert.deepEqual(inboxFiles(path.join(dir, 'missing')), []);
});

test('the hand-off prompt and skill name the format, the inbox and the no-secrets rule', () => {
  const inbox = '/Users/me/Impromptu/Inbox';
  const prompt = handoffPrompt(inbox);
  assert.match(prompt, /format: impromptu-context-pack\/1/);
  assert.ok(prompt.includes(path.join(inbox, '<YYYY-MM-DD>-<short-title>.md')));
  assert.match(prompt, /Never include passwords, API keys/);
  assert.match(skillFile(inbox), /^---\nname: impromptu-handoff\ndescription: /);
});

test('a pack wrapped in chat prose and a code fence is extracted cleanly', () => {
  const { extractPack } = require('../src/context.cjs');
  const wrapped = `I can't write files here, so here is the pack:\n\n\`\`\`\`markdown\n${pack}\n\`\`\`\`\nLet me know if you need changes.`;
  assert.equal(extractPack(wrapped), pack);
  assert.equal(parsePack(wrapped).title, 'Bedrock retry logic');
});
