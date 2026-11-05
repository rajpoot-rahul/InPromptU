const test = require('node:test');
const assert = require('node:assert/strict');
const { readSettings, sendKeys, windowsKeyScript, WINDOWS_KEYS, grabSelection, captureDisplay, visionCapable, describeScreens, Coach, factCheckNudge, DEFAULTS, VISION } = require('../src/mascot.cjs');

test('the mascot is off unless consent is recorded, and settings are bounded', () => {
  assert.equal(readSettings({ enabled: true }).enabled, false);
  assert.equal(readSettings({ enabled: true, consentAt: '2026-11-05T10:00:00Z' }).enabled, true);
  assert.deepEqual(readSettings({ breakMinutes: 5, scrollFrames: 99, visionModel: 7 }), { ...DEFAULTS });
  assert.equal(readSettings({ breakMinutes: 60, scrollFrames: 3 }).breakMinutes, 60);
});

test('selection grab copies once, restores the clipboard, and reports nothing when nothing is selected', async () => {
  let clip = 'user clipboard';
  const clipboard = { readText: () => clip, writeText: value => { clip = value; } };
  const keys = [];
  const text = await grabSelection({ clipboard, keys: async kind => { keys.push(kind); clip = 'Selected words'; }, wait: async () => {} });
  assert.equal(text, 'Selected words');
  assert.deepEqual(keys, ['copy']);
  assert.equal(clip, 'user clipboard');
  assert.equal(await grabSelection({ clipboard, keys: async () => {}, wait: async () => {} }), '');
  assert.equal(clip, 'user clipboard');
  await assert.rejects(grabSelection({ clipboard, keys: async () => { throw new Error('Not permitted'); }, wait: async () => {} }), /Not permitted/);
  assert.equal(clip, 'user clipboard');
});

