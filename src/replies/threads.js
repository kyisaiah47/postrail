// Thread roots. "Have any of our accounts already spoken in this conversation" needs one key per
// conversation, not per post, because a reply's own URL differs from its thread's. rootKey()
// turns a candidate into that key for each platform. It returns null when it cannot tell, and a
// null root is a refusal: a thread PostRail cannot name is a thread it cannot keep to one seat.

export function rootKey(platform, c = {}) {
  const p = String(platform || '').toLowerCase();
  const u = String(c.url || c.permalink || c.uri || '');
  if (p === 'x' || p === 'twitter') {
    const id = c.conversationId || (u.match(/\/status\/(\d+)/) || [])[1];
    return id ? `x:${id}` : null;
  }
  if (p === 'bluesky' || p === 'bsky') {
    const uri = (c.record && c.record.reply && c.record.reply.root && c.record.reply.root.uri) || c.rootUri || (c.root && c.root.uri) || c.uri;
    return uri ? `bluesky:${uri}` : null;
  }
  if (p === 'threads') {
    const code = c.shortcode || c.rootId || (u.match(/\/post\/([A-Za-z0-9_-]+)/) || [])[1];
    return code ? `threads:${code}` : null;
  }
  if (p === 'instagram') {
    const code = c.shortcode || (u.match(/\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/) || [])[1];
    return code ? `instagram:${code}` : null;
  }
  if (p === 'linkedin') {
    const id = c.activityId || (String(c.urn || u).match(/urn:li:activity:(\d+)/) || [])[1];
    return id ? `linkedin:${id}` : null;
  }
  if (p === 'youtube') {
    const id = c.videoId || (u.match(/[?&]v=([\w-]{11})/) || [])[1] || (u.match(/youtu\.be\/([\w-]{11})/) || [])[1];
    return id ? `youtube:${id}` : null;
  }
  if (p === 'tiktok') {
    const id = c.videoId || (u.match(/\/video\/(\d+)/) || [])[1];
    return id ? `tiktok:${id}` : null;
  }
  if (p === 'facebook') {
    const id = (u.match(/\/posts\/([A-Za-z0-9]+)/) || [])[1] || (u.match(/[?&]story_fbid=([A-Za-z0-9]+)/) || [])[1] || (u.match(/\/videos\/(\d+)/) || [])[1];
    return id ? `facebook:${id}` : null;
  }
  return c.root ? `${p}:${typeof c.root === 'string' ? c.root : JSON.stringify(c.root)}` : null;
}
