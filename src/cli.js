// postrail <command> [options]
//
//   validate                 check the config and print every problem
//   plan [--date D]          print each account's day: time, slot kind, media form, status
//   run [--dry] [--account ID] [--at ISO]
//                            one tick: post every slot that is due, then exit. Run it from cron,
//                            launchd or a systemd timer every 10 to 15 minutes.
//   resume <account>         clear a halt after you have dealt with the platform signal
//   review [--days N] [--list] [--json]
//                            read the actual text of recent posts and replies and flag repetition
//   card --title T [--body B] [--name N] [--url U] [--size S] --out FILE
//                            draw a card (FILE.svg, and FILE.png when a renderer is installed)
//   cut --sheet FILE --out FILE.mp4 [--base DIR]
//                            render a video cut from a spec sheet with ffmpeg
//   login <account>          open a browser-transport account in a visible window to sign in once
//   new-app --app console|simple|both [--dir DIR]
//                            scaffold a Next.js dashboard of the day's rolls and posts
//
// Every command takes --config FILE (default: postrail.config.json, then postrail.config.mjs).

import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, validateConfig, mustValidate, accountById } from './registry.js';
import { createFileStore } from './store.js';
import { createProvider } from './providers/index.js';
import { runTick } from './engine.js';
import { localDate } from './time.js';
import { localClock, planDay } from './schedule.js';
import { review, formatReview, listTable, hasFindings } from './review.js';
import { writeCard } from './media/card.js';
import { cutPlan, renderCut, validateSpecSheet } from './media/video.js';
import { transportFor } from './transports/index.js';
import { scaffoldApp } from './scaffold/index.js';
import { exitCode } from './slots.js';

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      if (v !== undefined) out[k] = v;
      else if (argv[i + 1] && !argv[i + 1].startsWith('--')) { out[k] = argv[i + 1]; i += 1; } else out[k] = true;
    } else out._.push(a);
  }
  return out;
}

function findConfig(given) {
  if (given) return given;
  for (const f of ['postrail.config.json', 'postrail.config.mjs', 'postrail.config.js']) if (fs.existsSync(f)) return f;
  throw new Error('no config found. Pass --config FILE or create postrail.config.json (see examples/).');
}

async function load(args) {
  const file = findConfig(args.config);
  const { config: raw, dir } = await loadConfig(file);
  const { config, warnings } = mustValidate(raw);
  const store = createFileStore(path.resolve(dir, config.stateDir));
  return { config, store, dir, warnings };
}

const HELP = fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.replace(/^\/\/ ?/, '')).join('\n');

