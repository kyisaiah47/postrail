// Bluesky, over the AT Protocol.
//
//   transport: { kind: 'bluesky', service: 'https://bsky.social',
//                identifierEnv: 'BSKY_IDENTIFIER', passwordEnv: 'BSKY_APP_PASSWORD' }
//
// Use an app password, never the account password. The transport signs in with
// com.atproto.server.createSession, uploads images with com.atproto.repo.uploadBlob, writes the
// post with com.atproto.repo.createRecord, turns every URL in the text into a link facet, and
// reads the post back from the public AppView before it reports success. It carries text, up to
// four images and replies. It does not carry video.

import { call, need, mimeOf, bytesOf, pngSize } from './http.js';
import { PlatformSignal, SlotStillOwed } from '../slots.js';
import { normHandle } from '../registry.js';

const IMAGE_LIMIT = 1000000;
const URL_RE = /https?:\/\/[^\s<>"')\]]+[^\s<>"')\].,;:!?]/g;

/** Link facets with UTF-8 byte offsets, as the AT Protocol expects. */
export function linkFacets(text) {
  const enc = new TextEncoder();
  const out = [];
  for (const m of String(text).matchAll(URL_RE)) {
    const byteStart = enc.encode(text.slice(0, m.index)).length;
    const byteEnd = byteStart + enc.encode(m[0]).length;
    out.push({ index: { byteStart, byteEnd }, features: [{ $type: 'app.bsky.richtext.facet#link', uri: m[0] }] });
  }
  return out;
}

export function createBlueskyTransport(account, { env = process.env, fetch: fetchImpl = globalThis.fetch } = {}) {
  const t = account.transport;
  const service = String(t.service || 'https://bsky.social').replace(/\/+$/, '');
  const appview = String(t.appview || 'https://public.api.bsky.app').replace(/\/+$/, '');
  let session = null;

  async function signIn() {
    if (session) return session;
    const identifier = need(env, t.identifierEnv, 'the Bluesky identifier');
    const password = need(env, t.passwordEnv, 'the Bluesky app password');
    const r = await call(fetchImpl, `${service}/xrpc/com.atproto.server.createSession`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identifier, password }), platform: 'bluesky',
    });
    session = r.json;
    return session;
  }

  const auth = async () => ({ authorization: `Bearer ${(await signIn()).accessJwt}` });

  return {
    kind: 'bluesky',
    platform: 'bluesky',
    handle: account.handle,
    async whoami() {
      const s = await signIn();
      return { handle: s.handle, id: s.did };
    },
    async post({ text, media = [], replyTo = null } = {}) {
      const s = await signIn();
      if (normHandle(s.handle) !== normHandle(account.handle)) {
        throw new PlatformSignal('identity-mismatch', `signed in as @${s.handle}, the registry names @${normHandle(account.handle)}`);
      }
      const record = { $type: 'app.bsky.feed.post', text, createdAt: new Date().toISOString() };
      const facets = linkFacets(text);
      if (facets.length) record.facets = facets;
      const images = media.filter((m) => m.kind !== 'video');
      if (media.some((m) => m.kind === 'video')) throw new SlotStillOwed('the Bluesky transport carries images, not video. Roll another form.', { kind: 'media' });
      if (images.length) {
        const embedded = [];
        for (const m of images.slice(0, 4)) {
          const bytes = bytesOf(m);
          if (bytes.length > IMAGE_LIMIT) throw new SlotStillOwed(`the image is ${bytes.length} bytes and Bluesky takes at most ${IMAGE_LIMIT}`, { kind: 'media' });
          const up = await call(fetchImpl, `${service}/xrpc/com.atproto.repo.uploadBlob`, {
            method: 'POST', headers: { ...(await auth()), 'content-type': mimeOf(m) }, body: bytes, platform: 'bluesky',
          });
          const item = { alt: m.alt || '', image: up.json.blob };
          const size = pngSize(bytes);
          if (size) item.aspectRatio = size;
          embedded.push(item);
        }
        record.embed = { $type: 'app.bsky.embed.images', images: embedded };
      }
      if (replyTo) {
        record.reply = {
          root: replyTo.root || { uri: replyTo.uri, cid: replyTo.cid },
          parent: { uri: replyTo.uri, cid: replyTo.cid },
        };
      }
      const r = await call(fetchImpl, `${service}/xrpc/com.atproto.repo.createRecord`, {
        method: 'POST',
        headers: { ...(await auth()), 'content-type': 'application/json' },
        body: JSON.stringify({ repo: s.did, collection: 'app.bsky.feed.post', record }),
        platform: 'bluesky',
      });
      const { uri, cid } = r.json;
      const rkey = String(uri).split('/').pop();
      let verified = false;
      try {
        const back = await call(fetchImpl, `${appview}/xrpc/app.bsky.feed.getPosts?uris=${encodeURIComponent(uri)}`, { platform: 'bluesky' });
        verified = Array.isArray(back.json && back.json.posts) && back.json.posts.length === 1;
      } catch { verified = false; }
      return { id: uri, cid, url: `https://bsky.app/profile/${s.handle}/post/${rkey}`, verified };
    },
  };
}
