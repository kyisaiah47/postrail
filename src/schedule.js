// The day plan.
//
// Each account's day is planned once and saved. The plan spreads the account's posts across its
// window, keeps every pair of posts at least `minGapMin` apart, jitters each time so the account
// never posts on a fixed clock, and rolls each slot's kind from the account's mix and its media
// form from the media weights. The roll is seeded by the account id and the date, so the same day
// always plans the same way.
//
// A slot that comes due and has not posted stays owed for the rest of its day. When an account is
// behind, the engine halves the gap so the backlog drains inside the window instead of being
// carried as a loss. A slot the window closes on is recorded as missed, never dropped silently.

import { seededRng, rollWeighted } from './rng.js';
import { dayOfWeek, parseDate, zonedToUtc, zonedParts, localDate } from './time.js';

/** The instants a window opens and closes on a local date. */
export function windowBounds(account, date, timezone) {
  const { year, month, day } = parseDate(date);
  const [start, end] = account.cadence.window;
  const sh = Math.floor(start); const sm = Math.round((start - sh) * 60);
  const eh = Math.floor(end); const em = Math.round((end - eh) * 60);
  const open = zonedToUtc({ year, month, day, hour: sh, minute: sm }, timezone);
  let close;
  if (eh >= 24) {
    const next = new Date(Date.UTC(year, month - 1, day + 1));
    close = zonedToUtc({ year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate(), hour: 0, minute: 0 }, timezone);
  } else {
    close = zonedToUtc({ year, month, day, hour: eh, minute: em }, timezone);
  }
  return { open, close };
}

/** Is the account's window open at this instant? */
export function inWindow(account, nowMs, timezone) {
  const date = localDate(nowMs, timezone);
  if (!account.cadence.days.includes(dayOfWeek(date))) return false;
  const { open, close } = windowBounds(account, date, timezone);
  return nowMs >= open && nowMs < close;
}

/** How many posts fit in the window at the account's gap, capped by its daily cap. */
export function slotsForDay(account) {
  const [start, end] = account.cadence.window;
  const windowMin = (end - start) * 60;
  const gap = account.cadence.minGapMin;
  const fit = gap > 0 ? Math.floor(windowMin / gap) + 1 : account.cadence.perDay;
  return Math.max(0, Math.min(account.cadence.perDay, account.caps.postsPerDay, fit));
}

/**
 * Plan one account's day. Returns the slots in time order:
 *   { id, accountId, date, index, at, atMs, kind, form, status: 'planned' }
 */
export function planDay(account, { date, timezone = 'UTC', seed = '' } = {}) {
  if (!date) throw new Error('planDay needs a date');
  if (!account.cadence.days.includes(dayOfWeek(date))) return [];
  const rng = seededRng(`${seed}|${account.id}|${date}`);
  const { open, close } = windowBounds(account, date, timezone);
  const windowMin = (close - open) / 60000;
  const n = slotsForDay(account);
  if (!n) return [];
  const gap = account.cadence.minGapMin;
  const seg = windowMin / n;
  const J = Math.max(0, Math.min(account.cadence.jitterMin, (seg - gap) / 2));
  const offsets = [];
  for (let i = 0; i < n; i += 1) {
    const base = seg * (i + 0.5);
    offsets.push(base + (rng() * 2 - 1) * J);
  }
  // Keep every pair at least the gap apart and every slot inside the window.
  for (let i = 0; i < n; i += 1) {
    offsets[i] = Math.max(offsets[i], 0, i ? offsets[i - 1] + gap : 0);
  }
  for (let i = n - 1; i >= 0; i -= 1) {
    const ceiling = i === n - 1 ? windowMin - 1 : offsets[i + 1] - gap;
    offsets[i] = Math.min(offsets[i], ceiling);
  }
  return offsets.map((off, index) => {
    const atMs = open + Math.round(off) * 60000;
    const kind = rollWeighted(account.mix, rng) || Object.keys(account.mix)[0];
    const weights = account.media[kind] || account.media.default || { none: 1 };
    const form = rollWeighted(weights, rng) || 'none';
    return {
      id: `${account.id}:${date}:${index}`,
      accountId: account.id,
      date,
      index,
      at: new Date(atMs).toISOString(),
      atMs,
      kind,
      form,
      status: 'planned',
    };
  });
}

/** Plan every enabled account for a date. */
export function planAll(config, { date, seed = '' }) {
  const out = {};
  for (const a of config.accounts) if (a.enabled) out[a.id] = planDay(a, { date, timezone: config.timezone, seed });
  return out;
}

/**
 * The gap the next post must respect. An account is behind when more than one slot is owed, or
 * when the owed slot's planned time came before the last post went out (the last post was itself
 * late). While it is behind, the gap halves so the backlog drains inside the window.
 */
export function isBehind(due, lastPostMs) {
  return due.length > 1 || Boolean(due.length && lastPostMs && lastPostMs > due[0].atMs);
}

export function effectiveGapMin(account, behind) {
  const gap = account.cadence.minGapMin;
  return behind ? Math.floor(gap / 2) : gap;
}

/** Human-readable local time of a slot, for the plan printout. */
export function localClock(ms, timezone) {
  const p = zonedParts(ms, timezone);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}
