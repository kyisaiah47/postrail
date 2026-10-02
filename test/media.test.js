import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  renderCardSvg, writeCard, pngRenderer, MASTERS, validateSpecSheet, writeSpecSheet, cutPlan, renderCut, createStubProvider, SlotStillOwed,
} from '../src/index.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'postrail-media-'));
const has = (bin) => { try { execFileSync(bin, ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } };
const FFMPEG = has('ffmpeg') && has('ffprobe');

const SOURCE = [
  'Acme Parse turns an invoice into JSON fields.',
  'An invoice parse is $0.08 and a call is charged only when it succeeds.',
  'A long document can run as a job that calls a webhook when it finishes.',
].join('\n');

async function assets(n) {
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const item = await writeCard({ title: `Screen ${i + 1}`, body: 'A capture of the product.', size: 'landscape' }, { out: path.join(tmp, `shot-${i}`) });
    out.push(path.basename(item.path));
  }
  return out;
}

function shortsSheet(files) {
  return {
    master: 'shorts',
    title: 'Acme Parse in thirty seconds',
    caption: 'Acme Parse turns an invoice into JSON fields.',
    beats: {
      v0: { head: 'Acme Parse' },
      v1: { head: 'Acme Parse turns an invoice into JSON fields.', asset: files[0] },
      v2: { head: 'A call is charged only when it succeeds.', asset: files[1] },
      v3: { head: 'What a parse costs', table: [['Invoice parse', '$0.08']] },
      v4: { head: 'A long document runs as a job.', asset: files[2] },
      v5: { head: 'The job calls a webhook when it finishes.', asset: files[3] },
      v6: { head: 'Acme Parse' },
    },
    quotes: ['Acme Parse turns an invoice into JSON fields.'],
  };
}

test('a card is sentence-led SVG with escaped text and no tracked capital labels', () => {
  const svg = renderCardSvg({ title: 'Parse <invoices> & receipts', body: 'A call is charged only when it succeeds.', name: 'Acme Parse', url: 'https://acme.example' });
  assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="1200" height="675"/);
  assert.ok(svg.includes('Parse &lt;invoices&gt; &amp; receipts'));
  assert.ok(svg.includes('acme.example'));
  assert.ok(!/letter-spacing/.test(svg));
  for (const size of Object.keys({ og: 1, square: 1, portrait: 1, vertical: 1, wide: 1 })) assert.match(renderCardSvg({ title: 'x', size }), /<svg/);
});

test('a card renders to a PNG when a renderer is installed', async () => {
  const renderer = await pngRenderer();
  const item = await writeCard({ title: 'Acme Parse', body: 'A call is charged only when it succeeds.' }, { out: path.join(tmp, 'card') });
  assert.ok(fs.existsSync(`${path.join(tmp, 'card')}.svg`));
  if (renderer) {
    assert.equal(item.mime, 'image/png');
    assert.equal(fs.readFileSync(item.path).subarray(1, 4).toString(), 'PNG');
  } else {
    assert.equal(item.mime, 'image/svg+xml');
  }
});

test('the two masters hold their frame sizes and duration bands', () => {
  assert.deepEqual([MASTERS.shorts.width, MASTERS.shorts.height], [1080, 1920]);
  assert.deepEqual([MASTERS.longform.width, MASTERS.longform.height], [1920, 1080]);
  for (const m of Object.values(MASTERS)) {
    const total = m.beats.reduce((s, b) => s + b.seconds, 0);
    assert.ok(total >= m.durationSec.min && total <= m.durationSec.max, `${m.id} default beats run ${total}s`);
  }
});

test('a spec sheet is checked against its master and against the source', async () => {
  const files = await assets(4);
  const good = shortsSheet(files);
  assert.deepEqual(validateSpecSheet(good, { baseDir: tmp, sourceText: SOURCE }), []);

  const missing = structuredClone(good); delete missing.beats.v3;
  assert.match(validateSpecSheet(missing, { baseDir: tmp }).join(' '), /beat v3 \(table\) is missing/);

  const twice = structuredClone(good); twice.beats.v2.asset = files[0];
  assert.match(validateSpecSheet(twice, { baseDir: tmp }).join(' '), /same picture/);

  const long = structuredClone(good); long.beats.v1.seconds = 15; long.beats.v2.seconds = 15;
  assert.match(validateSpecSheet(long, { baseDir: tmp }).join(' '), /allows 21 to 35/);

  const invented = structuredClone(good); invented.beats.v3.table = [['Invoice parse', '$0.05']];
  assert.match(validateSpecSheet(invented, { baseDir: tmp, sourceText: SOURCE }).join(' '), /0\.05 is on screen but not in the source/);

  const misquoted = structuredClone(good); misquoted.quotes = ['Acme Parse is the fastest parser.'];
  assert.match(validateSpecSheet(misquoted, { baseDir: tmp, sourceText: SOURCE }).join(' '), /quote not found/);
});

test('the model writes the spec sheet at post time, and a sheet that never validates leaves the slot owed', async () => {
  const files = await assets(4);
  const subject = { id: 'acme', name: 'Acme Parse', facts: SOURCE.split('\n') };
  const provider = createStubProvider({ responses: ['not json at all', JSON.stringify(shortsSheet(files))] });
  const sheet = await writeSpecSheet({ provider, master: 'shorts', subject, assets: files, baseDir: tmp });
  assert.equal(sheet.beats.v1.asset, files[0]);
  assert.equal(provider.calls.length, 2);
  assert.match(provider.calls[1].prompt, /Your last sheet was refused/);
  const bad = createStubProvider({ respond: () => '{"master":"shorts","beats":{}}' });
  await assert.rejects(writeSpecSheet({ provider: bad, master: 'shorts', subject, assets: files, baseDir: tmp }), (e) => e instanceof SlotStillOwed);
});

test('a cut plan holds one segment per beat and a concat of all of them', async () => {
  const files = await assets(4);
  const plan = cutPlan(shortsSheet(files), { baseDir: tmp, workDir: path.join(tmp, 'work'), out: path.join(tmp, 'cut.mp4') });
  assert.equal(plan.segments.length, MASTERS.shorts.beats.length);
  assert.equal(plan.durationSec, 29.5);
  assert.ok(plan.segments.every((s) => s.args.includes('-t') && s.args.includes('libx264')));
  assert.deepEqual(plan.concatArgs.slice(0, 6), ['-y', '-f', 'concat', '-safe', '0', '-i']);
});

test('a shorts cut renders with ffmpeg at 1080 by 1920 inside its band', { skip: !FFMPEG && 'ffmpeg is not installed' }, async () => {
  if (!(await pngRenderer())) return;
  const files = await assets(4);
  const out = path.join(tmp, 'shorts.mp4');
  const plan = cutPlan(shortsSheet(files), { baseDir: tmp, workDir: path.join(tmp, 'work-real'), out, name: 'Acme Parse' });
  const res = await renderCut(plan);
  assert.equal(res.media.kind, 'video');
  const probe = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', out], { encoding: 'utf8' });
  const info = JSON.parse(probe);
  assert.equal(info.streams[0].width, 1080);
  assert.equal(info.streams[0].height, 1920);
  const d = Number(info.format.duration);
  assert.ok(d >= 21 && d <= 35, `duration ${d}`);
});
