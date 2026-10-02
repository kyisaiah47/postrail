// Synthetic accounts and subjects for the tests. No real handle appears anywhere in the suite.

import { validateConfig } from '../src/index.js';

export const SUBJECT = {
  id: 'acme',
  name: 'Acme Parse',
  url: 'https://acme.example',
  facts: [
    'Acme Parse turns an invoice into JSON fields.',
    'A call is charged only when it succeeds.',
    'A long document can run as a job that calls a webhook when it finishes.',
  ],
};

export function account(id, extra = {}) {
  return {
    id,
    platform: 'bluesky',
    handle: `${id}.bsky.social`,
    transport: { kind: 'dry' },
    cadence: { perDay: 4, minGapMin: 120, window: [8, 22], jitterMin: 20 },
    mix: { pitch: 0.5, teach: 0.5 },
    media: { default: { none: 1 } },
    promo: ['Acme'],
    ...extra,
  };
}

export function config(extra = {}, accounts = [account('alpha')]) {
  const res = validateConfig({ timezone: 'America/New_York', subjects: [SUBJECT], accounts, ...extra });
  if (res.errors.length) throw new Error(res.errors.join('\n'));
  return res.config;
}

export const noSleep = async () => {};

/** A fixed Monday in October 2026, in New York. */
export const DATE = '2026-10-05';
