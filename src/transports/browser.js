// The browser transport, for a platform with no official posting API.
//
// It drives a normal Chromium through Playwright with a profile you signed into yourself
// (`postrail login <account>` opens it in a visible window for that). It does nothing to hide
// that it is automated: no plugin that disguises the browser, no change to what the page can read
// about it, and nothing that answers a challenge. When the page shows a captcha, a ban notice or a
// sign-in wall, that is a platform signal. The slot stops and the account halts until a person
// looks at it.
//
// launchSafe() is the only way this file opens a browser. It runs muted, and it installs a
// capturing click guard that cancels any click on a link that is not http or https (mailto:, tel:
// and other app schemes), so a stray click can never open a mail client or a phone app on the
// machine running PostRail. Cancelled links are recorded on window.__blockedExternalHrefs.
//
//   transport: {
//     kind: 'browser',
//     userDataDir: './profiles/my-account',
//     headless: true,
//     recipe: {
//       composeUrl: 'https://example.social/compose',
//       textbox: 'textarea[name=status]',
//       fileInput: 'input[type=file]',        optional
//       submit: 'button[type=submit]',
//       identity: '.current-account',         optional; its text must equal the handle
//       signedOut: 'form[action*=login]',     optional; present means signed out
//       loginUrl: '/login',                   optional; a URL containing it means signed out
//       profileUrl: 'https://example.social/@me',   optional; the post is looked for here after
//       permalink: 'article a.permalink',     optional; read on the profile page for the post URL
//       settleMs: 3000
//     }
//   }
//
// With `dryRun`, it opens the composer, types the text, attaches the media, and stops before the
// click. That proves the composer would take the post without publishing anything.

import { PlatformSignal, TransportError, signalInText } from '../slots.js';
import { normHandle } from '../registry.js';

const CHALLENGE_FRAME = /captcha|challenge|arkose|turnstile/i;

const CLICK_GUARD = `(() => {
  window.__blockedExternalHrefs = window.__blockedExternalHrefs || [];
  document.addEventListener('click', (e) => {
    const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    const href = a.getAttribute('href') || '';
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) && !/^https?:/i.test(href)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      window.__blockedExternalHrefs.push(href);
    }
  }, true);
})();`;

async function loadPlaywright(given) {
  if (given) return given.chromium ? given : given.default;
  try {
    const pw = await import('playwright');
    return pw.chromium ? pw : pw.default;
  } catch {
    throw new Error('the browser transport needs Playwright. Run `npm i playwright` and `npx playwright install chromium`.');
  }
}

/** Open a persistent Chromium context, muted, with the click guard on every page. */
export async function launchSafe(pw, userDataDir, { headless = true } = {}) {
  const context = await pw.chromium.launchPersistentContext(userDataDir, {
    headless,
    viewport: { width: 1440, height: 900 },
    args: ['--mute-audio'],
  });
  await context.addInitScript(CLICK_GUARD);
  return context;
}

/** Read the page for anything the platform is saying about the account. Throws a PlatformSignal. */
export async function checkPage(page, recipe = {}) {
  const url = page.url();
  if (page.frames().some((f) => CHALLENGE_FRAME.test(f.url()))) throw new PlatformSignal('captcha', `a challenge frame is on ${url}`);
  const text = await page.evaluate(() => (document.body ? document.body.innerText.slice(0, 20000) : ''));
  const signal = signalInText(text);
  if (signal === 'captcha' || signal === 'ban' || signal === 'signed-out' || signal === 'rate-limit') {
    throw new PlatformSignal(signal, `seen on ${url}`);
  }
  if (recipe.loginUrl && url.includes(recipe.loginUrl)) throw new PlatformSignal('signed-out', `the page went to ${url}`);
  if (recipe.signedOut && await page.$(recipe.signedOut)) throw new PlatformSignal('signed-out', `the sign-in marker is on ${url}`);
  return text;
}

export function createBrowserTransport(account, { playwright = null, dryRun = false } = {}) {
  const t = account.transport;
  const recipe = t.recipe || {};
  for (const k of ['composeUrl', 'textbox', 'submit']) {
    if (!recipe[k]) throw new Error(`browser transport for ${account.id}: recipe.${k} is required`);
  }
  if (!t.userDataDir) throw new Error(`browser transport for ${account.id}: userDataDir is required`);

  async function withPage(fn, { headless = t.headless !== false } = {}) {
    const pw = await loadPlaywright(playwright);
    const context = await launchSafe(pw, t.userDataDir, { headless });
    try {
      const page = context.pages()[0] || await context.newPage();
      return await fn(page);
    } finally {
      await context.close();
    }
  }

  async function identity(page) {
    if (!recipe.identity) return { handle: account.handle };
    const el = await page.$(recipe.identity);
    if (!el) throw new PlatformSignal('signed-out', `no account name at ${recipe.identity}`);
    const shown = normHandle(await el.innerText());
    if (shown !== normHandle(account.handle)) throw new PlatformSignal('identity-mismatch', `the page is signed in as @${shown}, the registry names @${normHandle(account.handle)}`);
    return { handle: shown };
  }

  return {
    kind: 'browser',
    platform: account.platform,
    handle: account.handle,
    async whoami() {
      return withPage(async (page) => {
        await page.goto(recipe.composeUrl, { waitUntil: 'domcontentloaded' });
        await checkPage(page, recipe);
        return identity(page);
      });
    },
    /** Open the composer in a visible window so a person can sign in once. */
    async login({ waitMs = 5 * 60 * 1000 } = {}) {
      return withPage(async (page) => {
        await page.goto(recipe.composeUrl, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector(recipe.textbox, { timeout: waitMs });
        return identity(page);
      }, { headless: false });
    },
    async post({ text, media = [] } = {}) {
      return withPage(async (page) => {
        await page.goto(recipe.composeUrl, { waitUntil: 'domcontentloaded' });
        await checkPage(page, recipe);
        await identity(page);
        const box = await page.waitForSelector(recipe.textbox, { timeout: 20000 }).catch(() => null);
        if (!box) {
          await checkPage(page, recipe);
          throw new TransportError(`the composer box ${recipe.textbox} did not appear on ${page.url()}`, { retryable: true });
        }
        await box.focus();
        await page.keyboard.type(String(text), { delay: 15 });
        if (media.length) {
          if (!recipe.fileInput) throw new TransportError('this recipe has no fileInput, so it cannot attach media');
          await page.setInputFiles(recipe.fileInput, media.map((m) => m.path));
        }
        if (dryRun) return { id: null, url: null, verified: false, dry: true, filled: true };
        await page.click(recipe.submit);
        await page.waitForTimeout(recipe.settleMs ?? 3000);
        await checkPage(page, recipe);
        if (!recipe.profileUrl) return { id: null, url: null, verified: false };
        await page.goto(recipe.profileUrl, { waitUntil: 'domcontentloaded' });
        const pageText = await checkPage(page, recipe);
        const needle = String(text).replace(/\s+/g, ' ').trim().slice(0, 60);
        const verified = pageText.replace(/\s+/g, ' ').includes(needle);
        let url = null;
        if (recipe.permalink) {
          const a = await page.$(recipe.permalink);
          if (a) url = await a.evaluate((el) => el.href || null);
        }
        return { id: url, url, verified };
      });
    },
  };
}
