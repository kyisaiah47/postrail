// Cards. A card is a still image that carries a headline, one or two sentences and the name and
// address of the thing the post is about. It is drawn as SVG with no dependency, then turned into
// a PNG by @resvg/resvg-js when it is installed (it is an optional dependency of PostRail), or by
// Playwright when that is installed instead.
//
// The layout is sentence-led on purpose: the headline is the largest type, every number sits
// inside a sentence at body size, and there are no small all-caps labels.

import fs from 'node:fs';
import path from 'node:path';

export const SIZES = {
  landscape: { w: 1200, h: 675 },
  og: { w: 1200, h: 630 },
  square: { w: 1080, h: 1080 },
  portrait: { w: 1080, h: 1350 },
  vertical: { w: 1080, h: 1920 },
  wide: { w: 1920, h: 1080 },
};

/** The card size each platform shows best in a feed. */
export const PLATFORM_CARD = {
  bluesky: 'landscape', x: 'landscape', threads: 'portrait', linkedin: 'landscape',
  instagram: 'portrait', tiktok: 'vertical', facebook: 'landscape', youtube: 'wide', other: 'landscape',
};

export const THEMES = {
  dark: { bg: '#101215', ink: '#f2f1ec', dim: '#a6abb2', accent: '#5b8def', panel: '#1a1d22' },
  light: { bg: '#fafaf6', ink: '#16181b', dim: '#565d66', accent: '#2a5bd7', panel: '#eceae3' },
};

const FONT = "Inter, 'Helvetica Neue', Helvetica, Arial, 'DejaVu Sans', sans-serif";

export function escapeXml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** Greedy word wrap on an estimated glyph width. Returns at most `maxLines` lines; the last one
 *  ends with an ellipsis when the text did not fit. */
