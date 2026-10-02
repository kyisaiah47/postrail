// The account registry.
//
// PostRail is account first. Every real account is one entry, and each entry declares everything
// that decides how it posts: its platform and handle, its transport, its cadence and window, its
// caps, the mix of slot kinds it rolls, and the media forms each kind may carry. Nothing is shared
// between accounts unless the config says so, so pausing or deleting one account cannot change
// another account's schedule.
//
// Secrets never live in the config. A transport names the environment variables that hold its
// credentials, and the transport reads them when it posts.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** What each platform accepts. `transports` lists the official API transport first. Every
 *  platform also accepts `dry`, and every platform accepts `browser` for a website without an
 *  official posting API. `forms` lists the media forms the platform's transport can deliver. */
export const PLATFORMS = {
  bluesky: { maxChars: 300, count: 'graphemes', transports: ['bluesky'], forms: ['none', 'card'] },
  x: { maxChars: 280, count: 'x', transports: ['x'], forms: ['none', 'card', 'shorts'] },
  threads: { maxChars: 500, count: 'chars', transports: ['threads'], forms: ['none', 'card', 'shorts'] },
  linkedin: { maxChars: 3000, count: 'chars', transports: ['linkedin'], forms: ['none', 'card'] },
  instagram: { maxChars: 2200, count: 'chars', transports: ['instagram'], forms: ['card', 'shorts'], mediaRequired: true },
  youtube: { maxChars: 5000, count: 'chars', transports: ['youtube'], forms: ['shorts', 'longform'], videoRequired: true },
  tiktok: { maxChars: 2200, count: 'chars', transports: ['browser'], forms: ['card', 'shorts'], mediaRequired: true },
  facebook: { maxChars: 5000, count: 'chars', transports: ['browser'], forms: ['none', 'card', 'shorts'] },
  other: { maxChars: 500, count: 'chars', transports: ['browser'], forms: ['none', 'card', 'shorts', 'longform'] },
};

export const FORMS = ['none', 'card', 'shorts', 'longform'];

/** Built-in slot kinds. A config may add its own kinds or replace these instructions. */
export const DEFAULT_SLOTS = {
  pitch: {
    instruction: 'Write one short post about the subject, two to four sentences. Say what it is and what a reader can do with it. Use one or two of the facts given, not all of them. Include the subject URL once.',
    link: true,
    promo: true,
  },
  teach: {
    instruction: 'Write one short post, two to four sentences, that teaches one concrete thing a reader can use today, taken from one of the facts given. Do not pitch anything. Do not include a link.',
    link: false,
    promo: false,
  },
  update: {
    instruction: 'Write one short post, two or three sentences, that reports one fact about the subject from the facts given, as news. Include the subject URL once.',
    link: true,
    promo: true,
  },
};

const DEFAULT_KIND = 'pitch';
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const REDDIT = /reddit/i;

const num = (v, d) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : d);

/** Read a config from a .json file or from a .js/.mjs module whose default export is the config. */
export async function loadConfig(file) {
  const abs = path.resolve(file);
  if (/\.(m?js|cjs)$/.test(abs)) {
    const mod = await import(pathToFileURL(abs).href);
    return { config: mod.default || mod.config, dir: path.dirname(abs) };
  }
  return { config: JSON.parse(fs.readFileSync(abs, 'utf8')), dir: path.dirname(abs) };
}

export const normHandle = (h) => String(h || '').trim().toLowerCase().replace(/^@+/, '');

function checkReddit(where, value, errors) {
  if (value && REDDIT.test(JSON.stringify(value))) errors.push(`${where}: PostRail has no Reddit support and will not post there.`);
}

/**
 * Validate and normalise a config. Returns { config, errors, warnings }. The normalised config
 * carries every default filled in, so the rest of PostRail never guesses.
 */
