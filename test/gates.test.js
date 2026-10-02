import test from 'node:test';
import assert from 'node:assert/strict';
import { checkCopy, patternHits, platformLength } from '../src/index.js';
import { config } from './fixtures.js';

const acct = config().accounts[0];
const gates = { noise: true, prose: true, dashes: true, repeats: true };

test('the noise list refuses filler and leaves a plain sentence alone', () => {
  for (const [text, slug] of [
    ['To be honest, the second option is better.', 'honesty-preface'],
    ['That said, the tool works.', 'that-said'],
    ['It is designed to help teams ship faster.', 'designed-to'],
    ['Say goodbye to manual entry.', 'say-goodbye'],
    ['Introducing Acme Parse.', 'announcement'],
  ]) {
    assert.deepEqual(patternHits(text, 'noise').map((h) => h.slug), [slug], text);
  }
  assert.deepEqual(checkCopy('Acme Parse turns an invoice into JSON fields.', { account: acct, gates }), []);
});

test('the prose list refuses a caption in place of a sentence, a label line and a modifier tail', () => {
  assert.ok(patternHits('A four-minute walkthrough of the desk: https://example.com/demo', 'prose').some((h) => h.slug === 'caption-link'));
  assert.deepEqual(patternHits('Here is a demo video: https://example.com/demo', 'prose'), []);
  assert.ok(patternHits('Our pricing:\nYou pay per call.', 'prose').some((h) => h.slug === 'label-not-sentence'));
  assert.ok(patternHits('Four boards, recounted every night', 'prose').some((h) => h.slug === 'naming-participial-tail'));
});

test('each gate can be switched off in copyGates', () => {
  const text = 'Introducing Acme Parse — it reads invoices.';
  assert.equal(checkCopy(text, { account: acct, gates }).length, 2);
  assert.deepEqual(checkCopy(text, { account: acct, gates: { noise: false, prose: false, dashes: false } }), []);
});

test('length is counted the way each platform counts it', () => {
  assert.equal(platformLength('\u{1F44B}\u{1F3FD} hi', 'graphemes'), 4);
  const url = 'https://example.com/a/very/long/path/that/is/longer/than/twenty-three/characters';
  assert.equal(platformLength(`hi ${url}`, 'x'), 3 + 23);
  const x = config({}, [{ id: 'x1', platform: 'x', handle: '@example_x', transport: { kind: 'dry' }, cadence: { perDay: 1 } }]).accounts[0];
  const long = `${'a'.repeat(249)}. ${url}`;
  assert.equal(checkCopy(long, { account: x, gates: {} }).length, 0);
  assert.match(checkCopy(`${'a'.repeat(269)}. ${url}`, { account: x, gates: {} })[0].reason, /allows 280/);
});

test('a link in a no-link slot, a hashtag on a no-hashtag account, and a repeat are refused', () => {
  assert.equal(checkCopy('The guide is online. https://example.com', { account: acct, allowLink: false, gates })[0].gate, 'link');
  assert.equal(checkCopy('Acme Parse reads invoices. #api', { account: acct, gates })[0].gate, 'hashtag');
  const prev = 'Acme Parse turns an invoice into JSON fields your code can read.';
  assert.equal(checkCopy('Acme Parse turns an invoice into JSON fields your code reads.', { account: acct, gates, recent: [prev] })[0].gate, 'repeat');
  assert.match(checkCopy('Acme Parse turns an invoice into JSON fields your code reads.', { account: acct, gates, others: [prev] })[0].reason, /another of your accounts/);
});

test('a draft that stops in the middle of a sentence is refused', () => {
  assert.equal(checkCopy('Every endpoint has a flat price. You pay $0.08 for', { account: acct, gates })[0].gate, 'unfinished');
  assert.deepEqual(checkCopy('Every endpoint has a flat price. https://acme.example', { account: acct, gates }), []);
  // Two real drafts from a Gemini model on 2026-10-02. Each ends on a link and is a whole sentence.
  assert.deepEqual(checkCopy('Acme Parse turns an invoice into JSON fields. A call is charged only when it succeeds. You can test it at https://acme.example.', { account: acct, gates }), []);
  assert.deepEqual(checkCopy('Acme Parse turns an invoice into JSON fields. You can parse documents with Acme Parse at https://acme.example', { account: acct, gates }), []);
  assert.equal(checkCopy('Acme Parse reads invoices. You pay $0.08 for #api', { account: acct, gates: { ...gates }, recent: [] }).some((r) => r.gate === 'unfinished'), true);
});
