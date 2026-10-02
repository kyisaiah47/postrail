// The review. It reads the actual text of what every account posted and replied, from the ledger,
// and finds the shapes a volume number never shows:
//
//   repeat authors          one account answered the same person more than twice
//   cross-account targets   one person answered by more than one of your accounts
//   shared threads          two of your accounts in one conversation
//   promo ratio             the share of each account's replies that promoted something
//   near-duplicate pitches  promotional replies from one account that share 35 percent or more
//                           of their three-word phrases
//   template openers        replies opening with the "the X part is" shape
//   near-duplicate posts    original posts from one account that share 35 percent or more
//   cross-account posts     the same original reworded across two of your accounts
//
// `postrail review --list` prints the literal text of every post and reply in the window as a
// table, because a count can point at a problem and only the text shows it.

import { ngrams, jaccard, TEMPLATE_OPENER } from './shapes.js';

export const normalizeAuthor = (a) => String(a || '').trim().toLowerCase().replace(/^@+/, '');

export const REPEAT_FLOOR = 2;
export const DUP = 0.35;

function pairs(items, threshold) {
  const grams = items.map((r) => ({ r, g: ngrams(r.text, 3) }));
  const out = [];
  for (let i = 0; i < grams.length; i += 1) {
    for (let j = i + 1; j < grams.length; j += 1) {
      const sim = jaccard(grams[i].g, grams[j].g);
      if (sim >= threshold) out.push({ sim, a: grams[i].r, b: grams[j].r });
    }
  }
  return out.sort((x, y) => y.sim - x.sim);
}

function byAccount(rows) {
  const m = new Map();
  for (const r of rows) {
    if (!m.has(r.accountId)) m.set(r.accountId, []);
    m.get(r.accountId).push(r);
  }
  return m;
}

/** Review the ledger rows in a window. Returns plain data; formatReview() prints it. */
export function review(rows, { days = 14, now = Date.now() } = {}) {
  const cutoff = now - days * 86400000;
  const inWindow = rows.filter((r) => r.ts >= cutoff && r.text);
  const replies = inWindow.filter((r) => r.kind === 'reply');
  const posts = inWindow.filter((r) => r.kind === 'post');

  const repeatAuthors = [];
  for (const [accountId, rs] of byAccount(replies)) {
    const counts = new Map();
    for (const r of rs) { const a = normalizeAuthor(r.author); if (a) counts.set(a, (counts.get(a) || 0) + 1); }
    for (const [author, count] of counts) if (count > REPEAT_FLOOR) repeatAuthors.push({ accountId, author, count });
  }

  const authorAccounts = new Map();
  for (const r of replies) {
    const a = normalizeAuthor(r.author);
    if (!a) continue;
    const key = `${r.platform}:${a}`;
    if (!authorAccounts.has(key)) authorAccounts.set(key, new Set());
    authorAccounts.get(key).add(r.accountId);
  }
  const crossAccountTargets = [...authorAccounts.entries()].filter(([, s]) => s.size > 1)
    .map(([key, s]) => ({ platform: key.split(':')[0], author: key.slice(key.indexOf(':') + 1), accounts: [...s] }));

  const rootAccounts = new Map();
  for (const r of inWindow) {
    if (!r.threadRoot) continue;
    if (!rootAccounts.has(r.threadRoot)) rootAccounts.set(r.threadRoot, []);
    rootAccounts.get(r.threadRoot).push(r.accountId);
  }
  const sharedThreads = [...rootAccounts.entries()].filter(([, a]) => a.length > 1).map(([root, accounts]) => ({ root, accounts }));

  const promoRatio = [...byAccount(replies)].map(([accountId, rs]) => {
    const promo = rs.filter((r) => r.promo).length;
    return { accountId, promo, total: rs.length, ratio: rs.length ? promo / rs.length : 0 };
  });

  const nearDupPitches = [...byAccount(replies.filter((r) => r.promo))]
    .map(([accountId, rs]) => ({ accountId, pairs: pairs(rs, DUP) })).filter((x) => x.pairs.length);

  const templateOpeners = [...byAccount(replies)].map(([accountId, rs]) => {
    const hits = rs.filter((r) => TEMPLATE_OPENER.test(String(r.text).trim()));
    return { accountId, hits: hits.length, total: rs.length, ratio: rs.length ? hits.length / rs.length : 0, examples: hits.slice(0, 5) };
  }).filter((x) => x.hits);

  const nearDupPosts = [...byAccount(posts)].map(([accountId, rs]) => ({ accountId, total: rs.length, pairs: pairs(rs, DUP) })).filter((x) => x.pairs.length);

  const crossAccountPosts = pairs(posts, DUP).filter((p) => p.a.accountId !== p.b.accountId);

  return {
    days,
    counts: { posts: posts.length, replies: replies.length, accounts: new Set(inWindow.map((r) => r.accountId)).size },
    repeatAuthors, crossAccountTargets, sharedThreads, promoRatio, nearDupPitches, templateOpeners, nearDupPosts, crossAccountPosts,
  };
}

