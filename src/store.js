// Where PostRail keeps what it did. Three things, all plain files under the state directory:
//
//   plans/<date>.json   the day's slots for every account and what happened to each one
//   ledger.jsonl        one line per post or reply that landed, with its actual text
//   halts/<id>.json     an account stopped by a platform signal, with the one step to clear it
//
// The ledger is what the review command reads, what the reply guard compares drafts against, and
// what the min-gap and the caps count. A memory store with the same interface backs the tests.

import fs from 'node:fs';
import path from 'node:path';

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeJSON(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

function filterRows(rows, { sinceMs = 0, kind = null, accountId = null, platform = null, dry = undefined } = {}) {
  return rows.filter((r) => r.ts >= sinceMs
    && (!kind || r.kind === kind)
    && (!accountId || r.accountId === accountId)
    && (!platform || r.platform === platform)
    && (dry === undefined || Boolean(r.dry) === Boolean(dry)));
}

/** A store backed by files under `dir`. */
export function createFileStore(dir) {
  const root = path.resolve(dir);
  const ledgerFile = path.join(root, 'ledger.jsonl');
  let cache = { mtimeMs: -1, size: -1, rows: [] };
  const rows = () => {
    let st;
    try { st = fs.statSync(ledgerFile); } catch { return []; }
    if (st.mtimeMs === cache.mtimeMs && st.size === cache.size) return cache.rows;
    const out = [];
    for (const line of fs.readFileSync(ledgerFile, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try { out.push(JSON.parse(line)); } catch { /* one bad line never hides the rest */ }
    }
    out.sort((a, b) => a.ts - b.ts);
    cache = { mtimeMs: st.mtimeMs, size: st.size, rows: out };
    return out;
  };
  return {
    kind: 'file',
    dir: root,
    readPlan: (date) => readJSON(path.join(root, 'plans', `${date}.json`), null),
    writePlan: (date, plan) => writeJSON(path.join(root, 'plans', `${date}.json`), plan),
    listPlans: () => {
      try { return fs.readdirSync(path.join(root, 'plans')).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort(); } catch { return []; }
    },
    append: (row) => {
      fs.mkdirSync(root, { recursive: true });
      fs.appendFileSync(ledgerFile, JSON.stringify(row) + '\n');
    },
    rows: (filter) => filterRows(rows(), filter),
    readHalt: (id) => readJSON(path.join(root, 'halts', `${id}.json`), null),
    writeHalt: (id, halt) => writeJSON(path.join(root, 'halts', `${id}.json`), halt),
    clearHalt: (id) => { try { fs.unlinkSync(path.join(root, 'halts', `${id}.json`)); return true; } catch { return false; } },
    readJSON: (name, fallback) => readJSON(path.join(root, name), fallback),
    writeJSON: (name, value) => writeJSON(path.join(root, name), value),
  };
}

/** The same interface in memory, for tests and for dry examples. */
export function createMemoryStore(seed = []) {
  const plans = new Map();
  const halts = new Map();
  const blobs = new Map();
  const ledger = seed.slice().sort((a, b) => a.ts - b.ts);
  return {
    kind: 'memory',
    dir: null,
    readPlan: (date) => (plans.has(date) ? structuredClone(plans.get(date)) : null),
    writePlan: (date, plan) => { plans.set(date, structuredClone(plan)); },
    listPlans: () => [...plans.keys()].sort(),
    append: (row) => { ledger.push(row); ledger.sort((a, b) => a.ts - b.ts); },
    rows: (filter) => filterRows(ledger, filter),
    readHalt: (id) => halts.get(id) || null,
    writeHalt: (id, halt) => { halts.set(id, halt); },
    clearHalt: (id) => halts.delete(id),
    readJSON: (name, fallback) => (blobs.has(name) ? structuredClone(blobs.get(name)) : fallback),
    writeJSON: (name, value) => { blobs.set(name, structuredClone(value)); },
  };
}
