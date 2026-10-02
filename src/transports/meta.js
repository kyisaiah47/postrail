// Threads and Instagram, over Meta's official APIs. Both publish in two steps: create a media
// container, wait until it is ready, then publish it. Both fetch media from a public URL rather
// than taking bytes, so an image or a video needs `mediaDir` plus `mediaBaseUrl` on the transport
// (or a `url` on the media item, or `hostMedia` in code).
//
//   transport: { kind: 'threads', tokenEnv: 'THREADS_TOKEN', userId: 'me',
//                mediaDir: './public-media', mediaBaseUrl: 'https://media.example.com' }
//   transport: { kind: 'instagram', tokenEnv: 'IG_TOKEN', userId: '<ig user id>',
//                apiVersion: 'v23.0', mediaDir: '...', mediaBaseUrl: '...' }

import { call, need, publicUrl, sleep } from './http.js';
import { PlatformSignal, SlotStillOwed, TransportError } from '../slots.js';
import { normHandle } from '../registry.js';

function graph(fetchImpl, base, token, platform) {
  return async (method, path, params = {}) => {
    const qs = new URLSearchParams({ ...params, access_token: token });
    if (method === 'GET') return call(fetchImpl, `${base}${path}?${qs}`, { platform });
    return call(fetchImpl, `${base}${path}`, {
      method, headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: qs.toString(), platform,
    });
  };
}

async function waitReady(req, id, field, ready, failed, { pollMs, platform }) {
  for (let n = 0; n < 90; n += 1) {
    const r = await req('GET', `/${id}`, { fields: `${field},error_message` }).catch(() => null);
    const v = r && r.json && r.json[field];
    if (v && ready.includes(v)) return;
    if (v && failed.includes(v)) throw new TransportError(`${platform}: the media container failed (${(r.json && r.json.error_message) || v})`);
    await sleep(pollMs);
  }
  throw new TransportError(`${platform}: the media container was not ready in time`, { retryable: true });
}

export function createThreadsTransport(account, { env = process.env, fetch: fetchImpl = globalThis.fetch, hostMedia, pollMs = 2000 } = {}) {
  const t = account.transport;
  const base = String(t.apiBase || 'https://graph.threads.net/v1.0').replace(/\/+$/, '');
  const req = (...a) => graph(fetchImpl, base, need(env, t.tokenEnv, 'the Threads access token'), 'threads')(...a);
  let me = null;
  const whoami = async () => {
    if (!me) { const r = await req('GET', '/me', { fields: 'id,username' }); me = { handle: r.json.username, id: r.json.id }; }
    return me;
  };
  return {
    kind: 'threads',
    platform: 'threads',
    handle: account.handle,
    whoami,
    async post({ text, media = [], replyTo = null } = {}) {
      const who = await whoami();
      if (normHandle(who.handle) !== normHandle(account.handle)) throw new PlatformSignal('identity-mismatch', `the token belongs to @${who.handle}, the registry names @${normHandle(account.handle)}`);
      const user = t.userId || who.id;
      const params = { text };
      const m = media[0];
      if (m) {
        const url = await publicUrl(m, { mediaDir: t.mediaDir, mediaBaseUrl: t.mediaBaseUrl, hostMedia });
        if (m.kind === 'video') Object.assign(params, { media_type: 'VIDEO', video_url: url });
        else Object.assign(params, { media_type: 'IMAGE', image_url: url });
      } else params.media_type = 'TEXT';
      if (replyTo) params.reply_to_id = String(replyTo.id || replyTo);
      const container = (await req('POST', `/${user}/threads`, params)).json.id;
      if (m) await waitReady(req, container, 'status', ['FINISHED'], ['ERROR', 'EXPIRED'], { pollMs, platform: 'threads' });
      const id = (await req('POST', `/${user}/threads_publish`, { creation_id: container })).json.id;
      let url = null;
      try { url = (await req('GET', `/${id}`, { fields: 'permalink' })).json.permalink || null; } catch { url = null; }
      return { id, url: url || `https://www.threads.com/@${who.handle}`, verified: Boolean(url) };
    },
  };
}

export function createInstagramTransport(account, { env = process.env, fetch: fetchImpl = globalThis.fetch, hostMedia, pollMs = 3000 } = {}) {
  const t = account.transport;
  const base = String(t.apiBase || `https://graph.instagram.com/${t.apiVersion || 'v23.0'}`).replace(/\/+$/, '');
  const req = (...a) => graph(fetchImpl, base, need(env, t.tokenEnv, 'the Instagram access token'), 'instagram')(...a);
  let me = null;
  const whoami = async () => {
    if (!me) { const r = await req('GET', '/me', { fields: 'user_id,username' }); me = { handle: r.json.username, id: r.json.user_id || r.json.id }; }
    return me;
  };
  return {
    kind: 'instagram',
    platform: 'instagram',
    handle: account.handle,
    whoami,
    async post({ text, media = [] } = {}) {
      const who = await whoami();
      if (normHandle(who.handle) !== normHandle(account.handle)) throw new PlatformSignal('identity-mismatch', `the token belongs to @${who.handle}, the registry names @${normHandle(account.handle)}`);
      const m = media[0];
      if (!m) throw new SlotStillOwed('Instagram needs an image or a video on every post', { kind: 'media' });
      if (m.mime === 'image/svg+xml') throw new SlotStillOwed('Instagram does not take SVG. Install @resvg/resvg-js so cards render as PNG.', { kind: 'media' });
      const user = t.userId || who.id;
      const url = await publicUrl(m, { mediaDir: t.mediaDir, mediaBaseUrl: t.mediaBaseUrl, hostMedia });
      const params = { caption: text };
      if (m.kind === 'video') Object.assign(params, { media_type: 'REELS', video_url: url });
      else Object.assign(params, { image_url: url, ...(m.alt ? { alt_text: m.alt.slice(0, 1000) } : {}) });
      const container = (await req('POST', `/${user}/media`, params)).json.id;
      await waitReady(req, container, 'status_code', ['FINISHED'], ['ERROR', 'EXPIRED'], { pollMs, platform: 'instagram' });
      const id = (await req('POST', `/${user}/media_publish`, { creation_id: container })).json.id;
      let permalink = null;
      try { permalink = (await req('GET', `/${id}`, { fields: 'permalink' })).json.permalink || null; } catch { permalink = null; }
      return { id, url: permalink || `https://www.instagram.com/${who.handle}/`, verified: Boolean(permalink) };
    },
  };
}
