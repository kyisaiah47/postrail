// The engine. One tick looks at every enabled account, finds the slot that is due, and runs it
// until a post lands or the platform says stop.
//
//   - The day is planned once per account and saved, so a restart never re-rolls it.
//   - One post per account per tick, and never inside the min-gap. While an account is behind,
//     the gap halves so the backlog drains inside the window.
//   - A slot runs through attempts(): compose, gate, build media, send. A refused draft, a media
//     step that fails or a platform that rejects the content all compose again inside the same
//     slot. A failed send is retried with backoff before it counts as a refusal.
//   - A platform signal stops the slot, writes a halt for the account with the one step a person
//     has to take, and leaves the slot owed. Nothing else stops a slot.
//   - A fault (a provider outage, a missing credential) leaves the slot owed for the next tick and
//     makes the tick exit 1.

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { attempts, PlatformSignal, SlotStillOwed, TransportError, isOurs, isTheirs } from './slots.js';
import { planDay, inWindow, effectiveGapMin, isBehind, windowBounds } from './schedule.js';
import { localDate, parseDate, zonedToUtc } from './time.js';
import { transportFor } from './transports/index.js';
import { composeDraft, pickSubject, cleanDraft } from './copy/compose.js';
import { checkCopy } from './copy/gates.js';
import { writeCard, pngRenderer, PLATFORM_CARD } from './media/card.js';
import { writeSpecSheet, cutPlan, renderCut } from './media/video.js';
import { createReplyGuard } from './replies/guard.js';
import { isPromo, sentences } from './shapes.js';
import { normHandle, PLATFORMS } from './registry.js';

const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

function dayStart(nowMs, tz) {
  return zonedToUtc({ ...parseDate(localDate(nowMs, tz)), hour: 0, minute: 0 }, tz);
}

/** Read the saved plan for a date, planning any account it does not hold yet. */
export function ensurePlan(config, store, date) {
  const plan = store.readPlan(date) || { date, timezone: config.timezone, accounts: {} };
  let changed = false;
  for (const a of config.accounts) {
    if (!a.enabled || plan.accounts[a.id]) continue;
    plan.accounts[a.id] = planDay(a, { date, timezone: config.timezone });
    changed = true;
  }
  if (changed || !store.readPlan(date)) store.writePlan(date, plan);
  return plan;
}

/** The media forms to try for a slot, starting with the rolled one, then the others the account
 *  allows for that kind in order of weight. */
export function formOrder(account, slot) {
  const weights = account.media[slot.kind] || account.media.default || { none: 1 };
  const allowed = account.transport.kind === 'dry' ? null : (PLATFORMS[account.platform] || {}).forms;
  const rest = Object.entries(weights).filter(([f, w]) => Number(w) > 0 && f !== slot.form).sort((a, b) => b[1] - a[1]).map(([f]) => f);
  return [slot.form, ...rest].filter((f) => !allowed || allowed.includes(f));
}

/** Build the media for one form. Returns [] for 'none'. Throws SlotStillOwed when this form
 *  cannot be built for this subject, so the slot moves on to another form. */
export async function buildMedia({ form, account, subject, text, slot, provider, outDir, dryRun, baseDir }) {
  if (form === 'none') return [];
  if (form === 'card') {
    const renderer = await pngRenderer();
    if (!renderer && !dryRun) throw new Error('cards need @resvg/resvg-js or playwright to render a PNG. Install one of them.');
    const first = sentences(text)[0] || subject?.name || '';
    const card = {
      title: (subject && (subject.headline || subject.name)) || first,
      body: subject && subject.headline ? first : (subject && subject.facts ? subject.facts[0] : ''),
      name: subject ? subject.name || subject.id : '',
      url: subject ? subject.url || '' : '',
      size: PLATFORM_CARD[account.platform] || 'landscape',
      theme: (subject && subject.cardTheme) || 'dark',
    };
    const item = await writeCard(card, { out: path.join(outDir, slot.id.replace(/[^\w.-]+/g, '_')) });
    return [item];
  }
  if (form === 'shorts' || form === 'longform') {
    const assets = (subject && subject.assets) || [];
    if (assets.length < 4) throw new SlotStillOwed(`a ${form} cut needs at least four pictures or clips of ${subject ? subject.name : 'the subject'} in subject.assets`, { kind: 'media' });
    const sheet = await writeSpecSheet({ provider, master: form, subject, sourceText: subject.source || '', assets, baseDir });
    const work = path.join(outDir, `${slot.id.replace(/[^\w.-]+/g, '_')}-${form}`);
    const plan = cutPlan(sheet, { baseDir, workDir: work, out: `${work}.mp4`, name: subject.name, url: subject.url || '' });
    const cut = await renderCut(plan, { caption: sheet.caption || '' });
    return [cut.media];
  }
  throw new SlotStillOwed(`unknown media form ${form}`, { kind: 'media' });
}

