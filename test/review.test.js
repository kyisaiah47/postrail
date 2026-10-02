import test from 'node:test';
import assert from 'node:assert/strict';
import { review, formatReview, listTable, hasFindings } from '../src/index.js';

const NOW = Date.parse('2026-10-05T20:00:00Z');
let n = 0;
const row = (o) => ({ ts: NOW - 3600000 + (n += 1000), platform: 'bluesky', ...o });

test('the review reads the text and flags every repetition shape', () => {
  const rows = [
    row({ kind: 'reply', accountId: 'alpha', author: 'bob', text: 'Retries need a budget.', threadRoot: 'bluesky:1' }),
    row({ kind: 'reply', accountId: 'alpha', author: 'bob', text: 'Webhooks need signatures.', threadRoot: 'bluesky:2' }),
    row({ kind: 'reply', accountId: 'alpha', author: '@Bob', text: 'Queues need limits.', threadRoot: 'bluesky:3' }),
    row({ kind: 'reply', accountId: 'alpha', author: 'carol', text: 'Caching helps the second call.', threadRoot: 'bluesky:4' }),
    row({ kind: 'reply', accountId: 'beta', author: 'carol', text: 'A flat price is easy to predict.', threadRoot: 'bluesky:4' }),
    row({ kind: 'reply', accountId: 'alpha', author: 'dan', promo: true, text: 'Acme Parse turns invoices into JSON fields your code can read today.', threadRoot: 'bluesky:5' }),
    row({ kind: 'reply', accountId: 'alpha', author: 'eve', promo: true, text: 'Acme Parse turns invoices into JSON fields your code can read in seconds.', threadRoot: 'bluesky:6' }),
    row({ kind: 'reply', accountId: 'alpha', author: 'fay', text: 'The hard part is the retry budget.', threadRoot: 'bluesky:7' }),
    row({ kind: 'post', accountId: 'alpha', text: 'Acme Parse charges only when a call succeeds, so a failed call costs nothing.' }),
    row({ kind: 'post', accountId: 'alpha', text: 'Acme Parse charges only when a call succeeds, so a failed call costs you nothing.' }),
    row({ kind: 'post', accountId: 'beta', text: 'Acme Parse charges only when a call succeeds, so a failed call costs nothing at all.' }),
  ];
  const r = review(rows, { days: 1, now: NOW });
  assert.deepEqual(r.repeatAuthors, [{ accountId: 'alpha', author: 'bob', count: 3 }]);
  assert.deepEqual(r.crossAccountTargets.map((x) => x.author), ['carol']);
  assert.deepEqual(r.sharedThreads, [{ root: 'bluesky:4', accounts: ['alpha', 'beta'] }]);
  assert.equal(r.nearDupPitches[0].accountId, 'alpha');
  assert.equal(r.templateOpeners[0].hits, 1);
  assert.equal(r.nearDupPosts[0].accountId, 'alpha');
  assert.ok(r.crossAccountPosts.length >= 1);
  assert.equal(hasFindings(r), true);
  const text = formatReview(r);
  for (const heading of ['Repeat authors', 'Cross-account targets', 'Shared threads', 'Promo ratio', 'Near-duplicate pitches', 'Template openers', 'Near-duplicate posts', 'Cross-account posts']) {
    assert.ok(text.includes(heading), heading);
  }
  const list = listTable(rows, { days: 1, now: NOW });
  assert.ok(list.includes('Webhooks need signatures.'));
  assert.ok(list.includes('### alpha'));
});

test('a varied ledger reports nothing, and rows outside the window are ignored', () => {
  const rows = [
    row({ kind: 'reply', accountId: 'alpha', author: 'gus', text: 'Signed webhooks stop forged calls.', threadRoot: 'bluesky:8' }),
    row({ kind: 'post', accountId: 'alpha', text: 'Acme Parse reads receipts.' }),
    { ts: NOW - 30 * 86400000, kind: 'reply', accountId: 'alpha', author: 'gus', text: 'Old reply.', threadRoot: 'bluesky:old', platform: 'bluesky' },
  ];
  const r = review(rows, { days: 14, now: NOW });
  assert.equal(hasFindings(r), false);
  assert.equal(r.counts.replies, 1);
});
