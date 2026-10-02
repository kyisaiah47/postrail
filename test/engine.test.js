import test from 'node:test';
import assert from 'node:assert/strict';
import {
  runTick, ensurePlan, createMemoryStore, createStubProvider, createDryTransport, PlatformSignal, TransportError,
} from '../src/index.js';
import { config, account, noSleep, DATE } from './fixtures.js';

const CLEAN = 'Acme Parse turns an invoice into JSON fields. https://acme.example';
const NOISY = 'Introducing Acme Parse, the ultimate way to parse invoices seamlessly.';

function setup({ accounts, extra, failures = [] } = {}) {
  const cfg = config(extra || {}, accounts || [account('alpha', { mix: { pitch: 1 } })]);
  const store = createMemoryStore();
  const plan = ensurePlan(cfg, store, DATE);
  const transports = new Map();
  const tf = (acct) => {
    if (!transports.has(acct.id)) transports.set(acct.id, createDryTransport({ platform: acct.platform, handle: acct.handle, failures: acct.id === 'alpha' ? failures : [] }));
    return transports.get(acct.id);
  };
  return { cfg, store, plan, tf, transports };
}

test('the slot engine retries a refused draft inside the same slot, and the second draft posts', async () => {
  const { cfg, store, plan, tf } = setup();
  const provider = createStubProvider({ responses: [NOISY, CLEAN] });
  const first = plan.accounts.alpha[0];
  const res = await runTick({ config: cfg, store, provider, transportFor: tf, now: () => first.atMs + 60000, sleep: noSleep });
  assert.equal(res.exitCode, 0);
  const r = res.results[0];
  assert.equal(r.status, 'posted');
  assert.equal(r.attempts, 2);
  assert.match(r.refusals[0], /filler/);
  assert.equal(provider.calls.length, 2);
  assert.match(provider.calls[1].prompt, /Your last draft was refused/);
  const rows = store.rows({ kind: 'post' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].text, CLEAN);
  assert.equal(store.readPlan(DATE).accounts.alpha[0].status, 'posted');
});

test('a failed send is retried with the same draft, then posts', async () => {
  const fail = () => new TransportError('the network dropped', { retryable: true });
  const { cfg, store, plan, tf, transports } = setup({ failures: [fail(), fail()] });
  const provider = createStubProvider({ responses: [CLEAN] });
  const res = await runTick({ config: cfg, store, provider, transportFor: tf, now: () => plan.accounts.alpha[0].atMs + 60000, sleep: noSleep });
  assert.equal(res.results[0].status, 'posted');
  assert.equal(res.results[0].attempts, 1);
  assert.equal(provider.calls.length, 1);
  assert.equal(transports.get('alpha').sent.length, 1);
});

test('the platform refusing the content composes a new draft inside the slot', async () => {
  const { cfg, store, plan, tf } = setup({ failures: [new TransportError('text is not allowed', { status: 400, body: 'invalid text' })] });
  const provider = createStubProvider({ responses: [CLEAN, 'A call to Acme Parse is charged only when it succeeds.'] });
  const res = await runTick({ config: cfg, store, provider, transportFor: tf, now: () => plan.accounts.alpha[0].atMs + 60000, sleep: noSleep });
  assert.equal(res.results[0].status, 'posted');
  assert.equal(res.results[0].attempts, 2);
});

test('a captcha stops the slot, halts the account, and the slot stays owed until resume', async () => {
  const { cfg, store, plan, tf } = setup({ failures: [new PlatformSignal('captcha', 'a challenge page')] });
  const provider = createStubProvider({ responses: [CLEAN] });
  const at = plan.accounts.alpha[0].atMs + 60000;
  const first = await runTick({ config: cfg, store, provider, transportFor: tf, now: () => at, sleep: noSleep });
  assert.equal(first.exitCode, 0);
  assert.equal(first.results[0].status, 'stopped');
  assert.equal(first.results[0].signal, 'captcha');
  assert.match(first.results[0].step, /resume/);
  assert.equal(store.readHalt('alpha').signal, 'captcha');
  assert.equal(store.readPlan(DATE).accounts.alpha[0].status, 'owed');
  assert.equal(store.rows({ kind: 'post' }).length, 0);

  const halted = await runTick({ config: cfg, store, provider, transportFor: tf, now: () => at + 15 * 60000, sleep: noSleep });
  assert.equal(halted.results[0].status, 'halted');

  store.clearHalt('alpha');
  const resumed = await runTick({ config: cfg, store, provider, transportFor: tf, now: () => at + 30 * 60000, sleep: noSleep });
  assert.equal(resumed.results[0].status, 'posted');
});

