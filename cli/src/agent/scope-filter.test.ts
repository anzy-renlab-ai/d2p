/**
 * Tests for agent/scope-filter (Phase 17).
 *
 * Covers shouldScanDir, shouldScanFile, looksLikeLibraryFile against the
 * docs/details Phase-17 spec. No filesystem fixtures needed — these are
 * pure functions.
 */
import { describe, it, expect } from 'vitest';
import {
  ALWAYS_SKIP_DIRS,
  THIRD_PARTY_DIRS,
  SKIP_FILE_PATTERNS,
  shouldScanDir,
  shouldScanFile,
  looksLikeLibraryFile,
} from './scope-filter.js';

describe('shouldScanDir', () => {
  it('rejects node_modules in app scope', () => {
    expect(shouldScanDir('node_modules', 'app')).toBe(false);
  });
  it('rejects node_modules in all scope (ALWAYS_SKIP is unconditional)', () => {
    expect(shouldScanDir('node_modules', 'all')).toBe(false);
  });
  it('allows src in app scope', () => {
    expect(shouldScanDir('src', 'app')).toBe(true);
  });
  it('rejects vendor in app scope', () => {
    expect(shouldScanDir('vendor', 'app')).toBe(false);
  });
  it('allows vendor in all scope', () => {
    expect(shouldScanDir('vendor', 'all')).toBe(true);
  });
  it('rejects .git in any scope', () => {
    expect(shouldScanDir('.git', 'app')).toBe(false);
    expect(shouldScanDir('.git', 'all')).toBe(false);
  });
  it('rejects dist / build / coverage in app scope', () => {
    expect(shouldScanDir('dist', 'app')).toBe(false);
    expect(shouldScanDir('build', 'app')).toBe(false);
    expect(shouldScanDir('coverage', 'app')).toBe(false);
  });
  it('rejects third_party / vendored / externals in app, allows in all', () => {
    for (const d of ['third_party', 'vendored', 'externals']) {
      expect(shouldScanDir(d, 'app')).toBe(false);
      expect(shouldScanDir(d, 'all')).toBe(true);
    }
  });
});

describe('shouldScanFile', () => {
  const cwd = '/project';
  it('rejects .min.js in app scope', () => {
    const r = shouldScanFile({ scope: 'app', cwd, relPath: 'foo.min.js' });
    expect(r.scan).toBe(false);
    expect(r.reason).toBe('minified');
  });
  it('rejects .d.ts in app scope', () => {
    const r = shouldScanFile({ scope: 'app', cwd, relPath: 'types.d.ts' });
    expect(r.scan).toBe(false);
    expect(r.reason).toBe('d-ts');
  });
  it('rejects .bundle.js in app scope', () => {
    expect(
      shouldScanFile({ scope: 'app', cwd, relPath: 'dist-out/foo.bundle.js' }).scan,
    ).toBe(false);
  });
  it('rejects .generated.ts in app scope', () => {
    expect(
      shouldScanFile({ scope: 'app', cwd, relPath: 'src/codegen.generated.ts' }).scan,
    ).toBe(false);
  });
  it('rejects .map files', () => {
    expect(shouldScanFile({ scope: 'app', cwd, relPath: 'src/app.js.map' }).scan).toBe(
      false,
    );
  });
  it('accepts src/api/login.ts in app scope', () => {
    const r = shouldScanFile({ scope: 'app', cwd, relPath: 'src/api/login.ts' });
    expect(r.scan).toBe(true);
    expect(r.reason).toBeUndefined();
  });
  it('accepts src/api/login.ts in all scope', () => {
    expect(
      shouldScanFile({ scope: 'all', cwd, relPath: 'src/api/login.ts' }).scan,
    ).toBe(true);
  });
  it('rejects anything in node_modules in any scope', () => {
    expect(
      shouldScanFile({ scope: 'all', cwd, relPath: 'node_modules/foo/index.js' }).scan,
    ).toBe(false);
    expect(
      shouldScanFile({ scope: 'app', cwd, relPath: 'node_modules/foo/index.js' }).scan,
    ).toBe(false);
  });
  it('rejects files under vendor/ in app scope', () => {
    const r = shouldScanFile({ scope: 'app', cwd, relPath: 'vendor/legacy.js' });
    expect(r.scan).toBe(false);
    expect(r.reason).toBe('third-party-dir');
  });
  it('allows files under vendor/ in all scope', () => {
    expect(shouldScanFile({ scope: 'all', cwd, relPath: 'vendor/legacy.js' }).scan).toBe(
      true,
    );
  });
  it('rejects files under public/ in app scope', () => {
    expect(
      shouldScanFile({ scope: 'app', cwd, relPath: 'public/assets/main.js' }).scan,
    ).toBe(false);
  });
  it('rejects prisma/migrations in app scope', () => {
    expect(
      shouldScanFile({
        scope: 'app',
        cwd,
        relPath: 'prisma/migrations/20240101_init/migration.sql',
      }).scan,
    ).toBe(false);
  });
  it('rejects vendored standalone file (vendor-foo.js)', () => {
    expect(
      shouldScanFile({ scope: 'app', cwd, relPath: 'src/vendor-tinycolor.js' }).scan,
    ).toBe(false);
  });
  it('handles Windows-style separators by normalising to POSIX', () => {
    expect(
      shouldScanFile({ scope: 'app', cwd, relPath: 'src\\api\\login.ts' }).scan,
    ).toBe(true);
    expect(
      shouldScanFile({ scope: 'app', cwd, relPath: 'node_modules\\foo\\x.js' }).scan,
    ).toBe(false);
  });
});

