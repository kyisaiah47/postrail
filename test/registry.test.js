import test from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig, ownHandles } from '../src/index.js';
import { SUBJECT, account } from './fixtures.js';

const check = (accounts, extra = {}) => validateConfig({ timezone: 'America/New_York', subjects: [SUBJECT], accounts, ...extra });

test('a valid registry fills every default and turns replies off', () => {
  const { config, errors } = check([account('alpha', { cadence: { perDay: 2 } })]);
  assert.deepEqual(errors, []);
  const a = config.accounts[0];
  assert.deepEqual(a.cadence.window, [8, 22]);
  assert.equal(a.cadence.minGapMin, 90);
  assert.equal(a.caps.postsPerDay, 2);
  assert.equal(a.caps.repliesPerDay, 20);
  assert.equal(config.replies.enabled, false);
  assert.equal(config.replies.authorCooldownH, 168);
  assert.equal(config.copyGates.noise, true);
});

test('Reddit is refused wherever it appears', () => {
  assert.match(check([account('r1', { platform: 'reddit' })]).errors.join(' '), /no Reddit support/);
  assert.match(check([account('r2', { transport: { kind: 'browser', recipe: { composeUrl: 'https://www.reddit.com/submit' } } })]).errors.join(' '), /no Reddit support/);
});

test('a transport that cannot reach the platform, an unknown platform and a bad window are refused', () => {
  assert.match(check([account('a', { platform: 'x', transport: { kind: 'bluesky' } })]).errors.join(' '), /cannot post to x/);
  assert.match(check([account('a', { platform: 'myspace' })]).errors.join(' '), /is not one of/);
  assert.match(check([account('a', { cadence: { perDay: 2, window: [22, 8] } })]).errors.join(' '), /cadence.window/);
  assert.match(check([account('a', { cadence: { perDay: 0 } })]).errors.join(' '), /perDay must be 1 or more/);
});

test('media forms are checked against what the platform takes', () => {
  assert.match(check([account('ig', { platform: 'instagram', transport: { kind: 'instagram' }, media: { default: { none: 1 } } })]).errors.join(' '), /instagram cannot carry the "none" form|needs media on every post/);
  assert.match(check([account('yt', { platform: 'youtube', transport: { kind: 'youtube' }, media: { default: { card: 1 } } })]).errors.join(' '), /cannot carry the "card" form/);
  assert.match(check([account('b', { transport: { kind: 'bluesky' }, media: { default: { shorts: 1 } } })]).errors.join(' '), /cannot carry the "shorts" form/);
});

test('a slot kind or a subject the config does not declare is refused', () => {
  assert.match(check([account('a', { mix: { meme: 1 } })]).errors.join(' '), /no entry in slots/);
  assert.match(check([account('a', { subjects: ['missing'] })]).errors.join(' '), /not declared in subjects/);
});

test('ownHandles knows every account in the registry', () => {
  const { config } = check([account('alpha'), account('beta', { handle: '@Beta_Example' })]);
  const own = ownHandles(config);
  assert.ok(own.has('alpha.bsky.social'));
  assert.ok(own.has('beta_example'));
});
