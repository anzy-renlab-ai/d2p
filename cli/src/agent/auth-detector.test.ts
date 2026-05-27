/**
 * Tests for agent/auth-detector (Phase 11.3).
 *
 * Strategy: build tmpdir fixtures with package.json + source files and assert
 * detectAuthShape returns the expected shape. No network, no real LLM.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { detectAuthShape } from './auth-detector.js';
import {
  createTrackLogger,
  __resetMetaLoggersForTests,
  __resetLiveLoggersForTests,
  __resetRotationGateForTests,
} from '../log-types.js';

beforeEach(() => {
  __resetMetaLoggersForTests();
  __resetLiveLoggersForTests();
  __resetRotationGateForTests();
});
afterEach(() => {
  __resetMetaLoggersForTests();
  __resetLiveLoggersForTests();
  __resetRotationGateForTests();
});

function tmpDir(): { dir: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-detect-'));
  return {
    dir,
    cleanup: () => {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    },
  };
}

function writeFile(dir: string, rel: string, content: string): void {
  const abs = path.join(dir, rel.split('/').join(path.sep));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
}

const logger = () => createTrackLogger('agent', { silent: true });

describe('detectAuthShape', () => {
  it('returns none when no package.json exists', async () => {
    const t = tmpDir();
    try {
      const shape = await detectAuthShape({ cwd: t.dir, logger: logger() });
      expect(shape.kind).toBe('none');
    } finally {
      t.cleanup();
    }
  });

  it('returns none when package.json has neither supabase nor next-auth', async () => {
    const t = tmpDir();
    try {
      writeFile(t.dir, 'package.json', JSON.stringify({
        dependencies: { 'next': '14.0.0', 'react': '18.0.0' },
      }));
      const shape = await detectAuthShape({ cwd: t.dir, logger: logger() });
      expect(shape.kind).toBe('none');
    } finally {
      t.cleanup();
    }
  });

  it('detects supabase-ssr via package.json + source scan', async () => {
    const t = tmpDir();
    try {
      writeFile(t.dir, 'package.json', JSON.stringify({
        dependencies: { '@supabase/ssr': '0.1.0', 'next': '14.0.0' },
      }));
      writeFile(t.dir, 'lib/auth/server.ts', [
        `import { createServerClient } from '@supabase/ssr';`,
        `import { cookies } from 'next/headers';`,
        ``,
        `export async function createSupabaseServerClient() {`,
        `  return createServerClient(process.env.URL!, process.env.KEY!, { cookies: cookies() });`,
        `}`,
        ``,
        `export async function getServerUser() {`,
        `  const sb = await createSupabaseServerClient();`,
        `  const { data } = await sb.auth.getUser();`,
        `  return data.user;`,
        `}`,
      ].join('\n'));
      const shape = await detectAuthShape({ cwd: t.dir, logger: logger() });
      expect(shape.kind).toBe('supabase-ssr');
      expect(shape.helperFile).toBe('lib/auth/server.ts');
      expect(shape.helperFunctionName).toBe('getServerUser');
    } finally {
      t.cleanup();
    }
  });

  it('detects nextauth via package.json + source scan', async () => {
    const t = tmpDir();
    try {
      writeFile(t.dir, 'package.json', JSON.stringify({
        dependencies: { 'next-auth': '4.24.0', 'next': '14.0.0' },
      }));
      writeFile(t.dir, 'lib/auth.ts', [
        `import { getServerSession as nextGetSession } from 'next-auth';`,
        `import { authOptions } from './options';`,
        ``,
        `export async function getServerSession() {`,
        `  return nextGetSession(authOptions);`,
        `}`,
      ].join('\n'));
      const shape = await detectAuthShape({ cwd: t.dir, logger: logger() });
      expect(shape.kind).toBe('nextauth');
      expect(shape.helperFile).toBe('lib/auth.ts');
      expect(shape.helperFunctionName).toBe('getServerSession');
    } finally {
      t.cleanup();
    }
  });

  it('prefers supabase-ssr when both libs present', async () => {
    const t = tmpDir();
    try {
      writeFile(t.dir, 'package.json', JSON.stringify({
        dependencies: { '@supabase/ssr': '0.1.0', 'next-auth': '4.24.0' },
      }));
      writeFile(t.dir, 'lib/auth/server.ts', [
        `import { createServerClient } from '@supabase/ssr';`,
        `export async function getServerUser() { return null; }`,
      ].join('\n'));
      writeFile(t.dir, 'lib/legacy-auth.ts', [
        `import { getServerSession } from 'next-auth';`,
        `export async function getServerSession() { return null; }`,
      ].join('\n'));
      const shape = await detectAuthShape({ cwd: t.dir, logger: logger() });
      expect(shape.kind).toBe('supabase-ssr');
    } finally {
      t.cleanup();
    }
  });

  it('detects supabase-ssr via auth-helpers package', async () => {
    const t = tmpDir();
    try {
      writeFile(t.dir, 'package.json', JSON.stringify({
        dependencies: { '@supabase/auth-helpers-nextjs': '0.8.0' },
      }));
      writeFile(t.dir, 'lib/supabase-server.ts', [
        `import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';`,
        `export async function getUser() { return null; }`,
      ].join('\n'));
      const shape = await detectAuthShape({ cwd: t.dir, logger: logger() });
      expect(shape.kind).toBe('supabase-ssr');
      expect(shape.helperFunctionName).toBe('getUser');
    } finally {
      t.cleanup();
    }
  });

  it('returns none when dep present but no helper file found', async () => {
    const t = tmpDir();
    try {
      writeFile(t.dir, 'package.json', JSON.stringify({
        dependencies: { '@supabase/ssr': '0.1.0' },
      }));
      // a source file that imports supabase but has NO exported helper function
      writeFile(t.dir, 'lib/random.ts', [
        `import { createServerClient } from '@supabase/ssr';`,
        `// no exported helper function`,
      ].join('\n'));
      const shape = await detectAuthShape({ cwd: t.dir, logger: logger() });
      expect(shape.kind).toBe('none');
    } finally {
      t.cleanup();
    }
  });

  it('resolves @/-style alias via tsconfig paths', async () => {
    const t = tmpDir();
    try {
      writeFile(t.dir, 'package.json', JSON.stringify({
        dependencies: { '@supabase/ssr': '0.1.0' },
      }));
      writeFile(t.dir, 'tsconfig.json', JSON.stringify({
        compilerOptions: {
          baseUrl: '.',
          paths: { '@/*': ['./*'] },
        },
      }));
      writeFile(t.dir, 'lib/auth/server.ts', [
        `import { createServerClient } from '@supabase/ssr';`,
        `export async function getServerUser() { return null; }`,
      ].join('\n'));
      const shape = await detectAuthShape({ cwd: t.dir, logger: logger() });
      expect(shape.kind).toBe('supabase-ssr');
      expect(shape.helperImport).toBe('@/lib/auth/server');
    } finally {
      t.cleanup();
    }
  });

  it('falls back to ./relative path when no tsconfig alias present', async () => {
    const t = tmpDir();
    try {
      writeFile(t.dir, 'package.json', JSON.stringify({
        dependencies: { '@supabase/ssr': '0.1.0' },
      }));
      writeFile(t.dir, 'lib/auth/server.ts', [
        `import { createServerClient } from '@supabase/ssr';`,
        `export async function getServerUser() { return null; }`,
      ].join('\n'));
      const shape = await detectAuthShape({ cwd: t.dir, logger: logger() });
      expect(shape.helperImport).toBe('./lib/auth/server');
    } finally {
      t.cleanup();
    }
  });

  it('handles tsconfig with comments and trailing commas', async () => {
    const t = tmpDir();
    try {
      writeFile(t.dir, 'package.json', JSON.stringify({
        dependencies: { '@supabase/ssr': '0.1.0' },
      }));
      writeFile(t.dir, 'tsconfig.json', [
        '{',
        '  // base config for next.js',
        '  "compilerOptions": {',
        '    "baseUrl": ".",',
        '    "paths": { "@/*": ["./*"], },',
        '  },',
        '}',
      ].join('\n'));
      writeFile(t.dir, 'lib/auth/server.ts', [
        `import { createServerClient } from '@supabase/ssr';`,
        `export async function getServerUser() { return null; }`,
      ].join('\n'));
      const shape = await detectAuthShape({ cwd: t.dir, logger: logger() });
      expect(shape.helperImport).toBe('@/lib/auth/server');
    } finally {
      t.cleanup();
    }
  });

  it('does not throw on missing source directory', async () => {
    const t = tmpDir();
    try {
      writeFile(t.dir, 'package.json', JSON.stringify({
        dependencies: { '@supabase/ssr': '0.1.0' },
      }));
      // no source files at all
      const shape = await detectAuthShape({ cwd: t.dir, logger: logger() });
      expect(shape.kind).toBe('none');
    } finally {
      t.cleanup();
    }
  });
});
