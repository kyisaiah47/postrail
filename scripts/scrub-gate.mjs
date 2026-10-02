#!/usr/bin/env node
// THE SCRUB GATE. It fails closed on anything in this repository that must never be public.
//
//   node scripts/scrub-gate.mjs                     scan every tracked and new file, exit 1 on a finding
//   node scripts/scrub-gate.mjs --hash <kind> <v>   print the hash for a private identifier you want blocked
//
// It refuses five families:
//
//   1. private identifiers   the maintainers' personal email addresses, account handles, platform
//                            account ids, DIDs, home directory paths and internal tool names
//   2. key shapes            API keys, tokens, private keys, app passwords, Stripe account ids
//   3. the stealth plugin    and every other library that disguises an automated browser
//   4. captcha services      any service or code that answers a captcha for a bot
//   5. webdriver overrides   any change to navigator.webdriver or to Chrome's automation flags
//
// WHY FAMILY 1 IS HASHED. A list of handles in a public file says which accounts belong together,
// which is the thing a scrub exists to prevent. So the file holds only salted SHA-256 hashes. The
// gate cuts each file into tokens (handles, hosts, path segments, email addresses, word pairs),
// hashes every candidate, and compares. A URL host is not a handle mention, so the full host of a
// link is not compared, but each label of it is.
//
// THE OWNER HANDLE IS A MENTION RULE, NOT A TOKEN RULE (2026-10-02). The GitHub account that owns
// this repository is also a personal handle, and the npm page and the README have to link the
// repository. So that one handle sits in the `mention` set: it is refused written as @handle, and
// a GitHub URL under it passes only when it is exactly this repository (REPO_URLS). A link to any
// other repository under that owner is refused, because it would name a repository that may be
// private. Every other handle stays in the `token` set and is refused in any position.
//
// Families 2 to 5 are public knowledge and are written as plain patterns, built from fragments so
// the gate never matches its own source.
//
// There is no allowlist, no force flag and no skip file. A finding is fixed in the file that holds
// it. The gate scans itself.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SALT = 'postrail-scrub-v1';
export const hash = (kind, value) => crypto.createHash('sha256').update(`${SALT}:${kind}:${String(value).toLowerCase()}`).digest('hex').slice(0, 32);

/** The private identifiers, hashed. Add one with `--hash <kind> <value>`. */
export const HASHED = {
  token: new Set([
    '393dbf5acac8abc4ce530d6506150fac',
    'd7c492e401c649264c2d5e6792eb7caa',
    '3c65e8f3d9c75d98d60ed47930a0f9ba',
    'c084bc9f358e21add0d21ca016a4bf51',
    '0d191f667d7a9964bb3563184d380e63',
    'd6360f2bd092dad43cb6f555758e6d56',
    '1b36aa218d579a61364b12e456c043be',
    '1a65911aa0b0570599be3bfe9126a61f',
    'f97d1a6d48ff90577869e3fafa8ff724',
    'ec41841c1089d1221c3f21b968e0495e',
    'bb03f69cdf0e5c15fdcb3099721163d1',
    '067972802fdbc579ef7426a59ba71b60',
    '5057c9de16235180208341af3ce2d87d',
    'b16e7d94adcbf8169afed779235684a5',
    '34bf501fbc2114fc7898e6043e21c631',
    'bed10bf9a2474ff7e850f6076b175ea3',
    '3125b63aca11c8c464519163e89b03ea',
    'fd8e357a2300ac786f3e376be7bbeab9',
    '2e59a4b4d61d476a7f4832974772c82f',
    '01e0630aa00610bf0589527952ec53dc',
    'f55b6e9db25a816c36482b94bd8b51c1',
    '1535a4f426f951a7462d5b2986ef8056',
    '7955e3e27dab1ecbfb2678586bd5e89d',
    'd2960a60813b72d0ce34be64a30b09c2',
    '62cb53f989947e247dd5e39cf1bf506d',
    '9b7ab7543aa6bedcd973569c5285cebd',
    'c5625bb33680bfdd06c1ed243dafeff5',
    'fbfe2e8fbe767d1a3a9033e992ab8ff4',
    '18d13b57e7f8511fd1dc5f484ea68fcc',
    '0eb6c89cf9cefdd7e27c2a87a4377b88',
    '01048c0490dea0ee98a66b776d801927',
    '918b2639a8aac9b245807fd869e2adf2',
    '188d93b4b04d80748df107ba77b12723',
  ]),
  email: new Set([
    '9ca8773c414060b163cde7ec179ae49e',
    '3fa7567aea5ed6f0d3c7ea743d0dfb64',
    '2d35dcd07d18a294ba66232c72ef5c10',
    '4725abfc3693cfe6facd620fa3ff72aa',
    'cd2ba47aa147d458e834ed5e24383f9d',
    'bc813792a70fd8d8bb93643162829987',
    '5827ac02a30303ce61bc9488b0139783',
    'b613b5a3b88ee37e29eab5f5ed12b2ae',
  ]),
  phrase: new Set([
    'b41855d3df6d78a669e8c8ce4e06563d',
  ]),
  mention: new Set([
    '4b78f88bc5a5a409796bc1ce22cb7c4d',
  ]),
  path: new Set([
    'bfac99e7b46394ef30ab6016bdc33571',
  ]),
};

