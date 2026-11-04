'use strict';
// The official local app-server owns authentication. Never read or copy its tokens.
const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { StringDecoder } = require('node:string_decoder');

function findCodex(preferred = '') {
  const name = process.platform === 'win32' ? 'codex.exe' : 'codex';
  const candidates = [preferred,
    '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex',
    '/Applications/Codex.app/Contents/Resources/codex',
    ...String(process.env.PATH || '').split(path.delimiter).map(dir => path.join(dir, name)),
    path.join(os.homedir(), '.local/bin', name), '/opt/homebrew/bin/codex', '/usr/local/bin/codex'];
  return candidates.find(file => { try { return file && fs.statSync(file).isFile(); } catch { return false; } }) || '';
}

class CodexClient extends EventEmitter {
  constructor({ executable, cwd, spawnFn = spawn } = {}) {
    super(); this.executable = executable; this.cwd = cwd; this.spawnFn = spawnFn;
    this.nextId = 0; this.pending = new Map(); this.child = null; this.starting = null;
  }
  async start() {
    if (this.starting) return this.starting;
    this.starting = this._start().catch(error => { this.close(); throw error; });
    return this.starting;
  }
  async _start() {
    const executable = findCodex(this.executable);
    if (!executable) throw new Error('Codex was not found. Install and sign in to Codex, or choose its executable in Knowledge settings.');
    const args = ['app-server', '--stdio', '-c', 'features.hooks=false', '-c', 'features.shell_tool=false'];
    const child = this.spawnFn(executable, args, { cwd: this.cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child = child;
    let buffer = ''; const decoder = new StringDecoder('utf8');
    child.stderr.on('data', () => {}); // No auth details or document contents in application logs.
    child.stdin.on('error', () => { if (this.child === child) this.fail(new Error('The Codex connection closed. Reconnect and try again.')); });
    child.on('error', () => { if (this.child === child) this.fail(new Error('Could not start Codex. Check its executable and sign-in.')); });
    child.on('exit', () => { if (this.child !== child) return; this.child = null; this.starting = null; this.fail(new Error('Codex disconnected. Reconnect and try again.')); this.emit('disconnected'); });
    child.stdout.on('data', bytes => {
      if (this.child !== child) return;
      buffer += decoder.write(bytes);
      if (buffer.length > 12_000_000) { this.fail(new Error('Codex returned too much data.')); this.close(); return; }
      let newline;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        let message; try { message = JSON.parse(line); } catch { continue; }
        if (message.method && message.id !== undefined) {
          // This app has no write approval or interactive tool pathway. Fail closed.
          const result = message.method === 'mcpServer/elicitation/request' ? { action: 'decline', content: null }
            : /requestApproval$/.test(message.method) ? { decision: 'decline' }
              : message.method === 'tool/requestUserInput' ? { answers: {} } : null;
          this.send(result ? { id: message.id, result } : { id: message.id, error: { code: -32601, message: 'Impromptu does not permit this operation.' } });
          this.emit('blocked-request', message.method);
        } else if (message.id !== undefined) {
          const pending = this.pending.get(message.id);
          if (!pending) continue;
          clearTimeout(pending.timer); this.pending.delete(message.id);
          if (message.error) pending.reject(new Error(`Codex ${pending.method} failed: ${String(message.error.message || 'Request rejected').slice(0, 500)}`));
          else pending.resolve(message.result);
        } else if (message.method) this.emit('notification', message.method, message.params);
      }
    });
    await this.request('initialize', { clientInfo: { name: 'impromptu', version: '0.2.0' }, capabilities: { experimentalApi: true, explicitGatewayOauth: true } }, 20000);
    this.send({ method: 'initialized' });
    return this;
  }
  send(message) { if (this.child?.stdin.writable) this.child.stdin.write(`${JSON.stringify(message)}\n`); }
  request(method, params = {}, timeout = 60000) {
    if (!this.child?.stdin.writable) return Promise.reject(new Error('Codex is not connected.'));
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Codex ${method} timed out. Try again.`)); }, timeout);
      this.pending.set(id, { resolve, reject, timer, method }); this.send({ id, method, params });
    });
  }
  fail(error) { for (const { reject, timer } of this.pending.values()) { clearTimeout(timer); reject(error); } this.pending.clear(); }
  close() { this.child?.stdin.end(); this.fail(new Error('Codex connection closed.')); this.child = null; this.starting = null; this.emit('disconnected'); }
}

module.exports = { CodexClient, findCodex };
