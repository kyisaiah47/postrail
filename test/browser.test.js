// The browser transport against a fake platform served on localhost. It types, attaches, clicks
// and reads back, and it stops on a captcha page and on a sign-in wall. Skipped when Playwright's
// Chromium is not installed.

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createBrowserTransport, PlatformSignal } from '../src/index.js';
import { launchSafe } from '../src/transports/browser.js';

let pw = null;
try {
  pw = await import('playwright');
  const b = await pw.chromium.launch({ args: ['--mute-audio'] });
  await b.close();
} catch { pw = null; }

const posts = [];
const page = (body) => `<!doctype html><html><body>${body}</body></html>`;
const composer = (who) => page(`
  <span class="who">${who}</span>
  <form id="f"><textarea id="t"></textarea><input type="file" id="file" multiple><button id="go" type="button">Post</button></form>
  <script>
    document.getElementById('go').addEventListener('click', async () => {
      const files = [...document.getElementById('file').files].map((f) => f.name);
      await fetch('/api/post', { method: 'POST', body: JSON.stringify({ text: document.getElementById('t').value, files }) });
      location.href = '/done';
    });
  </script>`);

const server = http.createServer((req, res) => {
  const send = (html, status = 200) => { res.writeHead(status, { 'content-type': 'text/html' }); res.end(html); };
  if (req.url === '/compose') return send(composer('example_handle'));
  if (req.url === '/compose-other') return send(composer('someone_else'));
  if (req.url === '/compose-captcha') return send(page('<p>Please verify you are human before you continue.</p>'));
  if (req.url === '/compose-out') { res.writeHead(302, { location: '/login' }); return res.end(); }
  if (req.url === '/login') return send(page('<form><input name="user"></form>'));
  if (req.url === '/done') return send(page('<p>Posted.</p>'));
  if (req.url === '/profile') return send(page(posts.map((p, i) => `<article><a class="permalink" href="/p/${i}">link</a><p>${p.text}</p></article>`).join('')));
  if (req.url === '/links') return send(page('<a id="mail" href="mailto:hello@example.com">mail</a>'));
  if (req.url === '/api/post' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => { posts.push(JSON.parse(body)); res.end('{}'); });
    return undefined;
  }
  return send('not found', 404);
});

const skip = !pw && 'Playwright Chromium is not installed';
let base = '';
const before = async () => { await new Promise((r) => server.listen(0, '127.0.0.1', r)); base = `http://127.0.0.1:${server.address().port}`; };

function acct(composeUrl, extra = {}) {
  return {
    id: 'example-site', platform: 'other', handle: 'example_handle',
    transport: {
      kind: 'browser', userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'postrail-profile-')),
      recipe: { composeUrl, textbox: '#t', fileInput: '#file', submit: '#go', identity: '.who', loginUrl: '/login', profileUrl: `${base}/profile`, permalink: 'article:last-of-type a.permalink', settleMs: 300, ...extra },
    },
  };
}

test('browser transport', { skip }, async (t) => {
  await before();
  const img = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'postrail-b-')), 'card.png');
  fs.writeFileSync(img, Buffer.from('89504e470d0a1a0a', 'hex'));

  await t.test('a dry run fills the composer and attaches media without clicking', async () => {
    const tr = createBrowserTransport(acct(`${base}/compose`), { dryRun: true });
    const res = await tr.post({ text: 'A dry post.', media: [{ path: img, kind: 'image' }] });
    assert.equal(res.dry, true);
    assert.equal(res.filled, true);
    assert.equal(posts.length, 0);
  });

  await t.test('a real run types, attaches, clicks and reads the post back from the profile', async () => {
    const tr = createBrowserTransport(acct(`${base}/compose`));
    const res = await tr.post({ text: 'A post from the browser transport.', media: [{ path: img, kind: 'image' }] });
    assert.equal(posts.length, 1);
    assert.equal(posts[0].text, 'A post from the browser transport.');
    assert.deepEqual(posts[0].files, ['card.png']);
    assert.equal(res.verified, true);
    assert.match(res.url, /\/p\/0$/);
  });

  await t.test('a captcha page is a platform signal', async () => {
    const tr = createBrowserTransport(acct(`${base}/compose-captcha`));
    await assert.rejects(tr.post({ text: 'x' }), (e) => e instanceof PlatformSignal && e.platformSignal === 'captcha');
  });

  await t.test('a sign-in wall is a platform signal', async () => {
    const tr = createBrowserTransport(acct(`${base}/compose-out`));
    await assert.rejects(tr.post({ text: 'x' }), (e) => e instanceof PlatformSignal && e.platformSignal === 'signed-out');
  });

  await t.test('the wrong account on the page is an identity mismatch', async () => {
    const tr = createBrowserTransport(acct(`${base}/compose-other`));
    await assert.rejects(tr.post({ text: 'x' }), (e) => e instanceof PlatformSignal && e.platformSignal === 'identity-mismatch');
    assert.equal(posts.length, 1);
  });

  await t.test('launchSafe cancels a click on a mail link and records it', async () => {
    const ctx = await launchSafe(pw, fs.mkdtempSync(path.join(os.tmpdir(), 'postrail-safe-')));
    try {
      const p = ctx.pages()[0] || await ctx.newPage();
      await p.goto(`${base}/links`);
      await p.click('#mail');
      assert.deepEqual(await p.evaluate(() => window.__blockedExternalHrefs), ['mailto:hello@example.com']);
    } finally {
      await ctx.close();
    }
  });

  server.close();
});