const j = (...parts) => parts.join('');

/** Family 2: key shapes. */
export const KEY_SHAPES = [
  ['an AWS access key id', new RegExp(j('\\b(AK', 'IA|AS', 'IA)[0-9A-Z]{16}\\b'))],
  ['a GitHub token', new RegExp(j('\\bgh', '[pousr]_[A-Za-z0-9]{36,}\\b'))],
  ['a GitHub fine-grained token', new RegExp(j('\\bgithub', '_pat_[A-Za-z0-9_]{40,}'))],
  ['an Anthropic key', new RegExp(j('\\bsk-', 'ant-[A-Za-z0-9_-]{20,}'))],
  ['an OpenAI key', new RegExp(j('\\bsk-', '(proj-|svcacct-|admin-)?[A-Za-z0-9_-]{32,}'))],
  ['a Google API key', new RegExp(j('\\bAI', 'za[0-9A-Za-z_-]{35}\\b'))],
  ['a Google OAuth client secret', new RegExp(j('\\bGOC', 'SPX-[A-Za-z0-9_-]{20,}'))],
  ['a Google refresh token', new RegExp(j('\\b1\\/\\/', '0[A-Za-z0-9_-]{30,}'))],
  ['a Slack token', new RegExp(j('\\bxo', 'x[abpors]-[A-Za-z0-9-]{10,}'))],
  ['a Stripe key', new RegExp(j('\\b(sk|rk|pk)', '_(live|test)_[A-Za-z0-9]{16,}'))],
  ['a Stripe webhook secret', new RegExp(j('\\bwh', 'sec_[A-Za-z0-9]{24,}'))],
  ['a Stripe account id', new RegExp(j('\\bac', 'ct_[A-Za-z0-9]{16}\\b'))],
  ['a Stripe account id prefix', new RegExp(j('ac', 'ct_1', 'T'))],
  ['an npm token', new RegExp(j('\\bnp', 'm_[A-Za-z0-9]{36}\\b'))],
  ['a Supabase token', new RegExp(j('\\bsb', 'p_[a-f0-9]{40}\\b|\\bsb', '_secret_[A-Za-z0-9_-]{20,}'))],
  ['a JSON web token', new RegExp(j('\\bey', 'J[A-Za-z0-9_-]{10,}\\.ey', 'J[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}'))],
  ['a private key block', new RegExp(j('-----BEGIN [A-Z ]*', 'PRIVATE KEY-----'))],
  ['a Meta access token', new RegExp(j('\\b(EA', 'A|IG', 'QV|IG', 'AA|TH', 'AA)[A-Za-z0-9_-]{60,}'))],
  ['a LinkedIn access token', new RegExp(j('\\bAQ', '[A-Za-z0-9_-]{120,}'))],
  ['a Telegram bot token', new RegExp(j('\\b\\d{8,10}:A', 'A[A-Za-z0-9_-]{33}\\b'))],
  ['a Bluesky app password', new RegExp(j('\\b[a-z2-7]{4}-[a-z2-7]{4}', '-[a-z2-7]{4}-[a-z2-7]{4}\\b'))],
  ['a secret assigned in code', new RegExp(j('\\b(api[_-]?key|secret|token|pass', 'word|passwd|app[_-]?password)\\b["\']?\\s*[:=]\\s*["\'](?!\\$\\{|<|your|example|placeholder|xxx)[^"\'\\s]{24,}["\']'), 'i')],
];

