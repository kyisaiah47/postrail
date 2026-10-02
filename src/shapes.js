// Text shapes. The repetition checks in PostRail all read the same features of a text: its words,
// its three-word opener, the start of its closing sentence, its word trigrams and four-grams, and
// whether it asks a question. The review command, the reply guard and the post repeat gate all
// import these, so one change moves all three.

const STOP = new Set(('a an the and or but if then so of to in on at by for with from as is are was were be been being '
  + 'it its this that these those i you we they he she me us them my your our their his her what which who whom '
  + 'how why when where do does did done have has had not no can could would should will shall may might must '
  + 'just very also too more most than about into over under up down out off only own same such each any all both '
  + 'there here').split(' '));

export function words(s) {
  return String(s || '').toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[^a-z0-9'\s]/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^'+|'+$/g, ''))
    .filter(Boolean);
}

export const sentences = (s) => String(s || '').trim().split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean);

/** The first three words, the shape a reader notices first. */
export const opener = (s) => words(s).slice(0, 3).join(' ');

/** The first three words of the closing sentence, when there is more than one sentence. */
export function closer(s) {
  const ss = sentences(s);
  return ss.length >= 2 ? words(ss[ss.length - 1]).slice(0, 3).join(' ') : '';
}

export function ngrams(s, n) {
  const w = words(s);
  const g = new Set();
  for (let i = 0; i + n <= w.length; i += 1) g.add(w.slice(i, i + n).join(' '));
  return g;
}

/** Content words: the words left after common function words are removed. Two rewordings of the
 *  same pitch share these even when they share no three-word run. */
export function contentWords(s) {
  return new Set(words(s).filter((w) => w.length > 2 && !STOP.has(w)).map((w) => w.replace(/(ies|es|s)$/, '')));
}

export function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  return inter / (a.size + b.size - inter);
}

const Q_START = /^(how|what|which|why|when|where|who|whom|whose|do|does|did|are|is|was|were|can|could|would|will|have|has|had|should|shall|may|might)\b/;
const Q_WORDS = /\b(i'?m|i am|i'?d be|i would be) (curious|wondering)\b|\bi wonder\b|\bcurious (whether|how|what|which|if|why|when|where|who)\b/;

export function isQuestion(s) {
  const t = String(s || '');
  if (t.includes('?')) return true;
  const ss = sentences(t);
  const last = words(ss[ss.length - 1] || '').join(' ');
  return Q_START.test(last) || Q_WORDS.test(words(t).join(' '));
}

/** A fixed rhetorical opener reused with new topic words each time: "The hard part is X", "The
 *  useful signal is X". Two texts in this shape share almost no words, so overlap scores miss it,
 *  and a person reading forty of them in a row sees one generator. */
export const TEMPLATE_OPENER = /^the\s+\S+\s+(part|signal|edge|test|artifact|shift|skill|bar|tell|pattern|boundary|layer|thing|move)\b/i;

/** Does the text promote one of the account's own things? `promo` holds plain words or regular
 *  expression sources from the account config. */
export function isPromo(text, promo = []) {
  const t = String(text || '');
  return promo.some((p) => {
    if (!p) return false;
    try { return new RegExp(p, 'i').test(t); } catch { return t.toLowerCase().includes(String(p).toLowerCase()); }
  });
}
