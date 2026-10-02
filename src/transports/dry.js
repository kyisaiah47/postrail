// The dry transport. It takes a post exactly as a real transport would, checks that the text is
// there and that every media file exists, records it, and returns a receipt. Nothing leaves the
// machine. `failures` makes it throw on successive calls, which is how the tests drive the slot
// engine through a failed send.

import fs from 'node:fs';
import path from 'node:path';

export function createDryTransport({ platform = 'other', handle = 'dry', outbox = null, failures = [] } = {}) {
  const sent = [];
  const queue = failures.slice();
  return {
    kind: 'dry',
    platform,
    handle,
    sent,
    async whoami() { return { handle, id: `dry:${handle}` }; },
    async post({ text, media = [], replyTo = null } = {}) {
      if (queue.length) {
        const f = queue.shift();
        throw typeof f === 'function' ? f() : f;
      }
      if (!String(text || '').trim()) throw new Error('dry transport: the post has no text');
      for (const m of media) if (!m.path || !fs.existsSync(m.path)) throw new Error(`dry transport: media file ${m.path} does not exist`);
      const n = sent.length + 1;
      const row = {
        ts: Date.now(), platform, handle, text, replyTo,
        media: media.map((m) => ({ path: m.path, kind: m.kind, mime: m.mime, alt: m.alt || '' })),
      };
      sent.push(row);
      if (outbox) {
        fs.mkdirSync(path.dirname(outbox), { recursive: true });
        fs.appendFileSync(outbox, JSON.stringify(row) + '\n');
      }
      return { id: `dry-${n}`, url: `dry://${platform}/${handle}/${n}`, verified: true, dry: true };
    },
  };
}
