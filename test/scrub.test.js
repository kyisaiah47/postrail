// The scrub gate. Every fixture that must trip it is built at runtime from pieces, so the source
// of this file never trips the gate itself.

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash, hashedFindings, patternFindings, tokenCandidates, scanTree } from '../scripts/scrub-gate.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const j = (...p) => p.join('');
const list = (o) => ({ token: new Set(o.token || []), email: new Set(o.email || []), phrase: new Set(o.phrase || []), path: new Set(o.path || []) });

test('a hashed handle is found as a mention, a path segment and a label, but not as a link host', () => {
  const hashed = list({ token: [hash('token', 'private.example'), hash('token', 'secret_handle')] });
  assert.equal(hashedFindings('follow @Secret_Handle today', hashed).length, 1);
  assert.equal(hashedFindings('https://social.example/profile/secret_handle', hashed).length, 1);
  assert.equal(hashedFindings('the account private.example posts daily', hashed).length, 1);
  assert.equal(hashedFindings('https://private.example and https://sub.private.example', hashed).length, 0);
  assert.equal(hashedFindings('write to hello@private.example', hashed).length, 0);
  assert.ok(tokenCandidates('secret_handle-bot').has('secret_handle'));
});

test('a hashed email prefix, name and home path are found', () => {
  const hashed = list({ email: [hash('email', 'someone.private@')], phrase: [hash('phrase', 'jane roe')], path: [hash('path', '/users/jroe')] });
  assert.equal(hashedFindings(j('mail ', 'someone.private', '@', 'gmail.com'), hashed).length, 1);
  assert.equal(hashedFindings('written by Jane Roe', hashed).length, 1);
  assert.equal(hashedFindings(j('/Users', '/jroe/code'), hashed).length, 1);
});

test('key shapes, disguise libraries, captcha services and webdriver overrides are refused', () => {
  const cases = [
    j('AKI', 'A', 'ABCDEFGHIJKLMNOP'),
    j('sk-', 'ant-', 'a'.repeat(30)),
    j('gh', 'p_', 'A'.repeat(36)),
    j('-----BEGIN RSA ', 'PRIVATE KEY-----'),
    j('ac', 'ct_', 'A1b2C3d4E5f6G7h8'),
    j('const token = "', 'q7Hf2LpX9tRz4WmK8vNc3BdY6sGj', '"'),
    j('import p from "puppeteer', '-extra-plugin-', 'stealth"'),
    j('npm i playwright', '-extra'),
    j('call the 2', 'captcha API'),
    j('captcha', ' solver'),
    j('Object.defineProperty(navigator, "web', 'driver", { get: () => false })'),
    j('--disable-blink-features=Automation', 'Controlled'),
  ];
  for (const c of cases) assert.ok(patternFindings(c).length >= 1, c);
  assert.equal(patternFindings('A captcha is a platform signal that stops the slot.').length, 0);
  assert.equal(patternFindings('navigator.webdriver stays true in this transport.').length, 0);
});

test('this repository passes its own scrub gate', () => {
  const { files, findings } = scanTree(ROOT);
  assert.ok(files > 20);
  assert.deepEqual(findings, []);
});
