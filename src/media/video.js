// Video cuts. There is one master per format and never a second one: `shorts` (vertical) and
// `longform` (wide). A master is the skeleton: the frame size, the duration band, the beats in
// order, and what a spec sheet must say about each beat. Nothing in a master names a product.
//
// A spec sheet is written for ONE subject at the moment of posting, by the configured model, from
// the subject's own facts and source text. It is validated against the master, every quoted
// string is checked back against the source, every number on screen must appear in the source,
// and no two beats may show the same picture. Then the cut is rendered with ffmpeg and the spec
// sheet is thrown away with the run.

import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { renderCardSvg, svgToPng, THEMES } from './card.js';
import { SlotStillOwed } from '../slots.js';

const run = promisify(execFile);

export const MASTERS = {
  shorts: {
    id: 'shorts',
    width: 1080,
    height: 1920,
    fps: 30,
    durationSec: { min: 21, max: 35 },
    shotBox: { x: 60, y: 200, w: 960, h: 1140 },
    beats: [
      { id: 'v0', kind: 'title', seconds: 2.5, fields: ['head'] },
      { id: 'v1', kind: 'shot', seconds: 5, fields: ['head', 'asset'], line: 'what it is' },
      { id: 'v2', kind: 'shot', seconds: 5, fields: ['head', 'asset'], line: 'what it does for the reader' },
      { id: 'v3', kind: 'table', seconds: 4.5, fields: ['head', 'table'], line: 'the proof, as a small table' },
      { id: 'v4', kind: 'shot', seconds: 5, fields: ['head', 'asset'], line: 'what it produces' },
      { id: 'v5', kind: 'shot', seconds: 5, fields: ['head', 'asset'], line: 'how to start' },
      { id: 'v6', kind: 'title', seconds: 2.5, fields: ['head'] },
    ],
  },
  longform: {
    id: 'longform',
    width: 1920,
    height: 1080,
    fps: 30,
    durationSec: { min: 52, max: 58 },
    shotBox: { x: 100, y: 120, w: 1100, h: 840 },
    beats: [
      { id: 's1', kind: 'title', seconds: 4, fields: ['head'] },
      { id: 's2', kind: 'statement', seconds: 7, fields: ['head', 'kicker'], line: 'the problem it answers' },
      { id: 's3', kind: 'shot', seconds: 8, fields: ['head', 'asset'], line: 'what it is' },
      { id: 's4', kind: 'shot', seconds: 8, fields: ['head', 'asset'], line: 'what it costs or how to get it' },
      { id: 's5', kind: 'shot', seconds: 8, fields: ['head', 'asset'], line: 'one thing it produces' },
      { id: 's6', kind: 'statement', seconds: 7, fields: ['head', 'kicker'], line: 'one number from the facts, in a sentence' },
      { id: 's7', kind: 'table', seconds: 8, fields: ['head', 'table'], line: 'the evidence' },
      { id: 's8', kind: 'title', seconds: 5, fields: ['head'] },
    ],
  },
};

const CLIP = /\.(mp4|mov|webm|m4v)$/i;
const norm = (s) => String(s || '').toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/\s+/g, ' ').trim();

