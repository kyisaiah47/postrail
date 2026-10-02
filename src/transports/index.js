// One way to deliver a finished post. Every transport answers the same two calls:
//
//   transport.whoami()                               -> { handle, id }
//   transport.post({ text, media, replyTo })         -> { id, url, verified }
//
// so the engine never cares which one ran. `dryRun: true` swaps every account onto the dry
// transport, which checks the post and records it without sending anything.

import { createDryTransport } from './dry.js';
import { createBlueskyTransport } from './bluesky.js';
import { createXTransport } from './x.js';
import { createThreadsTransport, createInstagramTransport } from './meta.js';
import { createLinkedInTransport } from './linkedin.js';
import { createYouTubeTransport } from './youtube.js';
import { createBrowserTransport } from './browser.js';

export {
  createDryTransport, createBlueskyTransport, createXTransport, createThreadsTransport,
  createInstagramTransport, createLinkedInTransport, createYouTubeTransport, createBrowserTransport,
};

export function transportFor(account, opts = {}) {
  const kind = account.transport.kind;
  if (opts.dryRun || kind === 'dry') {
    return createDryTransport({ platform: account.platform, handle: account.handle, outbox: opts.outbox || null, failures: opts.failures || [] });
  }
  switch (kind) {
    case 'bluesky': return createBlueskyTransport(account, opts);
    case 'x': return createXTransport(account, opts);
    case 'threads': return createThreadsTransport(account, opts);
    case 'instagram': return createInstagramTransport(account, opts);
    case 'linkedin': return createLinkedInTransport(account, opts);
    case 'youtube': return createYouTubeTransport(account, opts);
    case 'browser': return createBrowserTransport(account, opts);
    default: throw new Error(`no transport named "${kind}"`);
  }
}
