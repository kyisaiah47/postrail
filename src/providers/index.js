// One provider interface for every model. You bring your own.
//
//   const provider = createProvider({ kind: 'gemini', model: 'gemini-2.5-flash' });
//   const text = await provider.complete({ system, prompt });
//
// Kinds:
//   openai              the OpenAI API (chat completions)
//   anthropic           the Anthropic Messages API
//   gemini              the Gemini API (generateContent)
//   openai-compatible   any server that speaks the OpenAI chat completions shape at `baseURL`,
//                       including a local model (Ollama, LM Studio, vLLM, llama.cpp server)
//   stub                fixed answers, for tests and dry runs. It never touches the network.
//
// The key is read from the environment variable named by `apiKeyEnv`, and only when a call is
// made. A config never holds a key.

const DEFAULT_KEY_ENV = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  gemini: 'GEMINI_API_KEY',
  'openai-compatible': null,
};

export class ProviderError extends Error {
  constructor(message, { status = 0, body = '', truncated = false } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
    this.body = body;
    this.truncated = truncated;
  }
}

const cutOff = (kind) => new ProviderError(`${kind}: the model reached its output limit before the text was finished`, { truncated: true });

async function postJSON(fetchImpl, url, headers, body, label) {
  let res;
  try {
    res = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  } catch (e) {
    throw new ProviderError(`${label}: the request did not complete (${e.message})`);
  }
  const text = await res.text();
  if (!res.ok) throw new ProviderError(`${label} answered ${res.status}: ${text.slice(0, 300)}`, { status: res.status, body: text });
  try { return JSON.parse(text); } catch { throw new ProviderError(`${label} answered with something that is not JSON: ${text.slice(0, 200)}`); }
}

function keyFrom(env, name, kind) {
  if (!name) return null;
  const v = env[name];
  if (!v) throw new ProviderError(`the ${kind} provider needs the environment variable ${name}`);
  return v;
}

function openaiShape({ cfg, env, fetchImpl, kind }) {
  const baseURL = String(cfg.baseURL || (kind === 'openai' ? 'https://api.openai.com/v1' : '')).replace(/\/+$/, '');
  if (!baseURL) throw new ProviderError('the openai-compatible provider needs a baseURL, for example http://localhost:11434/v1');
  const keyEnv = cfg.apiKeyEnv === undefined ? DEFAULT_KEY_ENV[kind] : cfg.apiKeyEnv;
  return async ({ system, prompt, maxTokens, temperature }) => {
    const key = keyFrom(env, keyEnv, kind);
    const body = {
      model: cfg.model,
      messages: [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: prompt }],
    };
    if (kind === 'openai') body.max_completion_tokens = maxTokens; else body.max_tokens = maxTokens;
    if (temperature !== undefined) body.temperature = temperature;
    const json = await postJSON(fetchImpl, `${baseURL}/chat/completions`, key ? { authorization: `Bearer ${key}` } : {}, body, kind);
    const choice = json.choices && json.choices[0];
    if (choice && choice.finish_reason === 'length') throw cutOff(kind);
    return String((choice && choice.message && choice.message.content) || '');
  };
}

function anthropicShape({ cfg, env, fetchImpl }) {
  const baseURL = String(cfg.baseURL || 'https://api.anthropic.com/v1').replace(/\/+$/, '');
  const keyEnv = cfg.apiKeyEnv || DEFAULT_KEY_ENV.anthropic;
  return async ({ system, prompt, maxTokens, temperature }) => {
    const key = keyFrom(env, keyEnv, 'anthropic');
    const body = { model: cfg.model, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] };
    if (system) body.system = system;
    if (temperature !== undefined) body.temperature = temperature;
    const json = await postJSON(fetchImpl, `${baseURL}/messages`, { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, body, 'anthropic');
    if (json.stop_reason === 'max_tokens') throw cutOff('anthropic');
    return (json.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  };
}

function geminiShape({ cfg, env, fetchImpl }) {
  const baseURL = String(cfg.baseURL || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '');
  const keyEnv = cfg.apiKeyEnv || DEFAULT_KEY_ENV.gemini;
  return async ({ system, prompt, maxTokens, temperature }) => {
    const key = keyFrom(env, keyEnv, 'gemini');
    const generationConfig = { maxOutputTokens: maxTokens };
    if (temperature !== undefined) generationConfig.temperature = temperature;
    if (cfg.thinkingBudget !== undefined) generationConfig.thinkingConfig = { thinkingBudget: cfg.thinkingBudget };
    const body = { contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig };
    if (system) body.systemInstruction = { parts: [{ text: system }] };
    const json = await postJSON(fetchImpl, `${baseURL}/models/${encodeURIComponent(cfg.model)}:generateContent`, { 'x-goog-api-key': key }, body, 'gemini');
    const cand = json.candidates && json.candidates[0];
    if (cand && cand.finishReason === 'MAX_TOKENS') throw cutOff('gemini');
    return ((cand && cand.content && cand.content.parts) || []).filter((p) => !p.thought).map((p) => p.text || '').join('');
  };
}

/**
 * A provider that answers from a list or a function. `responses` is cycled in order; `respond`
 * is called with the request and may return a string or a promise of one.
 */
export function createStubProvider({ responses = [], respond = null, model = 'stub' } = {}) {
  let i = 0;
  const calls = [];
  return {
    kind: 'stub',
    model,
    calls,
    async complete(req) {
      calls.push(req);
      if (respond) return String(await respond(req, calls.length - 1));
      if (!responses.length) return '';
      const out = responses[Math.min(i, responses.length - 1)];
      i += 1;
      return String(typeof out === 'function' ? await out(req) : out);
    },
  };
}

export function createProvider(cfg, { env = process.env, fetch: fetchImpl = globalThis.fetch } = {}) {
  if (!cfg || !cfg.kind) throw new ProviderError('a provider needs a kind: openai, anthropic, gemini, openai-compatible or stub');
  if (cfg.kind === 'stub') return createStubProvider(cfg);
  if (!cfg.model) throw new ProviderError(`the ${cfg.kind} provider needs a model name`);
  let call;
  if (cfg.kind === 'openai' || cfg.kind === 'openai-compatible') call = openaiShape({ cfg, env, fetchImpl, kind: cfg.kind });
  else if (cfg.kind === 'anthropic') call = anthropicShape({ cfg, env, fetchImpl });
  else if (cfg.kind === 'gemini') call = geminiShape({ cfg, env, fetchImpl });
  else throw new ProviderError(`unknown provider kind "${cfg.kind}"`);
  const retries = Number.isFinite(cfg.retries) ? cfg.retries : 2;
  const delayMs = Number.isFinite(cfg.retryDelayMs) ? cfg.retryDelayMs : 3000;
  return {
    kind: cfg.kind,
    model: cfg.model,
    /** One completion. A 5xx or a dropped connection is retried with backoff; anything else, a
     *  quota answer included, goes straight to the caller. */
    async complete({ system = '', prompt, maxTokens = cfg.maxTokens || 4096, temperature = cfg.temperature }) {
      for (let i = 0; ; i += 1) {
        try {
          return String(await call({ system, prompt, maxTokens, temperature })).trim();
        } catch (e) {
          const transient = e instanceof ProviderError && !e.truncated && (e.status >= 500 || e.status === 0) && !/needs the environment variable/.test(e.message);
          if (!transient || i >= retries) throw e;
          await new Promise((r) => setTimeout(r, delayMs * 3 ** i));
        }
      }
    },
  };
}