/** Send with retries for faults that another try can fix. A platform signal or a refusal of the
 *  content goes straight up. */
export async function sendWithRetry(transport, payload, { retries = 3, sleep = realSleep, log = () => {} } = {}) {
  let last;
  for (let i = 0; i <= retries; i += 1) {
    try {
      return await transport.post(payload);
    } catch (e) {
      if (isTheirs(e) || isOurs(e)) throw e;
      if (e instanceof TransportError && !e.retryable) {
        if (e.status === 400 || e.status === 422) throw new SlotStillOwed(`the platform refused this post: ${String(e.body || e.message).slice(0, 200)}`, { kind: 'platform-refusal' });
        throw e;
      }
      last = e;
      if (i < retries) {
        log(`send failed (${String(e.message).slice(0, 120)}), retrying`);
        await sleep(1000 * 3 ** i);
      }
    }
  }
  throw last;
}

/**
 * Run one slot to a post. Returns the result; throws PlatformSignal or a fault.
 */
export async function runSlot({ config, store, account, slot, provider, transport, now, dryRun, outDir, baseDir, maxAttempts = 12, sendRetries = 3, sleep = realSleep, log = () => {} }) {
  const slotDef = config.slots[slot.kind];
  const history = store.rows({ kind: 'post', accountId: account.id, dry: dryRun });
  const recentTexts = history.slice(-20).map((r) => r.text);
  const otherTexts = store.rows({ kind: 'post', dry: dryRun }).filter((r) => r.accountId !== account.id).slice(-50).map((r) => r.text);
  const subject = pickSubject(account, config, history, slot.id);
  const forms = formOrder(account, slot);
  let formIndex = 0;
  const { result, attempts: n, refusals } = await attempts(async (i, critique) => {
    const draft = await composeDraft({ provider, account, slotDef, kind: slot.kind, subject, gates: config.copyGates, critique, recentTexts });
    const reasons = checkCopy(draft.text, { account, allowLink: Boolean(slotDef.link && account.links), gates: config.copyGates, recent: recentTexts, others: otherTexts });
    if (reasons.length) throw new SlotStillOwed(reasons.map((r) => r.reason).join(' '), { kind: 'copy' });
    let media;
    const form = forms[Math.min(formIndex, forms.length - 1)];
    try {
      media = await buildMedia({ form, account, subject, text: draft.text, slot, provider, outDir, dryRun, baseDir });
    } catch (e) {
      if (isOurs(e) && formIndex < forms.length - 1) formIndex += 1;
      throw e;
    }
    try {
      const sent = await sendWithRetry(transport, { text: draft.text, media }, { retries: sendRetries, sleep, log });
      return { draft, media, sent, form };
    } catch (e) {
      if (isOurs(e) && e.kind === 'media' && formIndex < forms.length - 1) formIndex += 1;
      throw e;
    }
  }, { max: maxAttempts, log, what: `${account.id} ${slot.kind}` });
  const ts = now();
  store.append({
    ts, kind: 'post', accountId: account.id, platform: account.platform, handle: account.handle,
    slotId: slot.id, slot: slot.kind, form: result.form, subject: subject ? subject.id : null,
    text: result.draft.text, id: result.sent.id || null, url: result.sent.url || null, verified: Boolean(result.sent.verified),
    promo: Boolean(slotDef.promo) || isPromo(result.draft.text, account.promo), media: result.media.map((m) => m.path), dry: Boolean(dryRun),
  });
  return { status: 'posted', url: result.sent.url || null, attempts: n, refusals, form: result.form, text: result.draft.text, postedAt: ts };
}

