// Seeded randomness. A day's plan for an account is rolled from a seed made of the account id and
// the date, so the same day always plans the same way and a test can assert the exact schedule.

function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i += 1) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

function mulberry32(a) {
  let s = a >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A function returning numbers in [0, 1), fixed by `seed`. */
export function seededRng(seed) {
  return mulberry32(xmur3(String(seed))());
}

/**
 * One weighted draw over a plain { key: weight } table. Weights are relative and need not sum to
 * one. Returns null when the table is empty or every weight is zero, so a missing table is never
 * silently replaced by a default.
 */
export function rollWeighted(weights, rng = Math.random) {
  if (!weights || typeof weights !== 'object') return null;
  const entries = Object.entries(weights).filter(([, w]) => Number(w) > 0);
  const total = entries.reduce((s, [, w]) => s + Number(w), 0);
  if (!total) return null;
  let r = rng() * total;
  for (const [key, w] of entries) {
    r -= Number(w);
    if (r < 0) return key;
  }
  return entries[entries.length - 1][0];
}
