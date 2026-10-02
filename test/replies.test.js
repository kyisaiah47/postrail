import test from 'node:test';
import assert from 'node:assert/strict';
import { createReplyGuard, createMemoryStore, createStubProvider, createDryTransport, runReplies, rootKey } from '../src/index.js';
import { config, account } from './fixtures.js';

const H = 3600000;
const T0 = Date.parse('2026-10-05T14:00:00Z');
const two = [account('alpha'), account('beta')];
const on = (extra = {}) => config({ replies: { enabled: true, ...extra } }, two);

function reply(store, { accountId, author, text, root, ts, promo = false }) {
  store.append({ ts, kind: 'reply', accountId, platform: 'bluesky', author, threadRoot: root, text, promo });
}

test('replies are off by default, and the reply pass sends nothing', async () => {
  const cfg = config({}, two);
  assert.equal(cfg.replies.enabled, false);
  const store = createMemoryStore();
  const guard = createReplyGuard({ config: cfg, store });
  const c = guard.candidate(cfg.accounts[0], { author: 'someone', uri: 'at://x/app.bsky.feed.post/1' });
  assert.equal(c.ok, false);
  assert.match(c.reasons[0], /Replies are off/);
  const res = await runReplies({ config: cfg, store, provider: createStubProvider({ responses: ['hi'] }), account: cfg.accounts[0], candidates: [{ author: 'someone', text: 'a post', uri: 'at://x/1' }] });
  assert.equal(res.status, 'off');
  assert.equal(store.rows({}).length, 0);
});

test('the author cooldown defaults to 168 hours and refuses a second reply inside it, from any account', () => {
  const cfg = on();
  assert.equal(cfg.replies.authorCooldownH, 168);
  const store = createMemoryStore();
  reply(store, { accountId: 'alpha', author: 'carol', text: 'Caching the parsed fields saves the second call.', root: 'bluesky:at://carol/app.bsky.feed.post/1', ts: T0 });
  const at = (h) => createReplyGuard({ config: cfg, store, now: () => T0 + h * H });
  const later = { author: '@Carol', uri: 'at://carol/app.bsky.feed.post/2' };
  const same = at(48).candidate(cfg.accounts[0], later);
  assert.equal(same.ok, false);
  assert.match(same.reasons.join(' '), /already got a reply from alpha/);
  const other = at(48).candidate(cfg.accounts[1], later);
  assert.equal(other.ok, false, 'a second account may not answer the same person inside the cooldown');
  assert.equal(at(169).candidate(cfg.accounts[1], later).ok, true);
});

test('two of your accounts never land in one thread', () => {
  const cfg = on();
  const store = createMemoryStore();
  const root = rootKey('bluesky', { uri: 'at://dave/app.bsky.feed.post/9' });
  reply(store, { accountId: 'alpha', author: 'dave', text: 'One point.', root, ts: T0 });
  const guard = createReplyGuard({ config: cfg, store, now: () => T0 + 400 * H });
  const inThread = { author: 'erin', uri: 'at://erin/app.bsky.feed.post/3', record: { reply: { root: { uri: 'at://dave/app.bsky.feed.post/9' } } } };
  const c = guard.candidate(cfg.accounts[1], inThread);
  assert.equal(c.ok, false);
  assert.match(c.reasons.join(' '), /already spoke in this thread/);
});

test('a reworded repeat of the same pitch is refused', () => {
  const cfg = on();
  const store = createMemoryStore();
  reply(store, { accountId: 'alpha', author: 'frank', promo: true, ts: T0, root: 'bluesky:r1', text: 'Acme Parse turns your invoices into JSON fields your code can read, and you only pay when a call succeeds.' });
  const guard = createReplyGuard({ config: cfg, store, now: () => T0 + H });
  const reworded = guard.draft(cfg.accounts[1], 'You only pay Acme Parse when a call succeeds, and it turns invoices into JSON fields that your code reads.');
  assert.equal(reworded.promo, true);
  assert.equal(reworded.ok, false);
  assert.match(reworded.reasons.join(' '), /pitch repeats one alpha already sent/);
  const plain = guard.draft(cfg.accounts[1], 'Retrying a webhook with a short backoff usually clears a dropped delivery.');
  assert.equal(plain.ok, true);
});

