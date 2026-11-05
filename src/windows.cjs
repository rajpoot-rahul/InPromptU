'use strict';
// Windows helpers. PowerShell is called by absolute path so a powershell.exe earlier on PATH cannot be substituted.
const path = require('node:path');

function powershell(env = process.env) {
  return path.win32.join(env.SystemRoot || env.windir || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}
// A PSModulePath inherited from PowerShell 7 makes Windows PowerShell 5.1 load incompatible modules, so
// Get-AuthenticodeSignature silently fails. Without it, powershell.exe uses its own default module path.
function powershellEnv(env = process.env, extra = {}) {
  const clean = {};
  for (const [key, value] of Object.entries(env)) if (key.toLowerCase() !== 'psmodulepath') clean[key] = value;
  return { ...clean, ...extra };
}
// Splits an X.500 name as .NET prints it ("CN=Ollama Inc., O=Ollama Inc., ..."), honouring quoted values.
function parseDN(subject) {
  const fields = {}; let key = '', value = '', inKey = true, quoted = false;
  const commit = () => { const name = key.trim().toUpperCase(); if (name && !(name in fields)) fields[name] = value.trim(); key = ''; value = ''; inKey = true; };
  const text = String(subject || '');
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inKey) { if (char === '=') inKey = false; else if (char === ',' || char === '+') { key = ''; } else key += char; continue; }
    if (quoted) { if (char === '"' && text[i + 1] === '"') { value += '"'; i++; } else if (char === '"') quoted = false; else value += char; continue; }
    if (char === '"' && !value.trim()) quoted = true;
    else if (char === ',' || char === '+') commit();
    else value += char;
  }
  if (!inKey) commit();
  return fields;
}

module.exports = { powershell, powershellEnv, parseDN };
