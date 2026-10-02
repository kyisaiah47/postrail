// YouTube, over the YouTube Data API v3.
//
//   transport: { kind: 'youtube', clientIdEnv: 'YT_CLIENT_ID', clientSecretEnv: 'YT_CLIENT_SECRET',
//                refreshTokenEnv: 'YT_REFRESH_TOKEN', privacyStatus: 'public', categoryId: '28' }
//
// The transport trades the refresh token for an access token, checks that the token's channel is
// the one the registry names, uploads the video with a resumable upload (videos.insert), and uses
// the post text as the description and its first line as the title. Every post needs a video.

import { call, need, bytesOf, mimeOf } from './http.js';
import { PlatformSignal, SlotStillOwed } from '../slots.js';
import { normHandle } from '../registry.js';

export function createYouTubeTransport(account, { env = process.env, fetch: fetchImpl = globalThis.fetch } = {}) {
  const t = account.transport;
  let token = null;
  async function accessToken() {
    if (token) return token;
    const body = new URLSearchParams({
      client_id: need(env, t.clientIdEnv, 'the YouTube OAuth client id'),
      client_secret: need(env, t.clientSecretEnv, 'the YouTube OAuth client secret'),
      refresh_token: need(env, t.refreshTokenEnv, 'the YouTube refresh token'),
      grant_type: 'refresh_token',
    });
    const r = await call(fetchImpl, 'https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: body.toString(), platform: 'youtube',
    });
    token = r.json.access_token;
    return token;
  }
  let me = null;
  async function whoami() {
    if (!me) {
      const r = await call(fetchImpl, 'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', { headers: { authorization: `Bearer ${await accessToken()}` }, platform: 'youtube' });
      const item = (r.json.items || [])[0];
      if (!item) throw new PlatformSignal('own-timeline', 'the token has no YouTube channel');
      me = { handle: item.snippet.customUrl || item.snippet.title, id: item.id };
    }
    return me;
  }
  return {
    kind: 'youtube',
    platform: 'youtube',
    handle: account.handle,
    whoami,
    async post({ text, media = [] } = {}) {
      const who = await whoami();
      if (normHandle(who.handle) !== normHandle(account.handle)) throw new PlatformSignal('identity-mismatch', `the token belongs to ${who.handle}, the registry names ${account.handle}`);
      const video = media.find((m) => m.kind === 'video');
      if (!video) throw new SlotStillOwed('YouTube needs a video on every post', { kind: 'media' });
      const lines = String(text).split('\n').map((l) => l.trim()).filter(Boolean);
      const title = (lines[0] || account.handle).slice(0, 100);
      const bytes = bytesOf(video);
      const meta = {
        snippet: { title, description: String(text).slice(0, 5000), categoryId: String(t.categoryId || '28') },
        status: { privacyStatus: t.privacyStatus || 'public', selfDeclaredMadeForKids: false },
      };
      const start = await call(fetchImpl, 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${await accessToken()}`,
          'content-type': 'application/json; charset=UTF-8',
          'x-upload-content-type': mimeOf(video),
          'x-upload-content-length': String(bytes.length),
        },
        body: JSON.stringify(meta),
        platform: 'youtube',
      });
      const location = start.headers.get('location');
      const up = await call(fetchImpl, location, { method: 'PUT', headers: { 'content-type': mimeOf(video) }, body: bytes, platform: 'youtube' });
      const id = up.json.id;
      return { id, url: `https://www.youtube.com/watch?v=${id}`, verified: Boolean(id) };
    },
  };
}