test('the promo ratio, the daily cap, the template opener and the question habit each refuse', () => {
  const cfg = on({ promoRatioMax: 0.25 });
  const store = createMemoryStore();
  const texts = [
    'Acme Parse reads receipts.', 'Acme Parse prices each endpoint flat.', 'Acme Parse keeps one wallet.',
    'Acme Parse answers 503 when paused.', 'Acme Parse sends a webhook.', 'Acme Parse charges on success.',
    'Acme Parse handles contracts.', 'Acme Parse redacts fields.',
  ];
  texts.forEach((text, i) => reply(store, { accountId: 'alpha', author: `p${i}`, text, promo: true, root: `bluesky:p${i}`, ts: T0 + i * 1000 }));
  const guard = createReplyGuard({ config: cfg, store, now: () => T0 + H });
  assert.match(guard.draft(cfg.accounts[0], 'Acme Parse also reads purchase orders now.').reasons.join(' '), /percent of alpha's recent replies already promote/);

  const capped = config({ replies: { enabled: true } }, [account('alpha', { caps: { repliesPerDay: 2 } })]);
  const s2 = createMemoryStore();
  reply(s2, { accountId: 'alpha', author: 'a', text: 'One.', root: 'bluesky:a', ts: T0 });
  reply(s2, { accountId: 'alpha', author: 'b', text: 'Two.', root: 'bluesky:b', ts: T0 + 1000 });
  const c = createReplyGuard({ config: capped, store: s2, now: () => T0 + H }).candidate(capped.accounts[0], { author: 'c', uri: 'at://c/1' });
  assert.match(c.reasons.join(' '), /cap is 2/);

  const s3 = createMemoryStore();
  const g3 = createReplyGuard({ config: on(), store: s3, now: () => T0 });
  assert.match(g3.draft(cfg.accounts[0], 'The hard part is the retry budget, not the parse.').reasons.join(' '), /template/);
  for (let i = 0; i < 4; i += 1) reply(s3, { accountId: 'beta', author: `q${i}`, text: `Did run ${i} use the cache?`, root: `bluesky:q${i}`, ts: T0 + i });
  assert.match(g3.draft(cfg.accounts[0], 'Is the webhook signed?').reasons.join(' '), /were questions/);
});

test('the reply pass sends to new people, skips a repeat author, and records every reply', async () => {
  const cfg = on();
  const store = createMemoryStore();
  const replies = ['Signing the webhook body lets the receiver drop forged calls.', 'A flat price per call makes the monthly bill easy to predict.', 'Batching the uploads keeps the job queue short.'];
  const provider = createStubProvider({ respond: (req, i) => replies[i % replies.length] });
  const transport = createDryTransport({ platform: 'bluesky', handle: 'alpha.bsky.social' });
  const candidates = [
    { author: 'gina', text: 'How do you trust a webhook?', uri: 'at://gina/app.bsky.feed.post/1' },
    { author: 'hal', text: 'API pricing is confusing.', uri: 'at://hal/app.bsky.feed.post/2' },
    { author: 'gina', text: 'Another question from me.', uri: 'at://gina/app.bsky.feed.post/3' },
  ];
  const res = await runReplies({ config: cfg, store, provider, account: cfg.accounts[0], candidates, transport, now: () => T0 });
  assert.equal(res.sent.length, 2);
  assert.deepEqual(res.sent.map((r) => r.author), ['gina', 'hal']);
  assert.equal(res.skipped.length, 1);
  assert.match(res.skipped[0].reasons.join(' '), /already got a reply/);
  assert.equal(store.rows({ kind: 'reply' }).length, 2);
  assert.ok(store.rows({ kind: 'reply' }).every((r) => r.threadRoot && r.author));
});

test('a live thread read is authoritative, and a read that fails skips the thread', async () => {
  const cfg = on();
  const store = createMemoryStore();
  const provider = createStubProvider({ responses: ['Signing the webhook body lets the receiver drop forged calls.'] });
  const transport = createDryTransport({ platform: 'bluesky', handle: 'alpha.bsky.social' });
  const c = [{ author: 'ivy', text: 'A post.', uri: 'at://ivy/app.bsky.feed.post/1' }];
  const held = await runReplies({ config: cfg, store, provider, account: cfg.accounts[0], candidates: c, transport, readAuthors: async () => ['ivy', 'beta.bsky.social'], now: () => T0 });
  assert.equal(held.sent.length, 0);
  assert.match(held.skipped[0].reasons[0], /beta\.bsky\.social is already in this thread/);
  const broken = await runReplies({ config: cfg, store, provider, account: cfg.accounts[0], candidates: c, transport, readAuthors: async () => { throw new Error('timeout'); }, now: () => T0 });
  assert.equal(broken.sent.length, 0);
  assert.match(broken.skipped[0].reasons[0], /could not be read/);
});
