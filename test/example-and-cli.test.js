import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runExample } from '../examples/parserail-card/run.mjs';
import { main } from '../src/cli.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXAMPLE = path.join(ROOT, 'examples/parserail-card/postrail.config.json');

test('the worked example posts a card from every synthetic account to the dry transport', async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'postrail-ex-'));
  const { res, outbox } = await runExample({ outDir, log: () => {} });
  assert.equal(res.exitCode, 0);
  assert.equal(res.results.length, 3);
  assert.ok(res.results.every((r) => r.status === 'posted' && r.form === 'card'));
  const pitch = res.results.find((r) => r.accountId === 'example-linkedin');
  assert.equal(pitch.attempts, 2, 'the first pitch carries filler and is refused');
  assert.equal(outbox.length, 3);
  for (const o of outbox) {
    assert.equal(o.media.length, 1);
    assert.ok(fs.existsSync(o.media[0].path));
  }
  assert.equal(new Set(outbox.map((o) => o.text)).size, 3, 'no two accounts post the same text');
});

test('the CLI validates, plans and runs a dry tick', async () => {
  const lines = [];
  const out = (s) => lines.push(s);
  assert.equal(await main(['validate', '--config', EXAMPLE], { stdout: out }), 0);
  assert.match(lines.join('\n'), /ok: 3 account\(s\)/);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'postrail-cli-'));
  const cfg = JSON.parse(fs.readFileSync(EXAMPLE, 'utf8'));
  cfg.provider = { kind: 'stub', responses: ['ParseRail sends back the fields of a document as JSON. https://parserail.thecompound.tech'] };
  cfg.accounts = cfg.accounts.slice(0, 1).map((a) => ({ ...a, mix: { pitch: 1 }, media: { default: { none: 1 } } }));
  const file = path.join(dir, 'postrail.config.json');
  fs.writeFileSync(file, JSON.stringify(cfg));

  lines.length = 0;
  assert.equal(await main(['plan', '--config', file, '--date', '2026-10-05'], { stdout: out }), 0);
  assert.match(lines[0], /example-bluesky \(bluesky example\.bsky\.social\): 3 slot\(s\) on 2026-10-05/);

  lines.length = 0;
  const code = await main(['run', '--dry', '--config', file, '--at', '2026-10-05T21:00:00Z'], { stdout: out });
  assert.equal(code, 0);
  assert.match(lines.join('\n'), /example-bluesky: posted dry:\/\/bluesky\/example\.bsky\.social\/1/);
  assert.ok(fs.existsSync(path.join(dir, '.postrail', 'ledger.jsonl')));

  lines.length = 0;
  assert.equal(await main(['review', '--config', file, '--list', '--days', '3650'], { stdout: out }), 0);
  assert.match(lines.join('\n'), /ParseRail sends back the fields/);
});
