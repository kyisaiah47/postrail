// The reply guard. The reply module is OFF unless the config says `replies.enabled: true`.
//
// Automated replies to strangers are the behaviour the platforms' own automation rules restrict
// most, and the volume of replies is not what reads as a bot. Repetition is: the same person
// answered again and again, the same pitch reworded for a wall of strangers, two accounts run by
// one person landing in the same thread. So when the module is on, every reply passes all of
// these before it is sent:
//
//   1. daily cap             caps.repliesPerDay per account (default 20)
//   2. author cooldown       one reply per person per platform per authorCooldownH (default 168,
//                            seven days), counted across every account in the config
//   3. one seat per thread   no two of our accounts in one conversation, and no account twice;
//                            a live read of the thread can be supplied and is authoritative
//   4. repeat shapes         a near copy of a recent reply, a reused three-word opener, a reused
//                            closing sentence, a four-word phrase already used twice, the
//                            question habit, and the "the hard part is X" template opener
//   5. repeat pitch          a promotional reply whose words match a recent promotional reply,
//                            even when it is reworded
//   6. promo ratio           promotional replies may be at most promoRatioMax (default 0.25) of
//                            the account's last promoWindow (default 30) replies
//
// Every reason is written for the writer, so the engine can hand it back as the next instruction.

import { opener, closer, ngrams, jaccard, contentWords, isQuestion, isPromo, TEMPLATE_OPENER } from '../shapes.js';
import { normHandle } from '../registry.js';
import { localDate, parseDate, zonedToUtc } from '../time.js';
import { rootKey } from './threads.js';

export const LIMITS = {
  dupWindow: 500, dupJaccard: 0.35,
  openerWindow: 150,
  closerWindow: 150, closerFloor: 2,
  phraseWindow: 300, phraseFloor: 2,
  questionWindow: 20, questionMax: 4,
  pitchWindow: 200, pitchTrigram: 0.35, pitchContent: 0.5,
};

/** The instant the local day began, in the config's time zone. */
export function startOfLocalDay(nowMs, timezone) {
  return zonedToUtc({ ...parseDate(localDate(nowMs, timezone)), hour: 0, minute: 0 }, timezone);
}

/**
 * Build a guard over a store's ledger. `config` is the validated config; the guard reads its
 * replies settings and every account's handle.
 */