/** Validate a spec sheet against its master. Returns a list of problems; empty means valid. */
export function validateSpecSheet(sheet, { baseDir = null, sourceText = null, checkFiles = true } = {}) {
  const errs = [];
  if (!sheet || typeof sheet !== 'object') return ['the spec sheet is not an object'];
  const master = MASTERS[sheet.master];
  if (!master) return [`master must be one of ${Object.keys(MASTERS).join(', ')}`];
  const beats = sheet.beats && typeof sheet.beats === 'object' ? sheet.beats : {};
  const ids = master.beats.map((b) => b.id);
  for (const id of Object.keys(beats)) if (!ids.includes(id)) errs.push(`beat ${id} is not in the ${master.id} master`);
  let total = 0;
  const assets = new Map();
  for (const b of master.beats) {
    const v = beats[b.id];
    if (!v) { errs.push(`beat ${b.id} (${b.kind}) is missing`); continue; }
    for (const f of b.fields) {
      if (f === 'table') {
        const ok = Array.isArray(v.table) && v.table.length >= 1 && v.table.length <= 5
          && v.table.every((r) => Array.isArray(r) && r.length === 2 && r.every((c) => String(c || '').trim()));
        if (!ok) errs.push(`beat ${b.id}: table must hold one to five [label, value] rows`);
      } else if (!String(v[f] || '').trim()) errs.push(`beat ${b.id}: ${f} is empty`);
    }
    if (v.head && String(v.head).length > 90) errs.push(`beat ${b.id}: head is longer than 90 characters`);
    if (v.kicker && String(v.kicker).length > 160) errs.push(`beat ${b.id}: kicker is longer than 160 characters`);
    const secs = v.seconds === undefined ? b.seconds : Number(v.seconds);
    if (!(secs >= 1.5 && secs <= 15)) errs.push(`beat ${b.id}: seconds must be between 1.5 and 15`);
    total += Number.isFinite(secs) ? secs : 0;
    if (b.kind === 'shot' && v.asset) {
      const key = path.normalize(String(v.asset));
      if (assets.has(key)) errs.push(`beat ${b.id} shows the same picture as beat ${assets.get(key)}; no two shots may be the same`);
      assets.set(key, b.id);
      if (checkFiles && baseDir && !fs.existsSync(path.resolve(baseDir, key))) errs.push(`beat ${b.id}: asset ${v.asset} does not exist`);
    }
  }
  if (total < master.durationSec.min || total > master.durationSec.max) {
    errs.push(`the cut runs ${total.toFixed(1)} seconds and the ${master.id} master allows ${master.durationSec.min} to ${master.durationSec.max}`);
  }
  if (sourceText) {
    const src = norm(sourceText);
    const quotes = Array.isArray(sheet.quotes) ? sheet.quotes : [];
    if (!quotes.length) errs.push('quotes is empty; name the source sentences the cut is built from');
    for (const q of quotes) if (!src.includes(norm(q))) errs.push(`quote not found in the source: "${String(q).slice(0, 80)}"`);
    const onScreen = Object.values(beats).flatMap((v) => [v.head, v.kicker, ...(Array.isArray(v.table) ? v.table.flat() : [])]).filter(Boolean).join(' ');
    for (const n of new Set(onScreen.match(/\d[\d,.]*\d|\d/g) || [])) {
      if (!src.includes(n.toLowerCase())) errs.push(`the number ${n} is on screen but not in the source`);
    }
  }
  return errs;
}

function firstJson(text) {
  const t = String(text || '');
  const a = t.indexOf('{'); const b = t.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(t.slice(a, b + 1)); } catch { return null; }
}

/** The instruction the model is given to write a spec sheet. */
export function specSheetPrompt({ master, subject, sourceText, assets }) {
  const m = MASTERS[master];
  const lines = [
    `Write a spec sheet for a ${m.id} video about ${subject.name || subject.id}. Return JSON only.`,
    'Shape: {"master": "' + m.id + '", "title": string, "caption": string, "beats": {<beat id>: {...}}, "quotes": [string]}',
    'Beats, in order:',
    ...m.beats.map((b) => `- ${b.id}: ${b.kind}${b.line ? ` (${b.line})` : ''}. Fields: ${b.fields.join(', ')}.`),
    'A "head" is one plain sentence or a name, at most 90 characters. A "kicker" is one plain sentence.',
    'A "table" is one to five [label, value] rows taken from the facts.',
    `Each shot beat takes one asset from this list, and no two beats may use the same one: ${assets.map((a) => JSON.stringify(a)).join(', ')}.`,
    '"quotes" lists the exact sentences from the source that the cut is built from. Copy them character for character.',
    'Every number shown on screen must appear in the source. State nothing the source does not say.',
    '',
    'Source:',
    sourceText,
  ];
  return lines.join('\n');
}

/**
 * Ask the model for a spec sheet, validate it, and ask again with the problems when it fails.
 * Throws SlotStillOwed when no valid sheet arrives, because another form or another subject can
 * still fill the slot.
 */
export async function writeSpecSheet({ provider, master, subject, sourceText = '', assets = [], baseDir = null, tries = 3 }) {
  const source = [sourceText, ...(subject.facts || [])].filter(Boolean).join('\n');
  let critique = '';
  for (let i = 0; i < tries; i += 1) {
    const prompt = specSheetPrompt({ master, subject, sourceText: source, assets }) + (critique ? `\n\nYour last sheet was refused:\n${critique}\nFix every point.` : '');
    const sheet = firstJson(await provider.complete({ system: 'You return one JSON object and nothing else.', prompt, maxTokens: 2048 }));
    if (!sheet) { critique = 'the answer was not a JSON object'; continue; }
    sheet.master = master;
    const errs = validateSpecSheet(sheet, { baseDir, sourceText: source });
    if (!errs.length) return sheet;
    critique = errs.map((e) => `- ${e}`).join('\n');
  }
  throw new SlotStillOwed(`no valid ${master} spec sheet after ${tries} tries: ${critique.slice(0, 400)}`, { kind: 'spec-sheet' });
}