function haltAccount(store, account, e, nowMs) {
  const halt = { accountId: account.id, signal: e.platformSignal, detail: e.detail || e.message, step: e.step, at: new Date(nowMs).toISOString() };
  store.writeHalt(account.id, halt);
  return halt;
}

/**
 * One tick for every enabled account. Returns { date, results, exitCode }.
 *
 *   provider        the model provider (createProvider or a stub)
 *   dryRun          send everything to the dry transport and mark ledger rows dry
 *   only            run one account id
 *   transportFor    override the factory (tests pass dry transports with scripted failures)
 */
export async function runTick({
  config, store, provider, now = () => Date.now(), dryRun = false, only = null,
  transportFor: tf = transportFor, transportOpts = {}, outDir = null, baseDir = process.cwd(),
  maxAttempts = 12, sendRetries = 3, sleep = realSleep, log = () => {},
}) {
  const nowMs = now();
  const tz = config.timezone;
  const date = localDate(nowMs, tz);
  const plan = ensurePlan(config, store, date);
  const media = outDir || (store.dir ? path.join(store.dir, 'media') : fs.mkdtempSync(path.join(os.tmpdir(), 'postrail-')));
  const results = [];
  let faults = 0; let posted = 0; let held = 0;

  for (const account of config.accounts) {
    if (!account.enabled || (only && account.id !== only)) continue;
    const halt = store.readHalt(account.id);
    if (halt) { results.push({ accountId: account.id, status: 'halted', signal: halt.signal, step: halt.step }); continue; }
    const slots = plan.accounts[account.id] || [];
    const due = slots.filter((s) => s.atMs <= nowMs && (s.status === 'planned' || s.status === 'owed'));
    if (!due.length) continue;

    if (!inWindow(account, nowMs, tz)) {
      const { close } = windowBounds(account, date, tz);
      if (nowMs >= close) {
        for (const s of due) { s.status = 'missed'; s.reason = 'the window closed before this slot posted, and no platform signal explains it'; }
        store.writePlan(date, plan);
        faults += 1;
        results.push({ accountId: account.id, status: 'missed', slots: due.map((s) => s.id) });
      } else {
        held += 1;
        results.push({ accountId: account.id, status: 'held', why: 'the window is closed' });
      }
      continue;
    }

    const posts = store.rows({ kind: 'post', accountId: account.id, dry: dryRun });
    const last = posts[posts.length - 1];
    const gapMin = effectiveGapMin(account, isBehind(due, last ? last.ts : null));
    if (last && nowMs - last.ts < gapMin * 60000) {
      held += 1;
      results.push({ accountId: account.id, status: 'held', why: `the last post was ${Math.round((nowMs - last.ts) / 60000)} minutes ago and the gap is ${gapMin}` });
      continue;
    }
    const today = posts.filter((r) => r.ts >= dayStart(nowMs, tz)).length;
    if (today >= account.caps.postsPerDay) {
      held += 1;
      results.push({ accountId: account.id, status: 'held', why: `the daily cap of ${account.caps.postsPerDay} is reached` });
      continue;
    }

    const slot = due[0];
    let transport;
    try {
      transport = tf(account, { ...transportOpts, dryRun });
      if (!dryRun && transport.kind !== 'linkedin') {
        const who = await transport.whoami();
        if (who && who.handle && normHandle(who.handle) !== normHandle(account.handle)) {
          throw new PlatformSignal('identity-mismatch', `the credentials sign in as @${normHandle(who.handle)}, the registry names @${normHandle(account.handle)}`);
        }
      }
      const r = await runSlot({ config, store, account, slot, provider, transport, now, dryRun, outDir: media, baseDir, maxAttempts, sendRetries, sleep, log });
      Object.assign(slot, { status: 'posted', url: r.url, attempts: r.attempts, refusals: r.refusals, form: r.form, postedAt: new Date(r.postedAt).toISOString() });
      posted += 1;
      results.push({ accountId: account.id, slotId: slot.id, ...r });
    } catch (e) {
      if (isTheirs(e)) {
        const h = haltAccount(store, account, e, nowMs);
        Object.assign(slot, { status: 'owed', lastSignal: h.signal });
        results.push({ accountId: account.id, slotId: slot.id, status: 'stopped', signal: h.signal, detail: h.detail, step: h.step });
      } else if (isOurs(e)) {
        Object.assign(slot, { status: 'owed', lastRefusal: e.message.slice(0, 400) });
        results.push({ accountId: account.id, slotId: slot.id, status: 'owed', why: e.message });
      } else {
        faults += 1;
        Object.assign(slot, { status: 'owed', lastError: String(e.message).slice(0, 400) });
        results.push({ accountId: account.id, slotId: slot.id, status: 'error', error: e.message });
      }
    }
    store.writePlan(date, plan);
  }
  const exitCode = faults ? 1 : (!posted && held ? 75 : 0);
  return { date, results, exitCode };
}

