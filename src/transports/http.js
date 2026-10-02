// Shared plumbing for the API transports: one request helper that turns every non-success answer
// into the right error (a PlatformSignal for 401, 403, 429 and for bodies that name a ban, a
// captcha or an expired session; a TransportError for the rest), and small helpers for files and
// credentials.

import fs from 'node:fs';
import path from 'node:path';
import { errorForHttp, TransportError } from '../slots.js';

export async function call(fetchImpl, url, { method = 'GET', headers = {}, body, platform = '', raw = false } = {}) {
  let res;
  try {
    res = await fetchImpl(url, { method, headers, body });
  } catch (e) {
    throw new TransportError(`${platform || 'request'}: ${method} ${new URL(url).host} did not complete (${e.message})`, { retryable: true });
  }
  const text = raw ? '' : await res.text();
  const err = errorForHttp(res.status, text, platform);
  if (err) throw err;
  let json = null;
  if (text) { try { json = JSON.parse(text); } catch { json = null; } }
  return { status: res.status, headers: res.headers, json, text, res };
}

export function need(env, name, what) {
  if (!name) throw new Error(`${what}: the transport config does not name the environment variable that holds it`);
  const v = env[name];
  if (!v) throw new Error(`${what}: the environment variable ${name} is not set`);
  return v;
}

export const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.m4v': 'video/mp4', '.svg': 'image/svg+xml',
};

export function mimeOf(media) {
  return media.mime || MIME[path.extname(media.path || '').toLowerCase()] || 'application/octet-stream';
}

export function bytesOf(media) {
  return fs.readFileSync(media.path);
}

/** PNG width and height from the IHDR chunk, or null for anything that is not a PNG. */
export function pngSize(buf) {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  return null;
}

/**
 * Some platforms (Threads, Instagram) fetch media from a public URL instead of taking bytes. A
 * media item may carry its own `url`. Otherwise the transport copies the file into `mediaDir`,
 * a folder you publish at `mediaBaseUrl` (a bucket, a static site), or calls `hostMedia(media)`
 * when PostRail is used as a library.
 */
export async function publicUrl(media, { mediaDir, mediaBaseUrl, hostMedia } = {}) {
  if (media.url) return media.url;
  if (typeof hostMedia === 'function') return hostMedia(media);
  if (mediaDir && mediaBaseUrl) {
    const name = `${Date.now()}-${path.basename(media.path)}`;
    fs.mkdirSync(mediaDir, { recursive: true });
    fs.copyFileSync(media.path, path.join(mediaDir, name));
    return `${String(mediaBaseUrl).replace(/\/+$/, '')}/${encodeURIComponent(name)}`;
  }
  throw new Error('this platform fetches media from a public URL. Set transport.mediaDir and transport.mediaBaseUrl, or pass hostMedia.');
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