/** Draw the frame for one beat. A shot beat with a clip leaves its box empty for the overlay. */
export function beatFrameSvg(master, beatDef, beat, { baseDir = '.', theme = 'dark', name = '', url = '' } = {}) {
  const m = MASTERS[master];
  const size = { w: m.width, h: m.height };
  if (beatDef.kind === 'shot') {
    const file = path.resolve(baseDir, beat.asset);
    const image = CLIP.test(file) ? { box: m.shotBox } : { file, box: m.shotBox };
    return renderCardSvg({ title: beat.head, body: beat.kicker || '', size, theme, image });
  }
  if (beatDef.kind === 'table') return renderCardSvg({ title: beat.head, body: beat.kicker || '', size, theme, table: beat.table });
  if (beatDef.kind === 'title') return renderCardSvg({ title: beat.head, body: beat.kicker || '', name, url, size, theme });
  return renderCardSvg({ title: beat.head, body: beat.kicker || '', size, theme });
}

/**
 * Plan a cut: every beat's frame, its length, and the ffmpeg arguments for its segment, then the
 * concat. Nothing runs here, so a test can assert the plan without ffmpeg.
 */
export function cutPlan(sheet, { baseDir = '.', workDir, out, theme = 'dark', name = '', url = '' }) {
  const m = MASTERS[sheet.master];
  if (!m) throw new Error(`unknown master ${sheet.master}`);
  const bg = (typeof theme === 'string' ? THEMES[theme] : theme).panel.replace('#', '0x');
  const segments = m.beats.map((b, i) => {
    const beat = sheet.beats[b.id];
    const seconds = beat.seconds === undefined ? b.seconds : Number(beat.seconds);
    const frame = path.join(workDir, `frame-${i}-${b.id}.png`);
    const seg = path.join(workDir, `seg-${i}-${b.id}.mp4`);
    const clip = b.kind === 'shot' && CLIP.test(String(beat.asset)) ? path.resolve(baseDir, beat.asset) : null;
    const enc = ['-r', String(m.fps), '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-an', '-t', String(seconds), seg];
    const args = clip
      ? ['-y', '-loop', '1', '-t', String(seconds), '-i', frame, '-stream_loop', '-1', '-i', clip,
        '-filter_complex', `[1:v]scale=${m.shotBox.w}:${m.shotBox.h}:force_original_aspect_ratio=decrease,pad=${m.shotBox.w}:${m.shotBox.h}:(ow-iw)/2:(oh-ih)/2:color=${bg}[c];[0:v][c]overlay=${m.shotBox.x}:${m.shotBox.y},format=yuv420p`,
        ...enc]
      : ['-y', '-loop', '1', '-t', String(seconds), '-i', frame, '-vf', `scale=${m.width}:${m.height},format=yuv420p`, ...enc];
    return { beat: b.id, kind: b.kind, seconds, frame, segment: seg, clip, svg: beatFrameSvg(sheet.master, b, beat, { baseDir, theme, name, url }), args };
  });
  const list = path.join(workDir, 'segments.txt');
  return {
    master: m.id,
    width: m.width,
    height: m.height,
    durationSec: segments.reduce((s, x) => s + x.seconds, 0),
    segments,
    list,
    concatArgs: ['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', out],
    out,
  };
}

/** Render a planned cut with ffmpeg. Returns { file, durationSec, media } where `media` is the
 *  item a transport takes. */
export async function renderCut(plan, { ffmpeg = 'ffmpeg', caption = '' } = {}) {
  fs.mkdirSync(path.dirname(plan.list), { recursive: true });
  fs.mkdirSync(path.dirname(plan.out), { recursive: true });
  for (const s of plan.segments) {
    fs.writeFileSync(s.frame, await svgToPng(s.svg));
    await run(ffmpeg, s.args, { maxBuffer: 1 << 26 });
  }
  fs.writeFileSync(plan.list, plan.segments.map((s) => `file '${s.segment.replace(/'/g, "'\\''")}'`).join('\n') + '\n');
  await run(ffmpeg, plan.concatArgs, { maxBuffer: 1 << 26 });
  return { file: plan.out, durationSec: plan.durationSec, media: { path: plan.out, kind: 'video', mime: 'video/mp4', alt: caption } };
}