describe('looksLikeLibraryFile', () => {
  it('flags files with multiple use-strict declarations as library', () => {
    const content =
      `'use strict';\n` +
      `'use strict';\n` +
      `'use strict';\n` +
      `function foo() { return 1; }\n` +
      `// padding to exceed length threshold\n`.repeat(20);
    expect(looksLikeLibraryFile(content, 'src/something.js')).toBe(true);
  });

  it('flags heavy license-header files with no handler signal as library', () => {
    const header =
      `/*!\n` +
      ` * Copyright (c) 2020 Example Corp.\n` +
      ` * Licensed under the MIT License.\n` +
      ` * SPDX-License-Identifier: MIT\n` +
      Array.from({ length: 18 })
        .map((_, i) => ` * line ${i} of license text describing terms and conditions\n`)
        .join('') +
      ` */\n`;
    const body = `export function add(a, b) { return a + b; }\n`.repeat(5);
    expect(looksLikeLibraryFile(header + body, 'src/math/add.js')).toBe(true);
  });

  it('does NOT flag a handler file even with a copyright header', () => {
    const header =
      `/*!\n` +
      ` * Copyright (c) 2024 App Inc.\n` +
      ` * Licensed under MIT.\n` +
      Array.from({ length: 18 })
        .map((_, i) => ` * line ${i} of license text\n`)
        .join('') +
      ` */\n`;
    const body =
      `import express from 'express';\n` +
      `const app = express();\n` +
      `app.post('/login', (req, res) => { res.json({ ok: true }); });\n` +
      `export default app;\n`;
    expect(looksLikeLibraryFile(header + body, 'src/api/login.ts')).toBe(false);
  });

  it('does NOT flag a normal application handler file as library', () => {
    const content =
      `import express from 'express';\n` +
      `const app = express();\n` +
      `app.post('/login', async (req, res, next) => {\n` +
      `  const user = await db.find(req.body.email);\n` +
      `  res.json(user);\n` +
      `});\n` +
      `export default app;\n` +
      `// extra padding\n`.repeat(20);
    expect(looksLikeLibraryFile(content, 'src/api/login.ts')).toBe(false);
  });

  it('flags barrel re-export file as library', () => {
    const content =
      `'use strict';\n` +
      `module.exports = require('./inner-a');\n` +
      `exports.b = require('./inner-b');\n` +
      `exports.c = require('./inner-c');\n` +
      `exports.d = require('./inner-d');\n` +
      `exports.e = require('./inner-e');\n` +
      Array.from({ length: 30 })
        .map((_, i) => `exports.k${i} = require('./inner-k${i}');\n`)
        .join('');
    expect(looksLikeLibraryFile(content, 'lib/index.js')).toBe(true);
  });

  it('flags files under lib/utils/ with no domain signals as library', () => {
    const content =
      `export function chunk(arr, size) {\n` +
      `  const out = [];\n` +
      `  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));\n` +
      `  return out;\n` +
      `}\n` +
      `export function uniq(arr) { return [...new Set(arr)]; }\n` +
      `// fill to exceed min length\n`.repeat(20);
    expect(looksLikeLibraryFile(content, 'src/lib/utils/array.ts')).toBe(true);
  });

  it('does NOT flag lib/utils file that imports a sibling project module', () => {
    const content =
      `import { something } from '../domain/user';\n` +
      `export function helper(x) { return something(x); }\n` +
      `// padding\n`.repeat(20);
    expect(looksLikeLibraryFile(content, 'src/lib/utils/helper.ts')).toBe(false);
  });

  it('returns false for short files (under 200 chars)', () => {
    expect(looksLikeLibraryFile(`const x = 1;`, 'src/x.ts')).toBe(false);
  });

  it('flags very-long-line files (machine-generated, e.g. minified-ish)', () => {
    // 60 lines averaging >400 chars each → triggers the bundle heuristic.
    const longLine = 'a'.repeat(500);
    const content = Array.from({ length: 60 }).fill(longLine).join('\n');
    expect(looksLikeLibraryFile(content, 'src/something.js')).toBe(true);
  });

  it('does NOT flag a normal multi-line handler file by length heuristic', () => {
    const content =
      `import express from 'express';\n` +
      `const app = express();\n` +
      Array.from({ length: 80 })
        .map((_, i) => `app.get('/route${i}', (req, res) => res.json({ ok: true }));`)
        .join('\n');
    expect(looksLikeLibraryFile(content, 'src/api/routes.ts')).toBe(false);
  });
});

describe('exported constants', () => {
  it('ALWAYS_SKIP_DIRS contains expected dirs', () => {
    expect(ALWAYS_SKIP_DIRS.has('node_modules')).toBe(true);
    expect(ALWAYS_SKIP_DIRS.has('.git')).toBe(true);
    expect(ALWAYS_SKIP_DIRS.has('dist')).toBe(true);
    expect(ALWAYS_SKIP_DIRS.has('.zerou')).toBe(true);
  });
  it('THIRD_PARTY_DIRS contains expected dirs', () => {
    expect(THIRD_PARTY_DIRS.has('vendor')).toBe(true);
    expect(THIRD_PARTY_DIRS.has('third_party')).toBe(true);
    expect(THIRD_PARTY_DIRS.has('externals')).toBe(true);
  });
  it('SKIP_FILE_PATTERNS includes minified, d.ts, bundle', () => {
    const exposes = (re: RegExp, sample: string): boolean =>
      SKIP_FILE_PATTERNS.some((p) => p.test(sample)) && re.test(sample);
    expect(exposes(/\.min\.js$/, 'lib/foo.min.js')).toBe(true);
    expect(exposes(/\.d\.ts$/, 'types/index.d.ts')).toBe(true);
  });
});
