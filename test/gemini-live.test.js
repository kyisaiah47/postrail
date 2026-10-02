// One live call to the free Gemini API, run only when GEMINI_API_KEY is set. It proves the
// provider and the composer work against a real model, and it posts nothing: the result goes to
// the dry transport.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createProvider, createMemoryStore, runTick, ensurePlan } from '../src/index.js';
import { config, account, DATE, noSleep } from './fixtures.js';

const KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.POSTRAIL_GEMINI_MODEL || 'gemini-flash-lite-latest';

test('a real Gemini model writes a post that passes the gates', { skip: !KEY && 'GEMINI_API_KEY is not set' }, async () => {
  const cfg = config({}, [account('alpha', { mix: { pitch: 1 } })]);
  const provider = createProvider({ kind: 'gemini', model: MODEL });
  const store = createMemoryStore();
  const plan = ensurePlan(cfg, store, DATE);
  const res = await runTick({ config: cfg, store, provider, dryRun: true, now: () => plan.accounts.alpha[0].atMs + 60000, sleep: noSleep, maxAttempts: 6 });
  const r = res.results[0];
  assert.equal(r.status, 'posted', JSON.stringify(r));
  assert.ok(r.text.length > 20 && r.text.length <= 300);
  assert.ok(r.text.includes('https://acme.example'));
});
