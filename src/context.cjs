'use strict';
// Context Packs: compact hand-offs from any AI session. Imported only on explicit request and stored locally.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { textStats } = require('./engine.cjs');

const FORMAT = 'impromptu-context-pack/1';
const LIMITS = { packs: 50, text: 100000, file: 300000, inboxFiles: 50 };
const SECTIONS = ['Goal', 'Decisions made', 'Facts and constraints', 'Open questions', 'Key artefacts', 'Suggested next prompt'];
const SOURCES = ['cursor', 'claude', 'claude-code', 'chatgpt', 'codex', 'copilot', 'gemini', 'other'];

const SECRET_PATTERNS = [
  ['Private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g],
  ['AWS access key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g],
  ['API key', /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}\b/g],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g],
  ['Bearer token', /\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/g],
  ['JWT', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g],
  ['Password', /\b(password|passwd|pwd|secret|api[_-]?key|token)\s*[:=]\s*["']?(?!\[REDACTED)[^\s"']{6,}/gi]
];
function redact(text) {
  const findings = []; let value = String(text);
  for (const [kind, pattern] of SECRET_PATTERNS) {
    value = value.replace(pattern, match => { findings.push({ kind, preview: `${match.slice(0, 4)}…` }); return `[REDACTED ${kind.toUpperCase()}]`; });
  }
  return { text: value, findings };
}

function frontMatter(text) {
  const match = String(text).match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { meta: {}, body: String(text) };
  const meta = {};
  for (const line of match[1].split(/\r?\n/)) {
    const pair = line.match(/^([A-Za-z][\w-]{0,30}):\s*(.*)$/);
    if (pair) meta[pair[1].toLowerCase()] = pair[2].replace(/^["']|["']$/g, '').trim().slice(0, 200);
  }
  return { meta, body: String(text).slice(match[0].length) };
}
function sections(body) {
  const found = {};
  const parts = body.split(/^##\s+/m).slice(1);
  for (const part of parts) {
    const [heading, ...rest] = part.split('\n');
    const name = SECTIONS.find(s => heading.trim().toLowerCase().startsWith(s.toLowerCase().split(' ')[0]));
    if (name) found[name] = rest.join('\n').trim();
  }
  return found;
}
// Chat models often wrap the pack in prose or a code fence; keep only the pack itself.
function extractPack(raw) {
  const text = String(raw).replace(/\r\n/g, '\n');
  const start = text.search(/^---[ \t]*\nformat:/m);
  if (start === -1) return text.trim();
  const rest = text.slice(start);
  const fence = rest.search(/^`{3,}[ \t]*$/m);
  return (fence === -1 ? rest : rest.slice(0, fence)).trim();
}
function parsePack(raw, { fileName = '' } = {}) {
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('This context pack is empty.');
  if (raw.length > LIMITS.text) throw new Error(`Context packs must be under ${LIMITS.text.toLocaleString()} characters. Ask the source model for a shorter hand-off.`);
  const { meta, body } = frontMatter(extractPack(raw));
  const found = sections(body);
  if (meta.format && meta.format !== FORMAT) throw new Error(`Unsupported context pack format “${meta.format}”.`);
  if (!meta.format && Object.keys(found).length < 2) throw new Error('This does not look like a context pack. It needs the hand-off sections (Goal, Decisions made, …). Use the hand-off prompt to create one.');
  const title = (meta.title || body.match(/^#\s+(.+)$/m)?.[1] || path.basename(fileName, path.extname(fileName)) || found.Goal?.split('\n')[0] || 'Untitled context').slice(0, 120);
  const source = SOURCES.includes(String(meta.source || '').toLowerCase()) ? meta.source.toLowerCase() : 'other';
  return { title, source, model: (meta.model || '').slice(0, 80), created: Number.isNaN(Date.parse(meta.created)) ? '' : new Date(meta.created).toISOString(), sections: found, missing: SECTIONS.filter(s => !found[s]) };
}

class PackStore {
  constructor(file) { this.file = file; this.packs = this.load(); }
  load() {
    try { const data = JSON.parse(fs.readFileSync(this.file, 'utf8')); return (Array.isArray(data.packs) ? data.packs : []).filter(p => p && typeof p.id === 'string' && typeof p.text === 'string').slice(0, LIMITS.packs); } catch { return []; }
  }
  persist() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, packs: this.packs }, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }
  add(raw, { origin = 'paste', fileName = '', redactSecrets = true } = {}) {
    const extracted = extractPack(raw);
    parsePack(extracted, { fileName });
    const cleaned = redactSecrets ? redact(extracted) : { text: extracted, findings: [] };
    const parsed = parsePack(cleaned.text, { fileName });
    if (this.packs.length >= LIMITS.packs) throw new Error(`You can keep up to ${LIMITS.packs} context packs. Delete one first.`);
    const pack = { id: crypto.randomUUID(), ...parsed, text: cleaned.text.trim(), redacted: cleaned.findings.map(f => f.kind), origin, fileName: path.basename(fileName).slice(0, 200), importedAt: new Date().toISOString(), stats: textStats(cleaned.text) };
    this.packs = [pack, ...this.packs]; this.persist(); return pack;
  }
  get(id) { const pack = this.packs.find(p => p.id === id); if (!pack) throw new Error('This context pack no longer exists.'); return pack; }
  update(id, text) {
    const pack = this.get(id);
    const cleaned = redact(extractPack(text));
    const parsed = parsePack(cleaned.text);
    Object.assign(pack, parsed, { text: cleaned.text.trim(), redacted: [...new Set([...(pack.redacted || []), ...cleaned.findings.map(f => f.kind)])], stats: textStats(cleaned.text), editedAt: new Date().toISOString() });
    this.persist(); return pack;
  }
  delete(id) { this.packs = this.packs.filter(p => p.id !== id); this.persist(); return this.summaries(); }
  summaries() { return this.packs.map(({ id, title, source, model, created, importedAt, stats, redacted, missing, origin }) => ({ id, title, source, model, created, importedAt, stats, redacted, missing, origin })); }
}

function inboxFiles(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter(entry => entry.isFile() && /\.(md|markdown|txt)$/i.test(entry.name))
      .map(entry => { const file = path.join(dir, entry.name); const stat = fs.statSync(file); return { name: entry.name, size: stat.size, modified: stat.mtime.toISOString() }; })
      .sort((a, b) => b.modified.localeCompare(a.modified)).slice(0, LIMITS.inboxFiles);
  } catch { return []; }
}
function readInboxFile(dir, name) {
  if (typeof name !== 'string' || name !== path.basename(name) || !/\.(md|markdown|txt)$/i.test(name)) throw new Error('Choose a pack file from the inbox.');
  const file = path.join(dir, name);
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size > LIMITS.file) throw new Error('This file is too large to be a context pack.');
  return fs.readFileSync(file, 'utf8');
}
function archiveInboxFile(dir, name) {
  const done = path.join(dir, 'imported');
  fs.mkdirSync(done, { recursive: true });
  const target = path.join(done, `${new Date().toISOString().slice(0, 10)}-${name}`);
  fs.renameSync(path.join(dir, name), fs.existsSync(target) ? `${target}.${Date.now()}` : target);
}

function handoffPrompt(inbox) {
  return `Create an Impromptu Context Pack: a compact hand-off of this whole session so I can continue elsewhere with fewer tokens.

Rules:
- Use only what is in this session. Do not invent facts, results or decisions.
- Be concise: aim for under 800 words. Keep exact names, numbers, file paths, identifiers and constraints.
- Never include passwords, API keys, tokens or other secrets; write [secret omitted] instead.
- Output Markdown in exactly this format:

---
format: ${FORMAT}
source: <cursor | claude | claude-code | chatgpt | codex | copilot | gemini | other>
model: <the model you are>
title: <short title of the work>
created: <current date and time, ISO 8601>
---
## Goal
## Decisions made
## Facts and constraints
## Open questions
## Key artefacts
(files, code snippets, links, with one line each on why they matter)
## Suggested next prompt
(the single best next prompt to continue this work)

If you can write files, save it as ${path.join(inbox, '<YYYY-MM-DD>-<short-title>.md')} and tell me the path. Otherwise, print it in one Markdown block so I can copy it into Impromptu.`;
}
function skillFile(inbox) {
  return `---
name: impromptu-handoff
description: Create an Impromptu Context Pack, a compact hand-off of the current session saved to the Impromptu inbox. Use when the user asks to hand off, export, share or save this session's context to Impromptu.
---

# Impromptu hand-off

${handoffPrompt(inbox)}
`;
}

module.exports = { FORMAT, LIMITS, SECTIONS, SOURCES, redact, extractPack, parsePack, PackStore, inboxFiles, readInboxFile, archiveInboxFile, handoffPrompt, skillFile };
