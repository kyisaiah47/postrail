// X, over the X API v2.
//
//   transport: { kind: 'x', auth: 'oauth1',
//                consumerKeyEnv: 'X_API_KEY', consumerSecretEnv: 'X_API_SECRET',
//                accessTokenEnv: 'X_ACCESS_TOKEN', accessSecretEnv: 'X_ACCESS_SECRET' }
//   transport: { kind: 'x', auth: 'oauth2', tokenEnv: 'X_USER_TOKEN' }
//
// Posting through the X API is a paid product of X. The transport checks the signed-in user
// against the registry handle, uploads images in one request and videos in chunks
// (initialize, append, finalize, then status until processing ends), posts with POST /2/tweets,
// and reads the post back with GET /2/tweets/:id.

import crypto from 'node:crypto';
import { call, need, mimeOf, bytesOf, sleep } from './http.js';
import { PlatformSignal, TransportError } from '../slots.js';
import { normHandle } from '../registry.js';

const API = 'https://api.x.com';
const CHUNK = 4 * 1024 * 1024;

const pct = (s) => encodeURIComponent(String(s)).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** An OAuth 1.0a Authorization header (HMAC-SHA1). The query string, the oauth_ parameters and
 *  any form-encoded body `params` are signed. JSON and multipart bodies are not, as the spec
 *  requires. Returns the header; `baseString` is exposed for tests through oauth1Parts(). */
export function oauth1Header(opts) {
  return oauth1Parts(opts).header;
}

export function oauth1Parts({ method, url, consumerKey, consumerSecret, token, tokenSecret, nonce, timestamp, params = {} }) {
  const u = new URL(url);
  const oauth = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: nonce || crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(timestamp || Math.floor(Date.now() / 1000)),
    oauth_token: token,
    oauth_version: '1.0',
  };
  const signed = [...u.searchParams.entries(), ...Object.entries(params), ...Object.entries(oauth)]
    .map(([k, v]) => [pct(k), pct(v)])
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1));
  const baseString = [method.toUpperCase(), pct(`${u.origin}${u.pathname}`), pct(signed.map(([k, v]) => `${k}=${v}`).join('&'))].join('&');
  const signature = crypto.createHmac('sha1', `${pct(consumerSecret)}&${pct(tokenSecret)}`).update(baseString).digest('base64');
  const header = { ...oauth, oauth_signature: signature };
  return { baseString, signature, header: 'OAuth ' + Object.keys(header).sort().map((k) => `${pct(k)}="${pct(header[k])}"`).join(', ') };
}

export function createXTransport(account, { env = process.env, fetch: fetchImpl = globalThis.fetch, pollMs = 2000 } = {}) {
  const t = account.transport;
  const authHeader = (method, url) => {
    if ((t.auth || 'oauth1') === 'oauth2') return `Bearer ${need(env, t.tokenEnv, 'the X user access token')}`;
    return oauth1Header({
      method, url,
      consumerKey: need(env, t.consumerKeyEnv, 'the X API key'),
      consumerSecret: need(env, t.consumerSecretEnv, 'the X API secret'),
      token: need(env, t.accessTokenEnv, 'the X access token'),
      tokenSecret: need(env, t.accessSecretEnv, 'the X access token secret'),
    });
  };
  const req = (method, path, { json, form } = {}) => {
    const url = `${API}${path}`;
    const headers = { authorization: authHeader(method, url) };
    let body;
    if (json) { headers['content-type'] = 'application/json'; body = JSON.stringify(json); }
    if (form) body = form;
    return call(fetchImpl, url, { method, headers, body, platform: 'x' });
  };

  let me = null;
  async function whoami() {
    if (me) return me;
    const r = await req('GET', '/2/users/me');
    me = { handle: r.json.data.username, id: r.json.data.id };
    return me;
  }

  async function uploadImage(m) {
    const form = new FormData();
    form.append('media', new Blob([bytesOf(m)], { type: mimeOf(m) }), 'image');
    form.append('media_category', 'tweet_image');
    const r = await req('POST', '/2/media/upload', { form });
    return r.json.data.id;
  }

  async function uploadVideo(m) {
    const bytes = bytesOf(m);
    const init = await req('POST', '/2/media/upload/initialize', { json: { media_type: mimeOf(m), total_bytes: bytes.length, media_category: 'tweet_video' } });
    const id = init.json.data.id;
    for (let i = 0, seg = 0; i < bytes.length; i += CHUNK, seg += 1) {
      const form = new FormData();
      form.append('media', new Blob([bytes.subarray(i, i + CHUNK)]), 'chunk');
      form.append('segment_index', String(seg));
      await req('POST', `/2/media/upload/${id}/append`, { form });
    }
    let info = (await req('POST', `/2/media/upload/${id}/finalize`)).json.data.processing_info;
    for (let n = 0; info && info.state !== 'succeeded' && n < 60; n += 1) {
      if (info.state === 'failed') throw new TransportError(`x: video processing failed: ${JSON.stringify(info.error || {})}`);
      await sleep(Math.max(pollMs, (info.check_after_secs || 0) * 1000));
      info = (await req('GET', `/2/media/upload?command=STATUS&media_id=${encodeURIComponent(id)}`)).json.data.processing_info;
    }
    return id;
  }

  return {
    kind: 'x',
    platform: 'x',
    handle: account.handle,
    whoami,
    async post({ text, media = [], replyTo = null } = {}) {
      const who = await whoami();
      if (normHandle(who.handle) !== normHandle(account.handle)) {
        throw new PlatformSignal('identity-mismatch', `the token belongs to @${who.handle}, the registry names @${normHandle(account.handle)}`);
      }
      const ids = [];
      for (const m of media.slice(0, 4)) ids.push(m.kind === 'video' ? await uploadVideo(m) : await uploadImage(m));
      const body = { text };
      if (ids.length) body.media = { media_ids: ids };
      if (replyTo) body.reply = { in_reply_to_tweet_id: String(replyTo.id || replyTo) };
      const r = await req('POST', '/2/tweets', { json: body });
      const id = r.json.data.id;
      let verified = false;
      try { verified = Boolean((await req('GET', `/2/tweets/${id}`)).json.data); } catch { verified = false; }
      return { id, url: `https://x.com/${who.handle}/status/${id}`, verified };
    },
  };
}