/** Family 3: libraries that disguise an automated browser. */
export const STEALTH = [
  ['the stealth plugin', new RegExp(j('puppeteer', '-extra-plugin-', 'stealth'), 'i')],
  ['the puppeteer extra framework', new RegExp(j('puppeteer', '-extra'), 'i')],
  ['the playwright extra framework', new RegExp(j('playwright', '-extra'), 'i')],
  ['the stealth plugin class', new RegExp(j('Stealth', 'Plugin'))],
  ['undetected chromedriver', new RegExp(j('undetected', '[-_]chrome', 'driver'), 'i')],
  ['rebrowser patches', new RegExp(j('rebrowser', '-patches'), 'i')],
  ['a fingerprint spoofing library', new RegExp(j('fingerprint', '-(injector|generator|suite)'), 'i')],
  ['humanised cursor movement', new RegExp(j('ghost', '-cursor'), 'i')],
  ['an anti-detect browser', new RegExp(j('camou', 'fox|multi', 'login|go', 'login|ads', 'power'), 'i')],
];

/** Family 4: captcha answering. */
export const CAPTCHA = [
  ['a captcha answering service', new RegExp(j('\\b2', 'captcha\\b|anti-?', 'captcha|cap', 'solver|cap', 'monster|death', 'by', 'captcha|nope', 'cha|captcha', 'ai\\b'), 'i')],
  ['captcha answering code', new RegExp(j('captcha', '.?solv|solve', '.?(re|h)?captcha|captcha', '.?bypass|bypass', '.?(re|h)?captcha'), 'i')],
];

/** Family 5: webdriver and automation flag overrides. */
export const WEBDRIVER = [
  ['a navigator.webdriver override', new RegExp(j('defineProperty\\(\\s*(navigator|Navigator\\.prototype)\\s*,\\s*[\'"]web', 'driver'))],
  ['a navigator.webdriver assignment', new RegExp(j('navigator\\.web', 'driver\\s*=[^=]'))],
  ['a navigator.webdriver deletion', new RegExp(j('delete\\s+[\\w.]*web', 'driver'))],
  ['the automation controlled blink flag', new RegExp(j('Automation', 'Controlled'))],
  ['the enable-automation switch removal', new RegExp(j('exclude', 'Switches[^\\n]{0,40}enable-', 'automation'))],
  ['the automation extension switch', new RegExp(j('useAutomation', 'Extension'))],
];

export const PATTERN_FAMILIES = [['key shape', KEY_SHAPES], ['browser disguise', STEALTH], ['captcha', CAPTCHA], ['webdriver override', WEBDRIVER]];

const TOKEN = /[@a-z0-9_][a-z0-9_.-]*[a-z0-9_]|[a-z0-9_]/g;
const EMAIL = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*/g;
const HOME = /\/(?:users|home)\/([a-z0-9._-]+)/g;

/** The candidates one token yields: each label, each leading run of labels, each part of a
 *  hyphen or underscore name, and the whole token unless it is a URL host or an email domain. */
export function tokenCandidates(token, { host = false } = {}) {
  const t = token.replace(/^@+/, '');
  const labels = t.split('.').filter(Boolean);
  const out = new Set();
  for (let i = 1; i <= labels.length; i += 1) {
    const prefix = labels.slice(0, i).join('.');
    if (i < labels.length || !host) out.add(prefix);
  }
  for (const l of labels) {
    out.add(l);
    for (const part of [...l.split('-'), ...l.split('_')]) if (part) out.add(part);
  }
  return out;
}

/** The repositories a GitHub URL under a `mention` owner may name: this one, and nothing else. */
export const REPO_URLS = ['postrail'];

const GITHUB_REPO = /github\.com\/([a-z0-9-]+)\/([a-z0-9._-]+)/g;

