import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scaffoldApp } from '../src/index.js';

const read = (dir, f) => fs.readFileSync(path.join(dir, f), 'utf8');

for (const mode of ['console', 'simple', 'both']) {
  test(`new-app --app ${mode} writes a complete Next.js app wired to PostRail`, () => {
    const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'postrail-app-')), mode);
    const files = scaffoldApp({ dir, mode, configPath: path.join(path.dirname(dir), 'postrail.config.json') });
    for (const f of files) {
      const body = read(dir, f);
      assert.ok(!/__[A-Z_]+__/.test(body), `${f} still holds a placeholder`);
    }
    const pkg = JSON.parse(read(dir, 'package.json'));
    assert.ok(pkg.dependencies.next && pkg.dependencies.postrail && pkg.dependencies.react);
    assert.match(read(dir, 'lib/board.js'), /from 'postrail\/read'/);
    assert.match(read(dir, 'lib/board.js'), /\.\.\/postrail\.config\.json/);
    assert.match(read(dir, 'next.config.mjs'), /serverExternalPackages: \['postrail'\]/);
    const has = (f) => files.includes(f);
    assert.equal(has('components/Console.jsx'), mode !== 'simple');
    assert.equal(has('components/SimpleHome.jsx'), mode !== 'console');
    assert.equal(has('components/site-view/Welcome.jsx'), mode === 'both');
    const pageSrc = read(dir, 'app/page.jsx');
    if (mode === 'both') assert.match(pageSrc, /PageViews consoleView=/);
    if (mode === 'both') assert.match(read(dir, 'components/Footer.jsx'), /<ViewControls \/>/);
    assert.throws(() => scaffoldApp({ dir, mode }), /not empty/);
  });
}