export function wrap(text, { width, fontSize, maxLines, weight = 400 }) {
  const per = fontSize * (weight >= 600 ? 0.56 : 0.52);
  const maxChars = Math.max(4, Math.floor(width / per));
  const out = [];
  let line = '';
  const tokens = String(text || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  for (let i = 0; i < tokens.length; i += 1) {
    const w = tokens[i];
    const next = line ? `${line} ${w}` : w;
    if (next.length <= maxChars) { line = next; continue; }
    if (line) out.push(line);
    line = w.length > maxChars ? `${w.slice(0, maxChars - 1)}…` : w;
    if (out.length === maxLines) {
      const last = out[maxLines - 1];
      out[maxLines - 1] = `${last.slice(0, Math.max(0, maxChars - 1)).replace(/[ ,.;:]+$/, '')}…`;
      return { lines: out, fitted: false };
    }
  }
  if (line) out.push(line);
  if (out.length > maxLines) {
    const kept = out.slice(0, maxLines);
    kept[maxLines - 1] = `${kept[maxLines - 1].slice(0, Math.max(0, maxChars - 1)).replace(/[ ,.;:]+$/, '')}…`;
    return { lines: kept, fitted: false };
  }
  return { lines: out, fitted: true };
}

/** The largest headline size from `max` down to `min` that fits in `maxLines`. */
function fitTitle(text, width, { max, min, maxLines }) {
  for (let size = max; size >= min; size -= 2) {
    const r = wrap(text, { width, fontSize: size, maxLines, weight: 600 });
    if (r.fitted) return { size, lines: r.lines };
  }
  return { size: min, lines: wrap(text, { width, fontSize: min, maxLines, weight: 600 }).lines };
}

function textBlock(lines, { x, y, size, lineHeight, fill, weight = 400 }) {
  return lines.map((l, i) => `<text x="${x}" y="${Math.round(y + i * size * lineHeight)}" font-family="${escapeXml(FONT)}" font-size="${size}" font-weight="${weight}" fill="${fill}">${escapeXml(l)}</text>`).join('\n  ');
}

function imageHref(file) {
  const ext = path.extname(file).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : ext === '.gif' ? 'image/gif' : 'image/jpeg';
  return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
}

/**
 * Draw a card as an SVG string.
 *   title, body, name, url    the words; body may be empty
 *   size                      a key of SIZES or { w, h }
 *   theme                     a key of THEMES or { bg, ink, dim, accent, panel }
 *   image                     optional { file, box: { x, y, w, h } } placed above the text
 *   table                     optional [[label, value], ...] drawn at body size
 */
export function renderCardSvg({ title, body = '', name = '', url = '', size = 'landscape', theme = 'dark', image = null, table = null } = {}) {
  const { w, h } = typeof size === 'string' ? (SIZES[size] || SIZES.landscape) : size;
  const t = typeof theme === 'string' ? (THEMES[theme] || THEMES.dark) : { ...THEMES.dark, ...theme };
  const pad = Math.round(Math.min(w, h) * 0.08);
  const inner = w - pad * 2;
  const unit = Math.min(w, h) / 675;
  const parts = [];
  parts.push(`<rect width="${w}" height="${h}" fill="${t.bg}"/>`);
  let y = pad;
  if (image && image.file) {
    const box = image.box || { x: pad, y: pad, w: inner, h: Math.round(h * 0.5) };
    parts.push(`<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="${Math.round(12 * unit)}" fill="${t.panel}"/>`);
    parts.push(`<image x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" preserveAspectRatio="xMidYMid meet" href="${imageHref(image.file)}"/>`);
    y = box.y + box.h + Math.round(48 * unit);
  } else if (image && image.box) {
    parts.push(`<rect x="${image.box.x}" y="${image.box.y}" width="${image.box.w}" height="${image.box.h}" rx="${Math.round(12 * unit)}" fill="${t.panel}"/>`);
    y = image.box.y + image.box.h + Math.round(48 * unit);
  } else {
    parts.push(`<rect x="${pad}" y="${pad}" width="${Math.round(56 * unit)}" height="${Math.max(3, Math.round(5 * unit))}" fill="${t.accent}"/>`);
    y = pad + Math.round(72 * unit);
  }
  const footerSize = Math.round(24 * unit);
  const footerY = h - pad;
  const roomBottom = footerY - footerSize * 2;
  const title0 = fitTitle(title || name || '', inner, { max: Math.round(66 * unit), min: Math.round(38 * unit), maxLines: image ? 2 : 3 });
  const titleH = title0.size * (1 + 1.18 * (title0.lines.length - 1));
  const bodySize = Math.round(30 * unit);
  const gap = Math.round(36 * unit);
  const b = body
    ? wrap(body, { width: inner, fontSize: bodySize, maxLines: Math.min(6, Math.max(1, Math.floor((roomBottom - y - titleH - gap) / (bodySize * 1.4)))) })
    : { lines: [] };
  const bodyH = b.lines.length ? gap + bodySize * 1.4 * b.lines.length : 0;
  const tableH = Array.isArray(table) && table.length ? Math.round(24 * unit) + Math.min(table.length, 5) * Math.round(bodySize * 1.7) : 0;
  if (!image) y = Math.max(y, Math.round(y + (roomBottom - y - titleH - bodyH - tableH) / 2));
  parts.push(textBlock(title0.lines, { x: pad, y: y + title0.size, size: title0.size, lineHeight: 1.18, fill: t.ink, weight: 600 }));
  y += titleH;
  if (b.lines.length) {
    y += gap;
    parts.push(textBlock(b.lines, { x: pad, y: y + bodySize, size: bodySize, lineHeight: 1.4, fill: t.dim }));
    y += bodySize * 1.4 * b.lines.length;
  }
  y += Math.round(24 * unit);
  if (Array.isArray(table) && table.length) {
    const rowH = Math.round(bodySize * 1.7);
    for (const [label, value] of table.slice(0, 5)) {
      if (y + rowH > roomBottom) break;
      parts.push(`<line x1="${pad}" y1="${y}" x2="${w - pad}" y2="${y}" stroke="${t.dim}" stroke-opacity="0.35" stroke-width="1"/>`);
      parts.push(`<text x="${pad}" y="${y + bodySize * 1.2}" font-family="${escapeXml(FONT)}" font-size="${bodySize}" fill="${t.dim}">${escapeXml(label)}</text>`);
      parts.push(`<text x="${w - pad}" y="${y + bodySize * 1.2}" text-anchor="end" font-family="${escapeXml(FONT)}" font-size="${bodySize}" fill="${t.ink}">${escapeXml(value)}</text>`);
      y += rowH;
    }
  }
  if (name || url) {
    const label = [name, url.replace(/^https?:\/\//, '').replace(/\/$/, '')].filter(Boolean);
    parts.push(`<text x="${pad}" y="${footerY}" font-family="${escapeXml(FONT)}" font-size="${footerSize}" fill="${t.ink}" font-weight="600">${escapeXml(label[0] || '')}</text>`);
    if (label[1]) parts.push(`<text x="${w - pad}" y="${footerY}" text-anchor="end" font-family="${escapeXml(FONT)}" font-size="${footerSize}" fill="${t.dim}">${escapeXml(label[1])}</text>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">\n  ${parts.join('\n  ')}\n</svg>\n`;
}

/** Which PNG renderer is available, or null. */
export async function pngRenderer() {
  try { await import('@resvg/resvg-js'); return 'resvg'; } catch { /* not installed */ }
  try { await import('playwright'); return 'playwright'; } catch { /* not installed */ }
  return null;
}

/** Turn an SVG string into PNG bytes. */
export async function svgToPng(svg, { width } = {}) {
  try {
    const { Resvg } = await import('@resvg/resvg-js');
    const opts = { font: { loadSystemFonts: true, defaultFontFamily: 'Helvetica' } };
    if (width) opts.fitTo = { mode: 'width', value: width };
    return Buffer.from(new Resvg(svg, opts).render().asPng());
  } catch (e) {
    if (e && e.code !== 'ERR_MODULE_NOT_FOUND') throw e;
  }
  let pw;
  try { pw = await import('playwright'); } catch {
    throw new Error('PNG output needs @resvg/resvg-js or playwright. Install one of them, or keep the SVG.');
  }
  const m = /width="(\d+)" height="(\d+)"/.exec(svg);
  const w = m ? Number(m[1]) : 1200; const h = m ? Number(m[2]) : 675;
  const browser = await (pw.chromium || pw.default.chromium).launch({ args: ['--mute-audio'] });
  try {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    await page.setContent(`<!doctype html><html><body style="margin:0">${svg}</body></html>`);
    return await page.screenshot({ clip: { x: 0, y: 0, width: w, height: h } });
  } finally {
    await browser.close();
  }
}

/**
 * Draw a card and write it. Always writes `<out>.svg`; writes `<out>.png` when a renderer is
 * available or `png: 'required'` is passed (which throws without one). Returns the media item the
 * transports take: { path, kind: 'image', mime, alt, svg }.
 */
export async function writeCard(card, { out, png = 'auto' } = {}) {
  const svg = renderCardSvg(card);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const svgPath = `${out}.svg`;
  fs.writeFileSync(svgPath, svg);
  const alt = [card.title, card.body].filter(Boolean).join(' ').slice(0, 900);
  if (png === false) return { path: svgPath, kind: 'image', mime: 'image/svg+xml', alt, svg: svgPath };
  const renderer = await pngRenderer();
  if (!renderer && png !== 'required') return { path: svgPath, kind: 'image', mime: 'image/svg+xml', alt, svg: svgPath };
  const pngPath = `${out}.png`;
  fs.writeFileSync(pngPath, await svgToPng(svg));
  return { path: pngPath, kind: 'image', mime: 'image/png', alt, svg: svgPath };
}
