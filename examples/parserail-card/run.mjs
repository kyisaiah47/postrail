#!/usr/bin/env node
// The worked example: three synthetic accounts post about ParseRail, a real product, from facts
// read off its live page. Every post goes to the dry transport, so nothing leaves the machine.
//
//   node examples/parserail-card/run.mjs            the writer is a fixed stub, no network at all
//   node examples/parserail-card/run.mjs --gemini   the writer is Gemini (needs GEMINI_API_KEY)
//
// What it shows:
//   1. the day plan for each account (times inside each window, the minimum gap, the rolled kinds)
//   2. one tick: the first draft for a pitch carries filler, the noise gate refuses it, the slot
//      composes again inside the same tick, and the second draft posts
//   3. the card each post carries, written to examples/parserail-card/out/media/
//   4. the dry outbox, which is exactly what each transport was handed, in examples/parserail-card/out/
//
// Everything the example writes goes to out/ beside this file. Git ignores that folder.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadConfig, mustValidate, createFileStore, createStubProvider, createProvider, runTick, ensurePlan, localClock,
} from '../../src/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** A stand-in writer that answers from the facts. Its first pitch is deliberately full of filler,
 *  so the example shows the gate refusing a draft and the slot composing again. */
export function stubWriter() {
  let pitches = 0;
  return createStubProvider({
    respond: (req) => {
      if (/Slot kind: pitch/.test(req.prompt)) {
        pitches += 1;
        if (pitches === 1) return 'Introducing ParseRail, the ultimate document API. Say goodbye to manual data entry and parse everything seamlessly!';
        return 'ParseRail reads a document and sends back its fields as JSON. A call is charged only when it succeeds, so a failed call costs nothing. https://parserail.thecompound.tech';
      }
      if (/Platform: x\./.test(req.system)) return 'A long document can go to ParseRail as a job. ParseRail calls your webhook when the job finishes.';
      return 'One ParseRail wallet pays for any endpoint, and a paused endpoint answers 503 without charging anything.';
    },
  });
}

export async function runExample({ outDir = path.join(HERE, 'out'), useModel = false, log = (s) => process.stdout.write(`${s}\n`) } = {}) {
  const { config: raw, dir } = await loadConfig(path.join(HERE, 'postrail.config.json'));
  const { config } = mustValidate(raw);
  fs.rmSync(outDir, { recursive: true, force: true });
  const store = createFileStore(path.join(outDir, 'state'));
  const provider = useModel ? createProvider(config.provider) : stubWriter();

  const date = '2026-10-05';
  const plan = ensurePlan(config, store, date);
  log(`The plan for ${date} (${config.timezone}):`);
  for (const [id, slots] of Object.entries(plan.accounts)) {
    log(`  ${id}: ${slots.map((s) => `${localClock(s.atMs, config.timezone)} ${s.kind} with ${s.form}`).join(', ')}`);
  }

  const at = Math.max(...Object.values(plan.accounts).filter((s) => s.length).map((s) => s[0].atMs)) + 60000;
  log(`\nOne tick at ${localClock(at, config.timezone)}, every account on the dry transport:`);
  const res = await runTick({
    config, store, provider, dryRun: true, now: () => at, baseDir: dir,
    outDir: path.join(outDir, 'media'),
    transportOpts: { outbox: path.join(outDir, 'outbox.jsonl') },
    sleep: async () => {},
    log: (s) => log(`    ${s}`),
  });
  for (const r of res.results) {
    log(`  ${r.accountId}: ${r.status}${r.attempts ? ` after ${r.attempts} attempt(s)` : ''}${r.form ? `, media: ${r.form}` : ''}${r.error ? `, ${r.error}` : ''}${r.why ? `, ${r.why}` : ''}`);
    if (r.text) log(`    "${r.text}"`);
  }
  const outboxFile = path.join(outDir, 'outbox.jsonl');
  const outbox = fs.existsSync(outboxFile) ? fs.readFileSync(outboxFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];
  log(`\nThe dry outbox holds ${outbox.length} post(s). Cards are in ${path.join(outDir, 'media')}.`);
  return { res, store, outbox, plan };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runExample({ useModel: process.argv.includes('--gemini') }).catch((e) => {
    process.stderr.write(`${e.message}\n`);
    process.exitCode = 1;
  });
}