/** Write one reply to one candidate post, inside the guard. */
async function composeReply({ provider, account, candidate, guard, config, critique }) {
  const system = [
    account.voice || 'You reply to other people\'s posts as the account below, as a peer.',
    `Platform: ${account.platform}. Account: ${account.handle}. At most ${Math.min(account.maxChars, 280)} characters.`,
    guard.brief(),
    'Return only the reply text.',
  ].join('\n');
  const prompt = [
    `Their post (by @${normHandle(candidate.author)}):`,
    candidate.text,
    '',
    'Write one reply. Add one specific point that follows from what they said.',
    candidate.solicited ? 'They asked for recommendations, so naming your own work once is allowed.' : 'Do not mention or link your own work.',
    critique ? `\nYour last draft was refused: ${critique}\nWrite a different one.` : '',
  ].join('\n');
  return cleanDraft(await provider.complete({ system, prompt, maxTokens: 512 }));
}

/**
 * The reply pass for one account. Does nothing unless `config.replies.enabled` is true.
 *
 *   candidates     posts by other people: { platform, author, text, url | uri, replyTo, solicited }
 *   readAuthors    optional live thread reader, (candidate) => [handles]; authoritative when given
 */
export async function runReplies({ config, store, provider, account, candidates = [], transport = null, readAuthors = null, now = () => Date.now(), dryRun = false, tries = 3, log = () => {} }) {
  const guard = createReplyGuard({ config, store, now });
  if (!guard.enabled) return { status: 'off', sent: [], skipped: [] };
  if (store.readHalt(account.id)) return { status: 'halted', sent: [], skipped: [] };
  const t = transport || transportFor(account, { dryRun });
  const sent = []; const skipped = [];
  for (const c of candidates) {
    const pre = guard.candidate(account, c);
    if (!pre.ok) { skipped.push({ candidate: c, reasons: pre.reasons }); if (pre.reasons.some((r) => r.includes('cap is'))) break; continue; }
    const live = await guard.liveSeat(c, readAuthors);
    if (!live.ok) { skipped.push({ candidate: c, reasons: [live.reason] }); continue; }
    let text = null; let critique = ''; let promo = false; const refusals = [];
    for (let i = 0; i < tries && !text; i += 1) {
      const draft = await composeReply({ provider, account, candidate: c, guard, config, critique });
      const copy = checkCopy(draft, { account: { ...account, maxChars: Math.min(account.maxChars, 280) }, allowLink: Boolean(c.solicited), gates: { ...config.copyGates, repeats: false } });
      const shape = guard.draft(account, draft);
      const reasons = [...copy.map((x) => x.reason), ...shape.reasons];
      if (reasons.length) { critique = reasons.join(' '); refusals.push(critique); continue; }
      text = draft; promo = shape.promo;
    }
    if (!text) { skipped.push({ candidate: c, reasons: refusals }); continue; }
    try {
      const res = await sendWithRetry(t, { text, replyTo: c.replyTo || c }, { log });
      const row = {
        ts: now(), kind: 'reply', accountId: account.id, platform: account.platform, handle: account.handle,
        author: normHandle(c.author), threadRoot: pre.root, inReplyTo: c.url || c.uri || null,
        text, id: res.id || null, url: res.url || null, promo, dry: Boolean(dryRun),
      };
      store.append(row);
      sent.push(row);
    } catch (e) {
      if (isTheirs(e)) { haltAccount(store, account, e, now()); return { status: 'stopped', signal: e.platformSignal, step: e.step, sent, skipped }; }
      skipped.push({ candidate: c, reasons: [String(e.message)] });
    }
  }
  return { status: 'ran', sent, skipped };
}