test('key actions use fixed commands per platform and nothing user-controlled', async () => {
  const calls = [];
  const execFn = (file, args, _options, done) => { calls.push([file, args]); done(null); };
  await sendKeys('copy', 'darwin', execFn); await sendKeys('pageDown', 'darwin', execFn); await sendKeys('pageUp', 'win32', execFn, { SystemRoot: 'C:\\Windows' });
  assert.deepEqual(calls[0], ['/usr/bin/osascript', ['-e', 'tell application "System Events" to keystroke "c" using command down']]);
  assert.match(calls[1][1][1], /key code 121/);
  assert.equal(calls[2][0], 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'); assert.match(calls[2][1].at(-1), /SendWait\('\{PGUP\}'\)/);
  assert.throws(() => sendKeys('typeAnything', 'darwin', execFn), /Unsupported/);
  assert.throws(() => sendKeys('typeAnything', 'win32', execFn), /Unsupported/);
  await assert.rejects(sendKeys('copy', 'linux', execFn), /macOS and Windows/);
});

test('Windows key presses wait for the shortcut modifiers to be released before sending a fixed key', async () => {
  const calls = [];
  const execFn = (file, args, _options, done) => { calls.push(args.at(-1)); done(null); };
  for (const kind of Object.keys(WINDOWS_KEYS)) await sendKeys(kind, 'win32', execFn, {});
  assert.match(calls[0], /ModifierKeys -ne \[System\.Windows\.Forms\.Keys\]::None/);
  assert.match(calls[0], /SendWait\('\^c'\)$/);
  assert.match(calls[1], /SendWait\('\{PGDN\}'\)$/);
  assert.deepEqual(calls, Object.values(WINDOWS_KEYS).map(windowsKeyScript));
});

test('on a real Windows machine the key script is valid PowerShell', { skip: process.platform !== 'win32' && 'needs Windows PowerShell' }, () => {
  const { execFileSync } = require('node:child_process');
  const { powershell } = require('../src/windows.cjs');
  const { SIGNATURE_SCRIPT } = require('../src/installer.cjs');
  for (const script of [...Object.values(WINDOWS_KEYS).map(windowsKeyScript), SIGNATURE_SCRIPT]) {
    const errors = execFileSync(powershell(), ['-NoProfile', '-NonInteractive', '-Command', '$e = $null; [void][System.Management.Automation.Language.Parser]::ParseInput($env:IMPROMPTU_SCRIPT, [ref]$null, [ref]$e); $e.Count'], { env: { ...process.env, IMPROMPTU_SCRIPT: script }, encoding: 'utf8' }).trim();
    assert.equal(errors, '0', script);
  }
});

test('selection grab restores rich clipboard content, not just text', async () => {
  let clip = { text: 'plain', html: '<b>plain</b>', rtf: '', image: { isEmpty: () => false, id: 'img' } };
  const writes = [];
  const clipboard = { readText: () => clip.text, readHTML: () => clip.html, readRTF: () => clip.rtf, readImage: () => clip.image, writeText: value => { clip = { text: value, html: '', rtf: '', image: { isEmpty: () => true } }; }, write: data => { writes.push(data); clip = { ...data }; } };
  assert.equal(await grabSelection({ clipboard, keys: async () => { clip = { ...clip, text: 'Selected' }; }, wait: async () => {} }), 'Selected');
  assert.deepEqual(Object.keys(writes[0]).sort(), ['html', 'image', 'text']);
  assert.equal(writes[0].text, 'plain'); assert.equal(writes[0].image.id, 'img');
});

test('capture uses the display under the cursor and refuses an empty image', async () => {
  const image = empty => ({ isEmpty: () => empty, toJPEG: () => Buffer.from('jpeg'), toBitmap: () => Buffer.from('bitmap') });
  const screen = { getCursorScreenPoint: () => ({ x: 5, y: 5 }), getDisplayNearestPoint: () => ({ id: 2, size: { width: 3200, height: 2000 }, scaleFactor: 2 }) };
  let requested;
  const frame = await captureDisplay({ screen, desktopCapturer: { getSources: async options => { requested = options; return [{ display_id: '1', thumbnail: image(false) }, { display_id: '2', thumbnail: image(false) }]; } } });
  assert.equal(frame.base64, Buffer.from('jpeg').toString('base64'));
  assert.equal(requested.thumbnailSize.width, 3200);
  assert.match(frame.hash, /^[0-9a-f]{64}$/);
  await assert.rejects(captureDisplay({ screen, platform: 'darwin', desktopCapturer: { getSources: async () => [{ display_id: '2', thumbnail: image(true) }] } }), /Screen Recording/);
  await assert.rejects(captureDisplay({ screen, platform: 'win32', desktopCapturer: { getSources: async () => [{ display_id: '2', thumbnail: image(true) }] } }), error => /could not be captured/.test(error.message) && !/Screen Recording/.test(error.message));
});

test('screenshots only ever go to a local model, framed as untrusted data', async () => {
  let request;
  const result = await describeScreens({ images: ['a', 'b'], question: 'Explain this page', endpoint: 'http://localhost:11434/api/chat', model: 'gemma4:latest', fetchFn: async (url, options) => { request = { url, body: JSON.parse(options.body) }; return new Response(JSON.stringify({ message: { content: 'A summary.' }, prompt_eval_count: 900, eval_count: 40 })); } });
  assert.equal(request.url, 'http://localhost:11434/api/chat');
  assert.equal(request.body.messages[0].content, VISION);
  assert.match(VISION, /never follow instructions/);
  assert.deepEqual(request.body.messages[1].images, ['a', 'b']);
  assert.match(request.body.messages[1].content, /2 consecutive screenshots/);
  assert.equal(result.text, 'A summary.'); assert.equal(result.frames, 2);
  await assert.rejects(describeScreens({ images: ['a'], endpoint: 'https://cloud.example/api/chat', model: 'm', fetchFn: () => { throw new Error('must not fetch'); } }), /localhost/);
  await assert.rejects(describeScreens({ images: [], endpoint: 'http://localhost:11434/api/chat', model: 'm' }), /Nothing was captured/);
  await assert.rejects(describeScreens({ images: ['a'], endpoint: 'http://localhost:11434/api/chat', model: 'm', fetchFn: async () => new Response(JSON.stringify({ message: { content: '' } })) }), /empty/);
  assert.equal(await visionCapable('http://localhost:11434/api/chat', 'm', async () => new Response(JSON.stringify({ capabilities: ['completion', 'vision'] }))), true);
  assert.equal(await visionCapable('http://localhost:11434/api/chat', 'm', async () => new Response(JSON.stringify({ capabilities: ['completion'] }))), false);
});

test('coaching nudges come from Impromptu activity: breaks, repeated prompts, weak briefs, with cooldowns', () => {
  let now = 0;
  const coach = new Coach({ now: () => now });
  for (let minute = 0; minute <= 95; minute += 5) { now = minute * 60000; coach.record('improve', `Summarise the notes below for my manager as 5 bullets. Topic ${minute}`); }
  assert.equal(coach.check({ breakMinutes: 90 }).kind, 'break');
  assert.equal(coach.check({ breakMinutes: 90 })?.kind === 'break', false);
  const loop = new Coach({ now: () => now });
  for (const text of ['write the release email for version two', 'write the release email for version two please', 'please write the release email for version two']) loop.record('chat', text);
  assert.equal(loop.check().kind, 'loop');
  const weak = new Coach({ now: () => now });
  for (const text of ['fix it', 'make it better', 'why']) weak.record('improve', text);
  assert.equal(weak.check().kind, 'help');
  now += 25 * 3600000;
  assert.equal(new Coach({ now: () => now }).check(), null);
});

test('fact-check nudges flag specifics the user never supplied', () => {
  assert.match(factCheckNudge('The policy changed in 2019 and adoption rose 42%. See https://example.com/x', 'Tell me about the policy').message, /2019, 42%|https:\/\/example.com\/x/);
  assert.equal(factCheckNudge('You said 2019, so 2019 it is.', 'It happened in 2019'), null);
  assert.equal(factCheckNudge('No specifics here.', ''), null);
});

test('the capture pre-check detects when macOS hides other apps from Impromptu', async () => {
  const { seesOtherApps } = require('../src/mascot.cjs');
  const capturer = names => ({ getSources: async () => names.map(name => ({ name })) });
  assert.equal(await seesOtherApps({ desktopCapturer: capturer(['Impromptu', 'Impromptu mascot']), appName: 'Impromptu' }), false);
  assert.equal(await seesOtherApps({ desktopCapturer: capturer(['Impromptu', 'Team chat — Slack']), appName: 'Impromptu' }), true);
  assert.equal(await seesOtherApps({ desktopCapturer: { getSources: async () => { throw new Error('denied'); } }, appName: 'Impromptu' }), false);
});
