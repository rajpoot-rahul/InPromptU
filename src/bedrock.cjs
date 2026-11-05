'use strict';
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
function profileName(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(value)) throw new Error('Enter your configured AWS SSO profile name (letters, numbers, dots, hyphens or underscores).');
  return value;
}
function signIn(profile, spawnFn = spawn) {
  profileName(profile);
  const executable = ['/opt/homebrew/bin/aws', '/usr/local/bin/aws', ...String(process.env.PATH || '').split(path.delimiter).map(dir => path.join(dir, process.platform === 'win32' ? 'aws.exe' : 'aws'))].find(file => { try { return fs.statSync(file).isFile(); } catch { return false; } });
  if (!executable) throw new Error('Install AWS CLI v2 and configure an SSO profile with aws configure sso, then try again.');
  return new Promise((resolve, reject) => {
    const child = spawnFn(executable, ['sso', 'login', '--profile', profile], { shell: false, windowsHide: true, stdio: 'ignore' });
    const timer = setTimeout(() => { child.kill(); reject(new Error('AWS sign-in timed out. Try again.')); }, 180000);
    child.on('error', () => { clearTimeout(timer); reject(new Error('Could not start AWS CLI. Check its installation.')); });
    child.on('exit', code => { clearTimeout(timer); code === 0 ? resolve({ message: 'AWS SSO signed in. Test AI connection to verify Bedrock model access.' }) : reject(new Error('AWS SSO login did not complete. Check your profile with aws configure sso and retry.')); });
  });
}
async function converse(config, messages, dependencies) {
  const { BedrockRuntimeClient, ConverseCommand } = dependencies || require('@aws-sdk/client-bedrock-runtime');
  const fromSSO = dependencies?.fromSSO || require('@aws-sdk/credential-providers').fromSSO;
  const client = new BedrockRuntimeClient({ region: config.region, credentials: fromSSO({ profile: config.profile }), maxAttempts: 1 });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000);
  try {
    const response = await client.send(new ConverseCommand({ modelId: config.model, system: [{ text: messages[0].content }], messages: [{ role: 'user', content: [{ text: messages[1].content }] }], inferenceConfig: { maxTokens: 4096 } }), { abortSignal: controller.signal });
    if (response.stopReason !== 'end_turn') throw new Error('Bedrock did not finish a complete response. Try a shorter prompt or check the selected model.');
    return { content: (response.output?.message?.content || []).map(part => part.text || '').join(''), usage: response.usage };
  } catch (error) {
    if (controller.signal.aborted) throw new Error('Bedrock took longer than 90 seconds. Try again with a shorter prompt.');
    const messages = { CredentialsProviderError: 'AWS SSO credentials are missing or expired. Sign in with AWS SSO again.', AccessDeniedException: 'AWS denied model access. Check your SSO role, Bedrock permissions and Claude model availability.', ValidationException: 'Check the AWS region and exact Bedrock model ID or inference profile ID.', ThrottlingException: 'AWS Bedrock quota reached. Wait before trying again.' };
    if (messages[error.name]) throw new Error(messages[error.name]);
    throw new Error('Bedrock request failed. Check AWS sign-in, region, model access and whether the response completed.');
  } finally { clearTimeout(timer); client.destroy(); }
}
module.exports = { profileName, signIn, converse };
