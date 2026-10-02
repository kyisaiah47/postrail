// `postrail new-app --app console|simple|both` writes a Next.js dashboard wired to PostRail. It
// reads the same config and state files the agent writes, at request time, and shows the day's
// rolls and the posts and replies that went out.
//
//   console   one dense view: accounts, every slot today, every recent post, the account's settings
//   simple    one roomy view: what today holds, a card per account, details behind disclosures
//   both      both views, a welcome dialog that explains the page and offers the choice, and a
//             footer control to switch at any time
//
// The scaffold is plain JavaScript and JSX, with no CSS framework.

import fs from 'node:fs';
import path from 'node:path';

const T = new URL('./templates/', import.meta.url);
const read = (rel) => fs.readFileSync(new URL(rel, T), 'utf8');
const pkg = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

function pageFor(mode) {
  const head = `import { readBoard } from '@/lib/board';\nimport Footer from '@/components/Footer';\n`;
  if (mode === 'console') {
    return `${head}import Console from '@/components/Console';

export const dynamic = 'force-dynamic';

export default async function Page({ searchParams }) {
  const board = await readBoard();
  const q = (await searchParams) || {};
  return (
    <>
      <Console board={board} selected={q.account} />
      <Footer board={board} />
    </>
  );
}
`;
  }
  if (mode === 'simple') {
    return `${head}import SimpleHome from '@/components/SimpleHome';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const board = await readBoard();
  return (
    <>
      <SimpleHome board={board} />
      <Footer board={board} />
    </>
  );
}
`;
  }
  return `${head}import Console from '@/components/Console';
import SimpleHome from '@/components/SimpleHome';
import PageViews from '@/components/site-view/PageViews';

export const dynamic = 'force-dynamic';

export default async function Page({ searchParams }) {
  const board = await readBoard();
  const q = (await searchParams) || {};
  return (
    <>
      <PageViews consoleView={<Console board={board} selected={q.account} />} simpleView={<SimpleHome board={board} />} />
      <Footer board={board} />
    </>
  );
}
`;
}

function layoutFor(mode) {
  const css = ["import './globals.css';"];
  if (mode !== 'simple') css.push("import './console.css';");
  if (mode !== 'console') css.push("import './simple.css';");
  if (mode === 'both') css.push("import './views.css';");
  const meta = `export const metadata = {
  title: 'PostRail',
  description: 'The day\\'s posting plan and every post and reply PostRail sent.',
};
`;
  if (mode !== 'both') {
    return `${css.join('\n')}

${meta}
export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
`;
  }
  return `${css.join('\n')}
import SiteViewProvider from '@/components/site-view/SiteViewProvider';
import { readBoard } from '@/lib/board';

${meta}
export const dynamic = 'force-dynamic';

/** The welcome dialog's illustration: the latest post in the ledger, or a labelled example. */
async function welcomeExample() {
  try {
    const board = await readBoard();
    const r = board.recent.find((x) => x.kind === 'post');
    if (r) return { real: true, time: r.local, kind: r.slot || 'post', account: r.accountId, text: r.text };
  } catch { /* the page itself reports a config problem */ }
  return { real: false, time: '09:40', kind: 'pitch', account: 'example.bsky.social', text: 'A post written from your subject\\'s own facts appears here once the first slot posts.' };
}

export default async function RootLayout({ children }) {
  const example = await welcomeExample();
  return (
    <html lang="en">
      <body>
        <SiteViewProvider example={example}>{children}</SiteViewProvider>
      </body>
    </html>
  );
}
`;
}

/** Write the app. Returns the list of files written, relative to `dir`. */
export function scaffoldApp({ dir, mode = 'both', configPath = null, overwrite = false }) {
  if (!['console', 'simple', 'both'].includes(mode)) throw new Error('mode must be console, simple or both');
  if (fs.existsSync(dir) && fs.readdirSync(dir).length && !overwrite) throw new Error(`${dir} is not empty`);
  const configDefault = configPath ? path.relative(dir, configPath) || configPath : '../postrail.config.json';
  const files = {
    'package.json': read('shared/package.json').replace('__POSTRAIL_RANGE__', `^${pkg.version}`),
    'next.config.mjs': read('shared/next.config.mjs'),
    'jsconfig.json': read('shared/jsconfig.json'),
    'lib/board.js': read('shared/lib/board.js').replaceAll('__CONFIG_DEFAULT__', configDefault),
    'lib/status.js': read('shared/lib/status.js'),
    'app/globals.css': read('shared/app/globals.css'),
    'app/page.jsx': pageFor(mode),
    'app/layout.jsx': layoutFor(mode),
    'components/Footer.jsx': read('shared/components/Footer.jsx')
      .replace('__FOOTER_IMPORT__', mode === 'both' ? "import ViewControls from '@/components/site-view/ViewControls';\n" : '')
      .replace('__FOOTER_WHAT__', mode === 'both' ? 'the view controls' : 'a link to PostRail')
      .replace('__FOOTER_CONTROLS__', mode === 'both' ? '<ViewControls />' : ''),
    '.gitignore': 'node_modules/\n.next/\n',
  };
  if (mode !== 'simple') {
    files['components/Console.jsx'] = read('console/components/Console.jsx');
    files['app/console.css'] = read('console/app/console.css');
  }
  if (mode !== 'console') {
    files['components/SimpleHome.jsx'] = read('simple/components/SimpleHome.jsx');
    files['components/Disclosure.jsx'] = read('simple/components/Disclosure.jsx');
    files['app/simple.css'] = read('simple/app/simple.css');
  }
  if (mode === 'both') {
    for (const f of ['SiteViewProvider.jsx', 'PageViews.jsx', 'ViewControls.jsx', 'Welcome.jsx']) {
      files[`components/site-view/${f}`] = read(`both/components/site-view/${f}`);
    }
    files['app/views.css'] = read('both/app/views.css');
  }
  for (const [rel, body] of Object.entries(files)) {
    const out = path.join(dir, rel);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, body.replace(/\n{3,}/g, '\n\n'));
  }
  return Object.keys(files);
}
