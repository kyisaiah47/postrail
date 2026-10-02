// LinkedIn, over the Posts API.
//
//   transport: { kind: 'linkedin', tokenEnv: 'LINKEDIN_TOKEN',
//                author: 'urn:li:person:<id>' or 'urn:li:organization:<id>',
//                version: '202609' }
//
// A member token needs the w_member_social scope; an organization author needs
// w_organization_social and a page role. Every request carries the LinkedIn-Version header in
// YYYYMM form and X-Restli-Protocol-Version 2.0.0. LinkedIn retires a version about a year after
// it ships, so the default is the month two months before today; set `version` to pin one.
// Images are uploaded through the Images API (initializeUpload, then a PUT of the bytes). The
// created post's URN comes back in the x-restli-id header.

import { call, need, bytesOf } from './http.js';
import { PlatformSignal, SlotStillOwed } from '../slots.js';

const API = 'https://api.linkedin.com';

export function defaultVersion(now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1));
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function createLinkedInTransport(account, { env = process.env, fetch: fetchImpl = globalThis.fetch } = {}) {
  const t = account.transport;
  const version = String(t.version || defaultVersion());
  const headers = (extra = {}) => ({
    authorization: `Bearer ${need(env, t.tokenEnv, 'the LinkedIn access token')}`,
    'linkedin-version': version,
    'x-restli-protocol-version': '2.0.0',
    ...extra,
  });

  let me = null;
  async function whoami() {
    if (!me) {
      const r = await call(fetchImpl, `${API}/v2/userinfo`, { headers: { authorization: `Bearer ${need(env, t.tokenEnv, 'the LinkedIn access token')}` }, platform: 'linkedin' });
      me = { handle: account.handle, id: r.json.sub, name: r.json.name };
    }
    return me;
  }

  async function author() {
    const who = await whoami();
    const mine = `urn:li:person:${who.id}`;
    if (!t.author) return mine;
    if (String(t.author).startsWith('urn:li:person:') && t.author !== mine) {
      throw new PlatformSignal('identity-mismatch', `the token belongs to ${mine}, the registry names ${t.author}`);
    }
    return t.author;
  }

  async function uploadImage(owner, m) {
    const init = await call(fetchImpl, `${API}/rest/images?action=initializeUpload`, {
      method: 'POST', headers: headers({ 'content-type': 'application/json' }),
      body: JSON.stringify({ initializeUploadRequest: { owner } }), platform: 'linkedin',
    });
    const { uploadUrl, image } = init.json.value;
    await call(fetchImpl, uploadUrl, { method: 'PUT', headers: { authorization: headers().authorization }, body: bytesOf(m), platform: 'linkedin', raw: true });
    return image;
  }

  return {
    kind: 'linkedin',
    platform: 'linkedin',
    handle: account.handle,
    whoami,
    async post({ text, media = [] } = {}) {
      const owner = await author();
      const body = {
        author: owner,
        commentary: text,
        visibility: 'PUBLIC',
        distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
        lifecycleState: 'PUBLISHED',
        isReshareDisabledByAuthor: false,
      };
      const m = media[0];
      if (m) {
        if (m.kind === 'video') throw new SlotStillOwed('the LinkedIn transport carries images, not video. Roll another form.', { kind: 'media' });
        if (m.mime === 'image/svg+xml') throw new SlotStillOwed('LinkedIn does not take SVG. Install @resvg/resvg-js so cards render as PNG.', { kind: 'media' });
        body.content = { media: { id: await uploadImage(owner, m), altText: String(m.alt || '').slice(0, 4086) } };
      }
      const r = await call(fetchImpl, `${API}/rest/posts`, { method: 'POST', headers: headers({ 'content-type': 'application/json' }), body: JSON.stringify(body), platform: 'linkedin' });
      const id = r.headers.get('x-restli-id');
      return { id, url: id ? `https://www.linkedin.com/feed/update/${id}/` : null, verified: Boolean(id) };
    },
  };
}