export async function main(argv = process.argv.slice(2), { stdout = (s) => process.stdout.write(`${s}\n`) } = {}) {
  const args = parseArgs(argv);
  const cmd = args._[0];
  if (!cmd || cmd === 'help' || args.help) { stdout(HELP); return 0; }

  if (cmd === 'validate') {
    const { config: raw } = await loadConfig(findConfig(args.config));
    const { errors, warnings, config } = validateConfig(raw);
    for (const w of warnings) stdout(`warning: ${w}`);
    for (const e of errors) stdout(`error: ${e}`);
    if (!errors.length) stdout(`ok: ${config.accounts.length} account(s), time zone ${config.timezone}, replies ${config.replies.enabled ? 'ON' : 'off'}`);
    return errors.length ? 1 : 0;
  }

  if (cmd === 'plan') {
    const { config, store } = await load(args);
    const date = args.date || localDate(Date.now(), config.timezone);
    const saved = store.readPlan(date);
    for (const a of config.accounts) {
      const slots = (saved && saved.accounts[a.id]) || (a.enabled ? planDay(a, { date, timezone: config.timezone }) : []);
      stdout(`${a.id} (${a.platform} ${a.handle})${a.enabled ? '' : ' disabled'}: ${slots.length} slot(s) on ${date}, window ${a.cadence.window[0]}:00 to ${a.cadence.window[1]}:00 ${config.timezone}`);
      for (const s of slots) stdout(`  ${localClock(s.atMs, config.timezone)}  ${s.kind.padEnd(8)} ${s.form.padEnd(9)} ${s.status}${s.url ? `  ${s.url}` : ''}`);
      const halt = store.readHalt(a.id);
      if (halt) stdout(`  HALTED: ${halt.signal}. ${halt.step}`);
    }
    return 0;
  }

  if (cmd === 'run') {
    const { config, store, dir, warnings } = await load(args);
    for (const w of warnings) stdout(`warning: ${w}`);
    if (!config.provider) throw new Error('the config has no provider. Add one (see README, "Bring your own model").');
    const provider = createProvider(config.provider);
    const at = args.at ? Date.parse(args.at) : null;
    const res = await runTick({
      config, store, provider, dryRun: Boolean(args.dry), only: args.account || null, baseDir: dir,
      now: () => (at || Date.now()), log: (s) => stdout(`  ${s}`),
      transportOpts: { outbox: path.join(store.dir, 'outbox.jsonl') },
    });
    for (const r of res.results) {
      if (r.status === 'posted') stdout(`${r.accountId}: posted ${r.url || ''} after ${r.attempts} attempt(s)`);
      else if (r.status === 'stopped' || r.status === 'halted') stdout(`${r.accountId}: STOPPED by ${r.signal}. ${r.step}`);
      else stdout(`${r.accountId}: ${r.status}${r.why ? `, ${r.why}` : ''}${r.error ? `, ${r.error}` : ''}`);
    }
    if (!res.results.length) stdout('nothing is due.');
    return res.exitCode;
  }

  if (cmd === 'resume') {
    const { store } = await load(args);
    const id = args._[1];
    if (!id) throw new Error('usage: postrail resume <account>');
    stdout(store.clearHalt(id) ? `${id}: halt cleared. The next tick will post its owed slots.` : `${id} was not halted.`);
    return 0;
  }

  if (cmd === 'review') {
    const { store } = await load(args);
    const rows = store.rows({});
    if (args.list) { stdout(listTable(rows, { days: Number(args.days || 1) })); return 0; }
    const r = review(rows, { days: Number(args.days || 14) });
    stdout(args.json ? JSON.stringify(r, null, 2) : formatReview(r));
    return hasFindings(r) ? 2 : 0;
  }

  if (cmd === 'card') {
    if (!args.title || !args.out) throw new Error('usage: postrail card --title T --out FILE [--body B] [--name N] [--url U] [--size landscape|square|portrait|og|vertical|wide] [--theme dark|light]');
    const item = await writeCard({ title: args.title, body: args.body || '', name: args.name || '', url: args.url || '', size: args.size || 'landscape', theme: args.theme || 'dark' }, { out: args.out });
    stdout(`wrote ${item.path}`);
    return 0;
  }

  if (cmd === 'cut') {
    if (!args.sheet || !args.out) throw new Error('usage: postrail cut --sheet FILE --out FILE.mp4 [--base DIR]');
    const sheet = JSON.parse(fs.readFileSync(args.sheet, 'utf8'));
    const base = path.resolve(args.base || path.dirname(args.sheet));
    const errs = validateSpecSheet(sheet, { baseDir: base });
    if (errs.length) { for (const e of errs) stdout(`error: ${e}`); return 1; }
    const work = `${args.out}.work`;
    const plan = cutPlan(sheet, { baseDir: base, workDir: work, out: path.resolve(args.out), name: sheet.name || '', url: sheet.url || '' });
    const res = await renderCut(plan, { caption: sheet.caption || '' });
    stdout(`wrote ${res.file} (${res.durationSec.toFixed(1)} seconds)`);
    return 0;
  }

  if (cmd === 'login') {
    const { config } = await load(args);
    const account = accountById(config, args._[1]);
    if (!account) throw new Error(`no account "${args._[1]}" in the config`);
    if (account.transport.kind !== 'browser') throw new Error(`${account.id} uses the ${account.transport.kind} transport, which signs in with its API credentials`);
    const who = await transportFor(account).login();
    stdout(`${account.id}: signed in as ${who.handle}`);
    return 0;
  }

  if (cmd === 'new-app') {
    const mode = args.app;
    if (!['console', 'simple', 'both'].includes(mode)) throw new Error('usage: postrail new-app --app console|simple|both [--dir DIR]');
    const dir = path.resolve(args.dir || 'postrail-app');
    const files = scaffoldApp({ dir, mode, configPath: args.config ? path.resolve(args.config) : null });
    stdout(`wrote ${files.length} files to ${dir}`);
    stdout('next: cd into it, run `npm install`, then `npm run dev`. Set POSTRAIL_CONFIG to your config path if it is not ../postrail.config.json.');
    return 0;
  }

  stdout(`unknown command "${cmd}"\n\n${HELP}`);
  return 1;
}

export async function cli() {
  try {
    process.exitCode = await main();
  } catch (e) {
    process.stderr.write(`postrail: ${e.message}\n`);
    process.exitCode = exitCode(e) || 1;
  }
}
