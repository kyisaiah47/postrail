// Everything the dashboard shows, read from PostRail's own files at request time: the config,
// today's saved plan (or the plan PostRail would make), the halts, and the ledger.
//
// POSTRAIL_CONFIG names the config file. The default is __CONFIG_DEFAULT__.

import path from 'node:path';
import {
  loadConfig, validateConfig, createFileStore, planDay, localDate, localClock, review, hasFindings,
} from 'postrail/read';

export async function readBoard() {
  const configPath = path.resolve(process.env.POSTRAIL_CONFIG || '__CONFIG_DEFAULT__');
  const { config: raw, dir } = await loadConfig(configPath);
  const { config, errors } = validateConfig(raw);
  const store = createFileStore(path.resolve(dir, config.stateDir));
  const now = Date.now();
  const tz = config.timezone;
  const date = localDate(now, tz);
  const saved = store.readPlan(date);
  const rows = store.rows({});
  const bySlot = new Map(rows.filter((r) => r.slotId).map((r) => [r.slotId, r]));

  const accounts = config.accounts.map((a) => {
    const slots = ((saved && saved.accounts[a.id]) || (a.enabled ? planDay(a, { date, timezone: tz }) : []))
      .map((s) => ({ ...s, local: localClock(s.atMs, tz), due: s.atMs <= now, text: bySlot.has(s.id) ? bySlot.get(s.id).text : null }));
    return {
      id: a.id,
      platform: a.platform,
      handle: a.handle,
      enabled: a.enabled,
      transport: a.transport.kind,
      window: a.cadence.window,
      perDay: a.cadence.perDay,
      minGapMin: a.cadence.minGapMin,
      caps: a.caps,
      mix: a.mix,
      halt: store.readHalt(a.id),
      slots,
      posted: slots.filter((s) => s.status === 'posted').length,
      owed: slots.filter((s) => s.due && s.status !== 'posted').length,
      next: slots.find((s) => !s.due && s.status === 'planned') || null,
    };
  });

  const recent = rows.slice(-200).reverse().map((r) => ({
    ...r,
    local: `${localDate(r.ts, tz)} ${localClock(r.ts, tz)}`,
  }));
  const findings = review(rows, { days: 14, now });

  return {
    configPath,
    configErrors: errors,
    generatedAt: now,
    date,
    timezone: tz,
    repliesOn: config.replies.enabled === true,
    accounts,
    recent,
    review: { ...findings, any: hasFindings(findings) },
  };
}
