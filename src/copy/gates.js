// The copy gates. Every draft passes these before it may be sent. A refusal is returned as a
// reason written for the writer, because the engine hands it back to the model as the instruction
// for the next draft.
//
// Always on:   empty draft, a draft that stops mid-sentence, over the platform length, a link
//              where the slot carries none, a hashtag on an account that does not use them, and a
//              near copy of a recent post from this account or another account in the config.
// On by default, switchable in `copyGates`:  the noise list and the prose list.
// Off by default:  the dash gate (em dash, en dash, horizontal bar and minus sign).

import fs from 'node:fs';
import { ngrams, jaccard } from '../shapes.js';

const SPEC = JSON.parse(fs.readFileSync(new URL('./patterns.json', import.meta.url), 'utf8'));
const PATTERNS = SPEC.patterns.map((p) => ({
  ...p,
  re: new RegExp(p.pattern, p.list === 'prose' ? 'im' : 'i'),
  requiresRe: p.requires ? new RegExp(p.requires) : null,
  unlessRe: p.unless ? new RegExp(p.unless) : null,
}));

export const FAMILIES = SPEC.families;
const URL_RE = /https?:\/\/[^\s"'<>)\]]+/g;
const SENT = /(?<=[.!?])\s+|\n+/;
const WORD = /[A-Za-z][A-Za-z']*/g;

function sentenceAround(text, index) {
  let pos = 0;
  for (const s of String(text).split(SENT)) {
    const end = pos + s.length;
    if (index >= pos && index < end) return s.replace(/\s+/g, ' ').trim();
    pos = end + 1;
    while (pos < text.length && /\s/.test(text[pos])) pos += 1;
  }
  return String(text).slice(Math.max(0, index - 80), index + 120).replace(/\s+/g, ' ').trim();
}

/** Every pattern from one list that fires: [{ slug, family, fragment, sentence, fix }]. */
export function patternHits(text, list) {
  const t = list === 'prose' ? String(text || '').replace(URL_RE, '<url>') : String(text || '');
  const out = [];
  for (const p of PATTERNS) {
    if (p.list !== list) continue;
    const re = new RegExp(p.re.source, p.re.flags.includes('g') ? p.re.flags : `${p.re.flags}g`);
    let m;
    while ((m = re.exec(t)) !== null) {
      if (m[0] === '') { re.lastIndex += 1; continue; }
      const off = m[0].length - m[0].replace(/^[.!? \t\n]+/, '').length;
      const sentence = sentenceAround(t, m.index + off);
      if (p.min_words && (sentence.match(WORD) || []).length < p.min_words) continue;
      if (p.requiresRe && !p.requiresRe.test(sentence)) continue;
      if (p.unlessRe && p.unlessRe.test(sentence)) continue;
      out.push({ slug: p.slug, family: p.family, fragment: m[0].replace(/^[.!? \t\n]+|[.!? \t\n]+$/g, '').replace(/\s+/g, ' ').slice(0, 160), sentence, fix: p.fix || '' });
      break;
    }
  }
  return out;
}

const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('en', { granularity: 'grapheme' }) : null;

/** Length the way the platform counts it. X counts every link as 23 characters. */
export function platformLength(text, count = 'chars') {
  const t = String(text || '');
  if (count === 'graphemes') return segmenter ? [...segmenter.segment(t)].length : [...t].length;
  if (count === 'x') return [...t.replace(URL_RE, 'x'.repeat(23))].length;
  return [...t].length;
}

const DASHES = /[\u2014\u2013\u2015\u2212]/;
const FINISHED = /[.!?\u2026)"'\u201d\u2019\]]$|\p{Extended_Pictographic}$/u;

/** Does the text end on a finished sentence? Trailing hashtags are set aside first. A post that
 *  ends on a link is finished, because "You can test it at <link>." is a whole sentence. */
export function finished(text) {
  const t = String(text || '').replace(/(\s+#[A-Za-z]\w*)+\s*$/u, '').trim();
  if (/https?:\/\/\S+$/u.test(t)) return true;
  return !t || FINISHED.test(t);
}

/**
 * Check one draft. Returns a list of { gate, reason }; an empty list means the draft may be sent.
 *
 *   account      the normalised account (maxChars, count, hashtags)
 *   allowLink    whether this slot may carry a link
 *   gates        the config's copyGates
 *   recent       the account's recent posts, newest last, as plain strings
 *   others       recent posts from the config's other accounts. A post that repeats one of them
 *                is refused too, because the platforms treat the same post across accounts one
 *                person runs as spam.
 */
export function checkCopy(text, { account = {}, allowLink = true, gates = {}, recent = [], others = [] } = {}) {
  const t = String(text || '').trim();
  const out = [];
  if (!t) return [{ gate: 'empty', reason: 'The draft was empty. Write the post.' }];
  if (!finished(t)) out.push({ gate: 'unfinished', reason: 'The draft stops in the middle of a sentence. Finish the sentence or drop it.' });
  const max = account.maxChars || 500;
  const len = platformLength(t, account.count || 'chars');
  if (len > max) out.push({ gate: 'length', reason: `The draft is ${len} characters and this platform allows ${max}. Drop a fact instead of cutting words out of sentences.` });
  if (!allowLink && /https?:\/\/\S/.test(t)) out.push({ gate: 'link', reason: 'This slot carries no link. Remove the URL.' });
  if (!account.hashtags && /(^|\s)#[A-Za-z][\w]*/.test(t)) out.push({ gate: 'hashtag', reason: 'This account does not use hashtags. Remove them.' });
  if (gates.dashes && DASHES.test(t)) out.push({ gate: 'dashes', reason: 'Replace each dash with a comma, a colon or a full stop.' });
  if (gates.noise !== false) {
    for (const h of patternHits(t, 'noise')) out.push({ gate: 'noise', reason: `"${h.fragment}" is filler (${FAMILIES[h.family] || h.family}). Say the fact instead, in plain words.` });
  }
  if (gates.prose !== false) {
    for (const h of patternHits(t, 'prose')) out.push({ gate: 'prose', reason: `"${h.fragment}" is ${FAMILIES[h.family] || h.family}. ${h.fix ? `Fix: ${h.fix}` : 'Write it as a plain sentence.'}` });
  }
  if (gates.repeats !== false && (recent.length || others.length)) {
    const threshold = Number(gates.repeatThreshold) || 0.35;
    const tri = ngrams(t, 3);
    const compare = [...recent.map((x) => [x, 'this account']), ...others.map((x) => [x, 'another of your accounts'])];
    for (const [prev, who] of compare) {
      const sim = jaccard(tri, ngrams(prev, 3));
      if (sim >= threshold) {
        out.push({ gate: 'repeat', reason: `This repeats a recent post from ${who} (${Math.round(sim * 100)} percent of its three-word phrases match: "${String(prev).slice(0, 90)}"). Write about a different fact, in different words.` });
        break;
      }
    }
  }
  return out;
}

/** The rules a writer is shown before it drafts, rendered from the same lists the gate checks. */
export function gatesBrief(gates = {}) {
  const lines = ['Write plain sentences: a subject, a verb and a fact. One fact per sentence.'];
  if (gates.noise !== false) lines.push('Do not announce honesty, do not describe your own sentence, and do not use marketing filler such as "designed to", "seamlessly", "powerful", "the ultimate" or "say goodbye to".');
  if (gates.prose !== false) lines.push('Put a link after a sentence that says what it is. Put any money figure in a clause that says who pays. Use the product\'s own words, never a metaphor for it.');
  if (gates.dashes) lines.push('Do not use dashes between clauses. Use a comma, a colon or a full stop.');
  return lines.join('\n');
}
