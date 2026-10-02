// The provider interface, checked against a fake fetch. Keys are passed in an explicit env object,
// so no test ever reads a real key from the environment.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createProvider, createStubProvider, ProviderError } from '../src/index.js';

function fake(reply) {
  const calls = [];
  const fn = async (url, init) => { calls.push({ url, headers: init.headers, body: JSON.parse(init.body) }); return new Response(JSON.stringify(reply), { status: 200 }); };
  fn.calls = calls;
  return fn;
}

test('openai: chat completions with a bearer key', async () => {
  const f = fake({ choices: [{ message: { content: ' A post. ' } }] });
  const p = createProvider({ kind: 'openai', model: 'some-model' }, { env: { OPENAI_API_KEY: 'k1' }, fetch: f });
  assert.equal(await p.complete({ system: 'S', prompt: 'P', maxTokens: 50 }), 'A post.');
  assert.equal(f.calls[0].url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(f.calls[0].headers.authorization, 'Bearer k1');
  assert.deepEqual(f.calls[0].body.messages, [{ role: 'system', content: 'S' }, { role: 'user', content: 'P' }]);
  assert.equal(f.calls[0].body.max_completion_tokens, 50);
});

test('anthropic: the messages API with x-api-key and a version header', async () => {
  const f = fake({ content: [{ type: 'text', text: 'A post.' }] });
  const p = createProvider({ kind: 'anthropic', model: 'some-model' }, { env: { ANTHROPIC_API_KEY: 'k2' }, fetch: f });
  assert.equal(await p.complete({ system: 'S', prompt: 'P' }), 'A post.');
  assert.equal(f.calls[0].url, 'https://api.anthropic.com/v1/messages');
  assert.equal(f.calls[0].headers['x-api-key'], 'k2');
  assert.equal(f.calls[0].headers['anthropic-version'], '2023-06-01');
  assert.equal(f.calls[0].body.system, 'S');
});

test('gemini: generateContent with the key in a header', async () => {
  const f = fake({ candidates: [{ content: { parts: [{ text: 'A ' }, { text: 'post.' }] } }] });
  const p = createProvider({ kind: 'gemini', model: 'gemini-2.5-flash' }, { env: { GEMINI_API_KEY: 'k3' }, fetch: f });
  assert.equal(await p.complete({ system: 'S', prompt: 'P' }), 'A post.');
  assert.match(f.calls[0].url, /models\/gemini-2\.5-flash:generateContent$/);
  assert.equal(f.calls[0].headers['x-goog-api-key'], 'k3');
  assert.deepEqual(f.calls[0].body.systemInstruction, { parts: [{ text: 'S' }] });
});

test('openai-compatible: any base URL, including a local model with no key', async () => {
  const f = fake({ choices: [{ message: { content: 'Local.' } }] });
  const p = createProvider({ kind: 'openai-compatible', model: 'llama3.1', baseURL: 'http://localhost:11434/v1/' }, { env: {}, fetch: f });
  assert.equal(await p.complete({ prompt: 'P' }), 'Local.');
  assert.equal(f.calls[0].url, 'http://localhost:11434/v1/chat/completions');
  assert.equal(f.calls[0].headers.authorization, undefined);
  assert.equal(f.calls[0].body.max_tokens, 4096);
});

test('a missing key, a missing model and an HTTP error are clear errors', async () => {
  await assert.rejects(createProvider({ kind: 'gemini', model: 'm' }, { env: {}, fetch: fake({}) }).complete({ prompt: 'P' }), /GEMINI_API_KEY/);
  assert.throws(() => createProvider({ kind: 'openai' }), /needs a model/);
  const failing = async () => new Response('quota', { status: 429 });
  await assert.rejects(createProvider({ kind: 'gemini', model: 'm' }, { env: { GEMINI_API_KEY: 'k' }, fetch: failing }).complete({ prompt: 'P' }), (e) => e instanceof ProviderError && e.status === 429);
});

test('the stub answers in order and records every request', async () => {
  const s = createStubProvider({ responses: ['one', 'two'] });
  assert.equal(await s.complete({ prompt: 'a' }), 'one');
  assert.equal(await s.complete({ prompt: 'b' }), 'two');
  assert.equal(await s.complete({ prompt: 'c' }), 'two');
  assert.equal(s.calls.length, 3);
});

test('a model that hits its output limit is reported as a cut-off draft', async () => {
  const gem = async () => new Response(JSON.stringify({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: 'You pay $0.08 for' }] } }] }), { status: 200 });
  await assert.rejects(createProvider({ kind: 'gemini', model: 'm' }, { env: { GEMINI_API_KEY: 'k' }, fetch: gem }).complete({ prompt: 'P' }), (e) => e.truncated === true);
  const oa = async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: 'cut' } }] }), { status: 200 });
  await assert.rejects(createProvider({ kind: 'openai', model: 'm' }, { env: { OPENAI_API_KEY: 'k' }, fetch: oa }).complete({ prompt: 'P' }), (e) => e.truncated === true);
});

test('a provider outage is retried with backoff, and a quota answer is not', async () => {
  let n = 0;
  const flaky = async () => { n += 1; return n < 3 ? new Response('busy', { status: 503 }) : new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Back.' }] } }] }), { status: 200 }); };
  assert.equal(await createProvider({ kind: 'gemini', model: 'm', retryDelayMs: 1 }, { env: { GEMINI_API_KEY: 'k' }, fetch: flaky }).complete({ prompt: 'P' }), 'Back.');
  assert.equal(n, 3);
  let q = 0;
  const quota = async () => { q += 1; return new Response('quota', { status: 429 }); };
  await assert.rejects(createProvider({ kind: 'gemini', model: 'm', retryDelayMs: 1 }, { env: { GEMINI_API_KEY: 'k' }, fetch: quota }).complete({ prompt: 'P' }));
  assert.equal(q, 1);
});
