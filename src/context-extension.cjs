'use strict';
const fs = require('node:fs');
const path = require('node:path');

const FILES = Object.freeze(['manifest.json', 'background.js', 'content.js', 'options.html', 'options.js', 'options.css']);

function prepareExtension(userData) {
  const source = path.join(__dirname, '..', 'extensions', 'chatgpt-context');
  const destination = path.join(userData, 'browser-extensions', 'chatgpt-context');
  // Electron reads these files inside app.asar; Chrome/Edge need an ordinary folder outside the app bundle.
  const files = FILES.map(name => [name, fs.readFileSync(path.join(source, name))]);
  fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
  for (const [name, content] of files) fs.writeFileSync(path.join(destination, name), content, { mode: 0o600 });
  return destination;
}

module.exports = { FILES, prepareExtension };
