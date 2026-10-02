// Writing one draft. The writer gets the account's voice, the slot kind's instruction, the facts
// of one subject (and only those), the platform's length, the gate rules, the openers the account
// used recently, and, from the second attempt on, the reason the last draft was refused.

import { gatesBrief } from './gates.js';
import { SlotStillOwed } from '../slots.js';
import { opener } from '../shapes.js';
import { seededRng } from '../rng.js';

/**
 * Pick the subject for a slot: the least recently posted subject in the account's pool, never one
 * of the last `noRepeatLast` it posted about. Ties break on the seeded roll.
 */
export function pickSubject(account, config, history = [], seed = '') {
  const pool = account.subjects.map((id) => config.subjects.find((s) => s.id === id)).filter(Boolean);
  if (!pool.length) return null;
  const recentIds = history.map((r) => r.subject).filter(Boolean);
  const blocked = new Set(recentIds.slice(-account.noRepeatLast));
  const lastUse = (id) => { const i = recentIds.lastIndexOf(id); return i < 0 ? -1 : i; };
  const rng = seededRng(`subject|${account.id}|${seed}`);
  const open = pool.filter((s) => !blocked.has(s.id));
  const ranked = (open.length ? open : pool).map((s) => ({ s, used: lastUse(s.id), tie: rng() }))
    .sort((a, b) => a.used - b.used || a.tie - b.tie);
  return ranked[0].s;
}

export function buildPrompt({ account, slotDef, kind, subject, gates, critique = '', recentTexts = [] }) {
  const system = [
    account.voice || 'You write social posts for the account below. Write the way a person who built the thing would say it to a peer.',
    `Platform: ${account.platform}. Account: ${account.handle}.`,
    `Length: at most ${account.maxChars} characters${account.count === 'x' ? ' (every link counts as 23)' : ''}.`,
    account.hashtags ? 'Hashtags are allowed, at most two.' : 'Use no hashtags.',
    gatesBrief(gates),
    'Return only the text of the post. No quotation marks around it, no preamble, no notes.',
  ].join('\n');

  const openers = [...new Set(recentTexts.map(opener).filter((o) => o.split(' ').length === 3))].slice(-12);
  const lines = [
    `Slot kind: ${kind}.`,
    slotDef.instruction,
    '',
  ];
  if (subject) {
    lines.push(`Subject: ${subject.name || subject.id}${subject.url ? ` (${subject.url})` : ''}.`);
    lines.push('Facts you may state. State nothing that is not here:');
    for (const f of subject.facts) lines.push(`- ${f}`);
    lines.push('');
  }
  if (slotDef.link && subject && subject.url && account.links) lines.push(`Include this URL once: ${subject.url}`);
  else lines.push('Include no URL.');
  if (openers.length) lines.push(`Do not start with any of these openers, which this account used recently: ${openers.map((o) => `"${o}"`).join(', ')}.`);
  if (critique) lines.push('', `Your last draft was refused: ${critique}`, 'Write a new draft that fixes that.');
  return { system, prompt: lines.join('\n') };
}

/** Clean what a model returns: trim, drop wrapping quotes and a leading label. */
export function cleanDraft(raw) {
  let t = String(raw || '').trim();
  t = t.replace(/^```[a-z]*\n?|```$/g, '').trim();
  t = t.replace(/^(post|draft|here is the post|here's the post)\s*:\s*/i, '').trim();
  if (/^["“].*["”]$/s.test(t)) t = t.slice(1, -1).trim();
  return t;
}

export async function composeDraft({ provider, account, slotDef, kind, subject, gates, critique, recentTexts }) {
  const { system, prompt } = buildPrompt({ account, slotDef, kind, subject, gates, critique, recentTexts });
  let raw;
  try {
    raw = await provider.complete({ system, prompt, maxTokens: 4096 });
  } catch (e) {
    if (e && e.truncated) throw new SlotStillOwed('The model stopped before the post was finished. Write a shorter post.', { kind: 'copy' });
    throw e;
  }
  return { text: cleanDraft(raw), system, prompt };
}