/** Every private identifier in one text: [{ line, kind, text }]. */
export function hashedFindings(text, hashed = HASHED, { repos = REPO_URLS } = {}) {
  const lower = String(text).toLowerCase();
  const found = [];
  const mentions = hashed.mention || new Set();
  const lineAt = (i) => lower.slice(0, i).split('\n').length;
  for (const m of lower.matchAll(TOKEN)) {
    const i = m.index;
    const emailDomain = m[0][0] === '@' && /[a-z0-9._%+-]/.test(lower[i - 1] || '');
    const host = lower.slice(Math.max(0, i - 3), i) === '://' || emailDomain;
    if (m[0][0] === '@' && !emailDomain) {
      const handle = m[0].slice(1).split('.')[0];
      if (mentions.has(hash('mention', handle))) { found.push({ line: lineAt(i), kind: 'a private handle written as a mention', text: `@${handle}` }); continue; }
    }
    for (const c of tokenCandidates(m[0], { host })) {
      if (hashed.token.has(hash('token', c))) { found.push({ line: lineAt(i), kind: 'a private identifier', text: c }); break; }
    }
  }
  for (const m of lower.matchAll(GITHUB_REPO)) {
    const repo = m[2].replace(/\.git$/, '').replace(/[.]+$/, '');
    if (mentions.has(hash('mention', m[1])) && !repos.includes(repo)) {
      found.push({ line: lineAt(m.index), kind: 'a link to another repository under a private handle', text: `github.com/.../${repo}` });
    }
  }
  for (const m of lower.matchAll(EMAIL)) {
    const [local, domain] = m[0].split('@');
    const first = domain.split('.')[0];
    let hit = null;
    for (let k = 0; k < local.length && !hit; k += 1) {
      const l = local.slice(k);
      for (const c of [`${l}@`, `${l}@${first}`, `${l}@${domain}`]) if (hashed.email.has(hash('email', c))) { hit = c; break; }
    }
    if (hit) found.push({ line: lineAt(m.index), kind: 'a private email address', text: hit });
  }
  const words = [...lower.matchAll(/[a-z]+/g)];
  for (let k = 0; k + 1 < words.length; k += 1) {
    const pair = `${words[k][0]} ${words[k + 1][0]}`;
    if (hashed.phrase.has(hash('phrase', pair))) found.push({ line: lineAt(words[k].index), kind: 'a private name', text: pair });
  }
  for (const m of lower.matchAll(HOME)) {
    const c = `/users/${m[1]}`;
    if (hashed.path.has(hash('path', c)) || hashed.path.has(hash('path', `/home/${m[1]}`))) found.push({ line: lineAt(m.index), kind: 'a private home path', text: m[0] });
  }
  return found;
}

/** Every pattern finding in one text: [{ line, kind, text }]. */
export function patternFindings(text, families = PATTERN_FAMILIES) {
  const found = [];
  const lines = String(text).split('\n');
  lines.forEach((l, i) => {
    for (const [family, list] of families) {
      for (const [name, re] of list) {
        const m = re.exec(l);
        if (m) found.push({ line: i + 1, kind: `${family}: ${name}`, text: m[0].slice(0, 60) });
      }
    }
  });
  return found;
}

export function scanText(text, opts = {}) {
  return [...hashedFindings(text, opts.hashed || HASHED), ...patternFindings(text, opts.families || PATTERN_FAMILIES)];
}

function listFiles(root) {
  try {
    const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out.split('\0').filter(Boolean).filter((f) => fs.existsSync(path.join(root, f)));
  } catch {
    const acc = [];
    const walk = (d) => {
      for (const e of fs.readdirSync(path.join(root, d), { withFileTypes: true })) {
        if (e.name === '.git' || e.name === 'node_modules') continue;
        const rel = path.join(d, e.name);
        if (e.isDirectory()) walk(rel); else acc.push(rel);
      }
    };
    walk('.');
    return acc;
  }
}

/** Scan a tree. Returns { files, findings: [{ file, line, kind, text }] }. */
export function scanTree(root) {
  const files = listFiles(root);
  const findings = [];
  for (const f of files) {
    const buf = fs.readFileSync(path.join(root, f));
    if (buf.subarray(0, 8000).includes(0)) continue;
    for (const x of scanText(buf.toString('utf8'))) findings.push({ file: f, ...x });
  }
  return { files: files.length, findings };
}

function main(argv) {
  if (argv[0] === '--hash') {
    const [, kind, ...rest] = argv;
    if (!['token', 'mention', 'email', 'phrase', 'path'].includes(kind) || !rest.length) {
      process.stderr.write('usage: scrub-gate.mjs --hash token|mention|email|phrase|path <value>\n');
      return 2;
    }
    process.stdout.write(`${hash(kind, rest.join(' '))}\n`);
    return 0;
  }
  const root = path.resolve(argv[0] || path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
  const { files, findings } = scanTree(root);
  for (const f of findings) process.stdout.write(`${f.file}:${f.line}  ${f.kind}  "${f.text}"\n`);
  process.stdout.write(findings.length
    ? `scrub gate: ${findings.length} finding(s) in ${files} file(s). Remove them; there is no override.\n`
    : `scrub gate: clean, ${files} file(s) scanned.\n`);
  return findings.length ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
