import test from 'node:test';
import assert from 'node:assert/strict';
import { planDay, localClock, zonedParts, inWindow, windowBounds, slotsForDay } from '../src/index.js';
import { config, account, DATE } from './fixtures.js';

const TZ = 'America/New_York';
const localHour = (ms) => { const p = zonedParts(ms, TZ); return p.hour + p.minute / 60; };

test('a day plans the declared posts inside the window, every pair at least the gap apart', () => {
  const cfg = config({}, [account('alpha', { cadence: { perDay: 5, minGapMin: 120, window: [8, 22], jitterMin: 30 } })]);
  const slots = planDay(cfg.accounts[0], { date: DATE, timezone: TZ });
  assert.equal(slots.length, 5);
  for (const s of slots) {
    assert.ok(localHour(s.atMs) >= 8 && localHour(s.atMs) < 22, `${localClock(s.atMs, TZ)} is outside 8:00 to 22:00`);
    assert.ok(['pitch', 'teach'].includes(s.kind));
    assert.equal(s.form, 'none');
    assert.equal(s.status, 'planned');
  }
  for (let i = 1; i < slots.length; i += 1) {
    assert.ok(slots[i].atMs - slots[i - 1].atMs >= 120 * 60000, `slots ${i - 1} and ${i} are closer than the gap`);
  }
});

test('the same day always plans the same way, and another day plans differently', () => {
  const a = config().accounts[0];
  const one = planDay(a, { date: DATE, timezone: TZ });
  const two = planDay(a, { date: DATE, timezone: TZ });
  const other = planDay(a, { date: '2026-10-06', timezone: TZ });
  assert.deepEqual(one, two);
  assert.notDeepEqual(one.map((s) => localClock(s.atMs, TZ)), other.map((s) => localClock(s.atMs, TZ)));
});

test('the slot mix decides the kinds, and a weight of zero never rolls', () => {
  const a = config({}, [account('alpha', { cadence: { perDay: 6, minGapMin: 60 }, mix: { pitch: 1, teach: 0 } })]).accounts[0];
  for (const date of ['2026-10-05', '2026-10-06', '2026-10-07']) {
    assert.ok(planDay(a, { date, timezone: TZ }).every((s) => s.kind === 'pitch'));
  }
});

test('a day outside cadence.days plans nothing', () => {
  const a = config({}, [account('alpha', { cadence: { perDay: 2, days: [1, 2, 3, 4, 5] } })]).accounts[0];
  assert.equal(planDay(a, { date: '2026-10-04', timezone: TZ }).length, 0);
  assert.equal(planDay(a, { date: '2026-10-05', timezone: TZ }).length, 2);
});

test('a window too short for the posts at the gap holds only what fits, and the cap holds', () => {
  const tight = config({}, [account('alpha', { cadence: { perDay: 10, minGapMin: 120, window: [8, 12] } })]).accounts[0];
  assert.equal(slotsForDay(tight), 3);
  const capped = config({}, [account('alpha', { cadence: { perDay: 6, minGapMin: 60 }, caps: { postsPerDay: 2 } })]).accounts[0];
  assert.equal(planDay(capped, { date: DATE, timezone: TZ }).length, 2);
});

test('the window is local time, including the day the clocks change', () => {
  const a = config({}, [account('alpha', { cadence: { perDay: 6, minGapMin: 90 } })]).accounts[0];
  for (const date of ['2026-11-01', '2026-03-08']) {
    const slots = planDay(a, { date, timezone: TZ });
    assert.equal(slots.length, 6);
    for (const s of slots) assert.ok(localHour(s.atMs) >= 8 && localHour(s.atMs) < 22, `${date} ${localClock(s.atMs, TZ)}`);
    const { open, close } = windowBounds(a, date, TZ);
    assert.equal(localHour(open), 8);
    assert.equal(localHour(close), 22);
  }
});

test('inWindow answers for the account at an instant', () => {
  const a = config().accounts[0];
  const { open, close } = windowBounds(a, DATE, TZ);
  assert.equal(inWindow(a, open + 60000, TZ), true);
  assert.equal(inWindow(a, open - 60000, TZ), false);
  assert.equal(inWindow(a, close, TZ), false);
});
