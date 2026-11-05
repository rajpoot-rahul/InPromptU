'use strict';
const http = require('node:http');
const crypto = require('node:crypto');
const MAX_BODY = 512000;
class ContextBridge {
  constructor({ receive, onChange = () => {} }) { this.receive = receive; this.onChange = onChange; this.server = null; this.token = ''; this.port = 0; this.starting = null; }
  status() { return { enabled: Boolean(this.port), port: this.port }; }
  pairing() { return this.port ? `impromptu:${this.port}:${this.token}` : ''; }
  async start() {
    if (this.starting) return this.starting;
    if (this.server) return this.status();
    this.token = crypto.randomBytes(32).toString('hex');
    const server = http.createServer((req, res) => this.handle(req, res)); this.server = server;
    server.requestTimeout = 5000; server.headersTimeout = 5000; server.maxConnections = 8;
    this.starting = new Promise((resolve, reject) => {
      server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
    }).then(() => {
      if (this.server === server) { this.port = server.address().port; this.onChange(); }
      return this.status();
    }).catch(error => { if (this.server === server) this.stop(); throw error; }).finally(() => { this.starting = null; });
    return this.starting;
  }
  handle(req, res) {
    const end = (code, value) => { req.resume(); res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Connection: 'close' }); res.end(JSON.stringify(value)); };
    // No web-page origins, CORS allowance, read endpoint or network bind beyond loopback.
    if (req.headers.host !== `127.0.0.1:${this.port}` || (req.headers.origin && !/^chrome-extension:\/\/[a-p]{32}$/.test(req.headers.origin))) return end(403, { error: 'Forbidden' });
    const provided = Buffer.from(req.headers.authorization || ''); const expected = Buffer.from(`Bearer ${this.token}`);
    if (!this.token || provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) return end(401, { error: 'Pair the extension again.' });
    if (req.method !== 'POST' || !['/context', '/ping'].includes(req.url) || req.headers['content-type'] !== 'application/json') return end(400, { error: 'Invalid request' });
    if (Number(req.headers['content-length']) > MAX_BODY) return end(413, { error: 'Too much content' });
    const chunks = []; let size = 0, rejected = false;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY) { if (!rejected) end(413, { error: 'Too much content' }); rejected = true; chunks.length = 0; }
      else if (!rejected) chunks.push(chunk);
    });
    req.on('error', () => { if (!res.writableEnded) end(400, { error: 'Incomplete request' }); });
    req.on('end', () => {
      if (rejected || res.writableEnded) return;
      try {
        const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        end(200, req.url === '/ping' ? { connected: true } : this.receive(payload));
      } catch { end(400, { error: 'Invalid conversation payload' }); }
    });
  }
  stop() {
    const server = this.server; this.server = null; this.port = 0; this.token = '';
    server?.close(); server?.closeAllConnections(); this.onChange();
  }
}
module.exports = { ContextBridge, MAX_BODY };