test('a fault leaves the slot owed and the tick exits 1; the next tick posts it', async () => {
  const { cfg, store, plan, tf } = setup();
  let down = true;
  const provider = createStubProvider({ respond: () => { if (down) throw new Error('the provider is down'); return CLEAN; } });
  const at = plan.accounts.alpha[0].atMs + 60000;
  const bad = await runTick({ config: cfg, store, provider, transportFor: tf, now: () => at, sleep: noSleep });
  assert.equal(bad.exitCode, 1);
  assert.equal(bad.results[0].status, 'error');
  assert.equal(store.readPlan(DATE).accounts.alpha[0].status, 'owed');
  down = false;
  const good = await runTick({ config: cfg, store, provider, transportFor: tf, now: () => at + 10 * 60000, sleep: noSleep });
  assert.equal(good.results[0].status, 'posted');
});

test('every attempt refused leaves the slot owed, never skipped', async () => {
  const { cfg, store, plan, tf } = setup();
  const provider = createStubProvider({ respond: () => NOISY });
  const res = await runTick({ config: cfg, store, provider, transportFor: tf, now: () => plan.accounts.alpha[0].atMs + 60000, sleep: noSleep, maxAttempts: 3 });
  assert.equal(res.exitCode, 0);
  assert.equal(res.results[0].status, 'owed');
  const slot = store.readPlan(DATE).accounts.alpha[0];
  assert.equal(slot.status, 'owed');
  assert.match(slot.lastRefusal, /3 attempts were each refused/);
});

test('one post per account per tick, the gap halves while behind, and the next slot waits for it', async () => {
  const { cfg, store, plan, tf } = setup();
  const provider = createStubProvider({ respond: (req, i) => [CLEAN, 'A call to Acme Parse is charged only when it succeeds.', 'Send Acme Parse a long document as a job and it calls your webhook when it finishes.'][i % 3] });
  const [s0, s1] = plan.accounts.alpha;
  const t = s1.atMs + 60000;
  const a = await runTick({ config: cfg, store, provider, transportFor: tf, now: () => t, sleep: noSleep });
  assert.equal(a.results[0].slotId, s0.id);
  const b = await runTick({ config: cfg, store, provider, transportFor: tf, now: () => t + 5 * 60000, sleep: noSleep });
  assert.equal(b.results[0].status, 'held');
  assert.equal(b.exitCode, 75);
  const c = await runTick({ config: cfg, store, provider, transportFor: tf, now: () => t + 61 * 60000, sleep: noSleep });
  assert.equal(c.results[0].status, 'posted');
  assert.equal(c.results[0].slotId, s1.id);
});

test('a post that repeats another account is refused, and a different draft posts', async () => {
  const { cfg, store, plan, tf } = setup({ accounts: [account('alpha', { mix: { pitch: 1 } }), account('beta', { mix: { pitch: 1 } })] });
  const seen = new Map();
  const provider = createStubProvider({
    respond: (req) => {
      const who = /Account: (\S+)\./.exec(req.system)[1];
      const n = (seen.get(who) || 0) + 1; seen.set(who, n);
      return n === 1 ? CLEAN : 'A call to Acme Parse is charged only when it succeeds, so a failed call costs nothing.';
    },
  });
  const at = Math.max(plan.accounts.alpha[0].atMs, plan.accounts.beta[0].atMs) + 60000;
  const res = await runTick({ config: cfg, store, provider, transportFor: tf, now: () => at, sleep: noSleep });
  const beta = res.results.find((r) => r.accountId === 'beta');
  assert.equal(beta.status, 'posted');
  assert.equal(beta.attempts, 2);
  assert.match(beta.refusals[0], /another of your accounts/);
});

test('a slot the window closed on is recorded as missed, which exits 1', async () => {
  const { cfg, store, tf } = setup();
  const provider = createStubProvider({ responses: [CLEAN] });
  const late = Date.parse('2026-10-06T02:30:00Z');
  const res = await runTick({ config: cfg, store, provider, transportFor: tf, now: () => late, sleep: noSleep });
  assert.equal(res.results[0].status, 'missed');
  assert.equal(res.exitCode, 1);
  assert.ok(store.readPlan(DATE).accounts.alpha.every((s) => s.status === 'missed'));
});

test('an identity mismatch from the transport halts the account', async () => {
  const { cfg, store, plan } = setup();
  const provider = createStubProvider({ responses: [CLEAN] });
  const wrong = () => ({ kind: 'bluesky', platform: 'bluesky', whoami: async () => ({ handle: 'someone-else.bsky.social' }), post: async () => ({}) });
  const res = await runTick({ config: cfg, store, provider, transportFor: wrong, now: () => plan.accounts.alpha[0].atMs + 60000, sleep: noSleep });
  assert.equal(res.results[0].status, 'stopped');
  assert.equal(res.results[0].signal, 'identity-mismatch');
});