export function validateConfig(input) {
  const errors = [];
  const warnings = [];
  const cfg = input && typeof input === 'object' ? input : {};
  const out = {
    timezone: cfg.timezone || 'UTC',
    stateDir: cfg.stateDir || '.postrail',
    provider: cfg.provider || null,
    copyGates: { noise: true, prose: true, dashes: false, repeats: true, repeatThreshold: 0.35, ...(cfg.copyGates || {}) },
    subjects: Array.isArray(cfg.subjects) ? cfg.subjects : [],
    slots: { ...DEFAULT_SLOTS, ...(cfg.slots || {}) },
    replies: {
      enabled: false,
      authorCooldownH: 168,
      promoRatioMax: 0.25,
      promoWindow: 30,
      ...(cfg.replies || {}),
    },
    accounts: [],
  };

  try { new Intl.DateTimeFormat('en-US', { timeZone: out.timezone }); } catch {
    errors.push(`timezone "${out.timezone}" is not an IANA time zone`);
  }
  if (!Array.isArray(cfg.accounts) || !cfg.accounts.length) errors.push('accounts: the config declares no accounts');
  if (out.replies.enabled === true) warnings.push('replies: the reply module is ON. Read the README section on replies before running it.');

  const subjectIds = new Set();
  for (const s of out.subjects) {
    if (!s || !s.id) { errors.push('subjects: every subject needs an id'); continue; }
    if (subjectIds.has(s.id)) errors.push(`subjects: duplicate id "${s.id}"`);
    subjectIds.add(s.id);
    if (!Array.isArray(s.facts) || !s.facts.length) errors.push(`subjects.${s.id}: a subject needs at least one fact`);
    checkReddit(`subjects.${s.id}`, s, errors);
  }
  for (const [kind, def] of Object.entries(out.slots)) {
    if (!def || typeof def.instruction !== 'string' || !def.instruction.trim()) errors.push(`slots.${kind}: needs an instruction`);
  }

  const ids = new Set();
  for (const raw of cfg.accounts || []) {
    const id = raw && raw.id;
    const where = `accounts.${id || '?'}`;
    if (!id) { errors.push('accounts: every account needs an id'); continue; }
    if (ids.has(id)) errors.push(`${where}: duplicate id`);
    ids.add(id);
    checkReddit(where, raw, errors);

    const platform = String(raw.platform || '').toLowerCase();
    const spec = PLATFORMS[platform];
    if (!spec) errors.push(`${where}: platform "${raw.platform}" is not one of ${Object.keys(PLATFORMS).join(', ')}`);
    if (!raw.handle) errors.push(`${where}: needs a handle`);

    const transport = { ...(raw.transport || {}) };
    const tkind = String(transport.kind || '');
    if (!tkind) errors.push(`${where}: transport.kind is required`);
    else if (spec && !['dry', 'browser', ...spec.transports].includes(tkind)) {
      errors.push(`${where}: transport "${tkind}" cannot post to ${platform}. Use one of ${[...new Set(['dry', ...spec.transports, 'browser'])].join(', ')}`);
    }
    if (spec && tkind === 'browser' && spec.transports[0] !== 'browser') {
      warnings.push(`${where}: ${platform} has an official API transport ("${spec.transports[0]}"). The browser transport drives the website instead.`);
    }

    const cad = raw.cadence || {};
    const window = Array.isArray(cad.window) ? cad.window.map(Number) : [8, 22];
    if (window.length !== 2 || !(window[0] >= 0 && window[1] <= 24 && window[0] < window[1])) {
      errors.push(`${where}: cadence.window must be [startHour, endHour] with 0 <= start < end <= 24`);
    }
    const perDay = num(cad.perDay, 0);
    if (!(perDay >= 1)) errors.push(`${where}: cadence.perDay must be 1 or more`);
    const days = Array.isArray(cad.days) ? cad.days.map(Number) : ALL_DAYS;
    if (days.some((d) => !(d >= 0 && d <= 6))) errors.push(`${where}: cadence.days holds 0 (Sunday) to 6 (Saturday)`);
    const cadence = {
      perDay,
      window,
      days,
      minGapMin: num(cad.minGapMin, 90),
      jitterMin: num(cad.jitterMin, 15),
    };
    if (cadence.minGapMin < 0) errors.push(`${where}: cadence.minGapMin cannot be negative`);
    const windowMin = (window[1] - window[0]) * 60;
    if (perDay > 1 && cadence.minGapMin * (perDay - 1) > windowMin) {
      warnings.push(`${where}: ${perDay} posts with a ${cadence.minGapMin} minute gap do not fit in a ${window[1] - window[0]} hour window. The plan holds ${Math.floor(windowMin / Math.max(1, cadence.minGapMin)) + 1}.`);
    }

    const caps = {
      postsPerDay: num(raw.caps && raw.caps.postsPerDay, perDay),
      repliesPerDay: num(raw.caps && raw.caps.repliesPerDay, 20),
    };
    if (caps.postsPerDay < perDay) warnings.push(`${where}: caps.postsPerDay (${caps.postsPerDay}) is below cadence.perDay (${perDay}); the plan holds ${caps.postsPerDay}.`);

    const mix = raw.mix && typeof raw.mix === 'object' ? raw.mix : { [DEFAULT_KIND]: 1 };
    const mixTotal = Object.values(mix).reduce((s, w) => s + (Number(w) > 0 ? Number(w) : 0), 0);
    if (!mixTotal) errors.push(`${where}: mix needs at least one positive weight`);
    for (const kind of Object.keys(mix)) {
      if (Number(mix[kind]) > 0 && !out.slots[kind]) errors.push(`${where}: mix names slot kind "${kind}", which has no entry in slots`);
    }

    const media = raw.media && typeof raw.media === 'object' ? raw.media : { default: { none: 1 } };
    for (const [slotKind, weights] of Object.entries(media)) {
      for (const [form, w] of Object.entries(weights || {})) {
        if (!(Number(w) > 0)) continue;
        if (!FORMS.includes(form)) errors.push(`${where}: media.${slotKind} names form "${form}". Forms are ${FORMS.join(', ')}`);
        else if (spec && tkind !== 'dry' && !spec.forms.includes(form)) errors.push(`${where}: ${platform} cannot carry the "${form}" form. It takes ${spec.forms.join(', ')}`);
      }
    }
    if (spec && (spec.mediaRequired || spec.videoRequired)) {
      for (const kind of Object.keys(mix)) {
        const w = media[kind] || media.default || {};
        if (Number(w.none) > 0) errors.push(`${where}: ${platform} needs media on every post, and media.${media[kind] ? kind : 'default'} allows "none"`);
      }
    }

    const subjects = Array.isArray(raw.subjects) ? raw.subjects : out.subjects.map((s) => s.id);
    for (const s of subjects) if (!subjectIds.has(s)) errors.push(`${where}: subject "${s}" is not declared in subjects`);

    out.accounts.push({
      id,
      platform,
      handle: String(raw.handle || ''),
      enabled: raw.enabled !== false,
      transport,
      cadence,
      caps,
      mix,
      media,
      subjects,
      noRepeatLast: num(raw.noRepeatLast, Math.max(0, Math.min(2, subjects.length - 1))),
      voice: raw.voice || '',
      links: raw.links !== false,
      hashtags: raw.hashtags === true,
      promo: Array.isArray(raw.promo) ? raw.promo : [],
      maxChars: num(raw.maxChars, spec ? spec.maxChars : 500),
      count: spec ? spec.count : 'chars',
      replies: { ...(raw.replies || {}) },
    });
  }
  return { config: out, errors, warnings };
}

/** Validate and throw a readable error when the config is wrong. */
export function mustValidate(input) {
  const res = validateConfig(input);
  if (res.errors.length) {
    const e = new Error(`The PostRail config has ${res.errors.length} problem(s):\n  ${res.errors.join('\n  ')}`);
    e.errors = res.errors;
    throw e;
  }
  return res;
}

export function accountById(config, id) {
  return config.accounts.find((a) => a.id === id) || null;
}

/** Every handle the config owns, normalised. The reply module uses it to recognise our own
 *  accounts in a thread. */
export function ownHandles(config) {
  const out = new Set();
  for (const a of config.accounts) {
    const h = normHandle(a.handle);
    if (h) {
      out.add(h);
      out.add(h.split('.')[0]);
    }
  }
  return out;
}

export function subjectById(config, id) {
  return config.subjects.find((s) => s.id === id) || null;
}