export function createReplyGuard({ config, store, now = () => Date.now(), limits = LIMITS }) {
  const settings = config.replies;
  const enabled = settings.enabled === true;
  const replies = () => store.rows({ kind: 'reply' });

  function authorBlocked(platform, author) {
    const a = normHandle(author);
    if (!a) return null;
    const cutoff = now() - Number(settings.authorCooldownH) * 3600000;
    const hit = replies().filter((r) => r.platform === platform && normHandle(r.author) === a && r.ts >= cutoff).pop();
    if (!hit) return null;
    return `@${a} already got a reply from ${hit.accountId} on ${new Date(hit.ts).toISOString().slice(0, 10)}. One reply per person per platform every ${settings.authorCooldownH} hours, across every account.`;
  }

  function seatTaken(root) {
    if (!root) return 'PostRail cannot name this thread, so it cannot keep it to one seat. Skip it.';
    const hit = store.rows({}).find((r) => r.threadRoot === root);
    return hit ? `${hit.accountId} already spoke in this thread. Only one of your accounts may be in a conversation, once.` : null;
  }

  function capReached(account) {
    const cap = Number(account.caps.repliesPerDay);
    const today = store.rows({ kind: 'reply', accountId: account.id, sinceMs: startOfLocalDay(now(), config.timezone) }).length;
    return today >= cap ? `${account.id} has sent ${today} replies today and its cap is ${cap}.` : null;
  }

  /** The repeat-shape check, against every account's recent replies. */
  function shapeReason(text) {
    const t = String(text || '').trim();
    const all = replies();
    const recent = (n) => all.slice(Math.max(0, all.length - n));
    const tri = ngrams(t, 3);
    for (const r of recent(limits.dupWindow)) {
      if (jaccard(tri, ngrams(r.text, 3)) >= limits.dupJaccard) {
        return `This is a near copy of a reply ${r.accountId} already sent ("${String(r.text).slice(0, 90)}"). Write a different reply.`;
      }
    }
    if (TEMPLATE_OPENER.test(t)) return 'This opens with the "the X part is" template. Open with the specific point instead.';
    const op = opener(t);
    if (op.split(' ').length === 3 && recent(limits.openerWindow).some((r) => opener(r.text) === op)) {
      return `A recent reply already opened with "${op}". Start with different words.`;
    }
    const cl = closer(t);
    if (cl && cl.split(' ').length === 3 && recent(limits.closerWindow).filter((r) => closer(r.text) === cl).length >= limits.closerFloor) {
      return `Replies keep ending with a sentence that starts "${cl}". Drop that sentence.`;
    }
    const four = ngrams(t, 4);
    if (four.size) {
      const counts = new Map();
      for (const r of recent(limits.phraseWindow)) for (const g of ngrams(r.text, 4)) if (four.has(g)) counts.set(g, (counts.get(g) || 0) + 1);
      const hit = [...counts.entries()].filter(([, n]) => n >= limits.phraseFloor).sort((a, b) => b[1] - a[1])[0];
      if (hit) return `"${hit[0]}" is in ${hit[1]} recent replies. Say it in other words or drop it.`;
    }
    if (isQuestion(t)) {
      const q = recent(limits.questionWindow).filter((r) => isQuestion(r.text)).length;
      if (q >= limits.questionMax) return `${q} of the last ${limits.questionWindow} replies were questions. State one fact that follows from their post and do not ask anything.`;
    }
    return null;
  }

  /** A promotional reply that says what a recent promotional reply said, reworded or not. */
  function pitchReason(text, account) {
    const tri = ngrams(text, 3);
    const cw = contentWords(text);
    const promos = replies().filter((r) => r.promo).slice(-limits.pitchWindow);
    for (const r of promos) {
      const t3 = jaccard(tri, ngrams(r.text, 3));
      const c = jaccard(cw, contentWords(r.text));
      if (t3 >= limits.pitchTrigram || c >= limits.pitchContent) {
        return `This pitch repeats one ${r.accountId} already sent (${Math.round(Math.max(t3, c) * 100)} percent of its words match: "${String(r.text).slice(0, 90)}"). Do not pitch in this reply.`;
      }
    }
    const window = Number(settings.promoWindow) || 30;
    const mine = replies().filter((r) => r.accountId === account.id).slice(-window);
    const ratio = mine.filter((r) => r.promo).length / Math.max(mine.length, window);
    if (ratio >= Number(settings.promoRatioMax)) {
      return `${Math.round(ratio * 100)} percent of ${account.id}'s recent replies already promote something, and the limit is ${Math.round(Number(settings.promoRatioMax) * 100)} percent. Reply without promoting anything.`;
    }
    return null;
  }

  return {
    enabled,
    rootKey,
    /** Can this account reply to this candidate at all? Run before writing anything. */
    candidate(account, candidate) {
      const reasons = [];
      if (!enabled) reasons.push('Replies are off. Set replies.enabled to true to use the reply module.');
      const cap = capReached(account); if (cap) reasons.push(cap);
      const a = authorBlocked(account.platform, candidate.author); if (a) reasons.push(a);
      const root = rootKey(account.platform, candidate);
      const seat = seatTaken(root); if (seat) reasons.push(seat);
      const own = config.accounts.some((x) => normHandle(x.handle) === normHandle(candidate.author));
      if (own) reasons.push('That post is from one of your own accounts. PostRail does not reply to itself.');
      return { ok: reasons.length === 0, reasons, root };
    },
    /** Is this draft safe to send? Run after writing it. */
    draft(account, text) {
      const reasons = [];
      const shape = shapeReason(text); if (shape) reasons.push(shape);
      const promo = isPromo(text, account.promo);
      if (promo) { const p = pitchReason(text, account); if (p) reasons.push(p); }
      return { ok: reasons.length === 0, reasons, promo };
    },
    /** The rules, for the writer's prompt. */
    brief() {
      const all = replies();
      const ops = [...new Set(all.slice(-limits.openerWindow).map((r) => opener(r.text)).filter((o) => o.split(' ').length === 3))].slice(-25);
      return [
        'Reply rules: one plain point that follows from their post. No pitch unless they asked for one.',
        ops.length ? `Do not start with any of these recent openers: ${ops.map((o) => `"${o}"`).join(', ')}.` : '',
        'Do not end on a question unless you need a fact from them to say anything useful.',
      ].filter(Boolean).join('\n');
    },
    /**
     * The live seat check, which is authoritative: read the thread and look for any of our
     * handles. `readAuthors(candidate)` returns the handles in the thread. A read that fails is a
     * refusal, because being absent from one thread is free and two of our accounts in it is not.
     */
    async liveSeat(candidate, readAuthors) {
      if (typeof readAuthors !== 'function') return { ok: true, live: false };
      let authors;
      try { authors = await readAuthors(candidate); } catch (e) { return { ok: false, reason: `the thread could not be read (${e.message}), so it is skipped` }; }
      const owned = new Set(config.accounts.map((x) => normHandle(x.handle)));
      const found = (authors || []).map(normHandle).find((h) => owned.has(h));
      return found ? { ok: false, reason: `@${found} is already in this thread` } : { ok: true, live: true };
    },
  };
}