/** True when the review found anything a person should read. */
export function hasFindings(r) {
  return Boolean(r.repeatAuthors.length || r.crossAccountTargets.length || r.sharedThreads.length
    || r.nearDupPitches.length || r.templateOpeners.length || r.nearDupPosts.length || r.crossAccountPosts.length);
}

const clip = (s, n = 80) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const pct = (x) => `${Math.round(x * 100)}%`;

export function formatReview(r) {
  const L = [];
  L.push(`PostRail review, last ${r.days} day(s): ${r.counts.posts} post(s) and ${r.counts.replies} repl(ies) across ${r.counts.accounts} account(s).`, '');
  L.push('Repeat authors (one account answered the same person more than twice)');
  if (r.repeatAuthors.length) for (const x of r.repeatAuthors) L.push(`  ${x.accountId}: @${x.author} ${x.count} times`); else L.push('  none');
  L.push('', 'Cross-account targets (one person answered by more than one of your accounts)');
  if (r.crossAccountTargets.length) for (const x of r.crossAccountTargets) L.push(`  ${x.platform} @${x.author}: ${x.accounts.join(', ')}`); else L.push('  none');
  L.push('', 'Shared threads (two of your accounts in one conversation)');
  if (r.sharedThreads.length) for (const x of r.sharedThreads) L.push(`  ${x.root}: ${x.accounts.join(', ')}`); else L.push('  none');
  L.push('', 'Promo ratio (share of each account\'s replies that promoted something)');
  if (r.promoRatio.length) for (const x of r.promoRatio) L.push(`  ${x.accountId}: ${x.promo} of ${x.total} (${pct(x.ratio)})`); else L.push('  no replies in the window');
  L.push('', 'Near-duplicate pitches (promotional replies, 35% or more of three-word phrases shared)');
  if (r.nearDupPitches.length) {
    for (const x of r.nearDupPitches) for (const p of x.pairs.slice(0, 5)) L.push(`  ${x.accountId} ${pct(p.sim)}: "${clip(p.a.text)}" / "${clip(p.b.text)}"`);
  } else L.push('  none');
  L.push('', 'Template openers ("the X part is" shape)');
  if (r.templateOpeners.length) for (const x of r.templateOpeners) L.push(`  ${x.accountId}: ${x.hits} of ${x.total} (${pct(x.ratio)})`); else L.push('  none');
  L.push('', 'Near-duplicate posts (one account, 35% or more of three-word phrases shared)');
  if (r.nearDupPosts.length) {
    for (const x of r.nearDupPosts) for (const p of x.pairs.slice(0, 5)) L.push(`  ${x.accountId} ${pct(p.sim)}: "${clip(p.a.text)}" / "${clip(p.b.text)}"`);
  } else L.push('  none');
  L.push('', 'Cross-account posts (the same post reworded on two of your accounts)');
  if (r.crossAccountPosts.length) for (const p of r.crossAccountPosts.slice(0, 10)) L.push(`  ${p.a.accountId} and ${p.b.accountId} ${pct(p.sim)}: "${clip(p.a.text)}"`); else L.push('  none');
  return L.join('\n');
}

/** Every post and reply in the window, as a markdown table per account, with the full text. */
export function listTable(rows, { days = 1, now = Date.now() } = {}) {
  const cutoff = now - days * 86400000;
  const inWindow = rows.filter((r) => r.ts >= cutoff && r.text);
  const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
  const L = [`Posts and replies, last ${days} day(s): ${inWindow.length} in total.`, ''];
  for (const [accountId, rs] of byAccount(inWindow)) {
    L.push(`### ${accountId} (${rs.length})`, '', '| time (UTC) | kind | to | promo | text |', '|---|---|---|---|---|');
    for (const r of rs) {
      L.push(`| ${new Date(r.ts).toISOString().slice(0, 16).replace('T', ' ')} | ${r.kind} | ${r.author ? `@${cell(normalizeAuthor(r.author))}` : ''} | ${r.promo ? 'yes' : ''} | ${cell(r.text)} |`);
    }
    L.push('');
  }
  return L.join('\n');
}
