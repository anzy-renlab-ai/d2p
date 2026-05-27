/**
 * Tests for Phase 10 Module B — log-executor.
 *
 * Covers:
 *  - Bootstrap file creation when plan.bootstrapFile non-null and missing
 *  - Bootstrap skipped when file already exists (idempotency)
 *  - Middleware file creation for Next.js plan
 *  - package.json devDependencies patched with pinned versions
 *  - package.json patch idempotent (no double-write)
 *  - Silent-catch transformation
 *  - Idempotency: running executor twice does not re-rewrite catches
 *  - console.log → logger.info transformation
 *  - logger import injected when console rewrite touches a file
 *  - Read failure surfaces as a per-file failure entry
 *  - Files with no applicable sites are skipped (no-op)
 *  - enhance.log.executor.start + .complete emitted
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

import { executeLogInjection } from './log-executor.js';
import type { InjectionPlan } from './types.js';
import {
  createTrackLogger,
  __resetMetaLoggersForTests,
  __resetLiveLoggersForTests,
  __resetRotationGateForTests,
  type TrackLogger,
} from '../log-types.js';
import { captureLogsFor } from '../log/test-helpers.js';

beforeEach(() => {
  __resetMetaLoggersForTests();
  __resetLiveLoggersForTests();
  __resetRotationGateForTests();
});

async function tmpdir(): Promise<string> {
  return fsp.mkdtemp(path.join(os.tmpdir(), 'zerou-logexec-'));
}

async function writeFile(root: string, rel: string, content: string): Promise<void> {
  const abs = path.join(root, rel);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, content);
}

function makeLogger(cwd: string): TrackLogger {
  return createTrackLogger('enhance', { logRoot: path.join(cwd, '.zerou', 'logs') });
}

function basePlan(overrides: Partial<InjectionPlan> = {}): InjectionPlan {
  return {
    loggerLib: 'pino',
    framework: 'unknown',
    installDeps: [],
    bootstrapFile: null,
    middlewareFile: null,
    sites: [],
    ...overrides,
  };
}

describe('log-executor / scaffolding', () => {
  it('creates the bootstrap file when missing', async () => {
    const cwd = await tmpdir();
    await writeFile(cwd, 'package.json', JSON.stringify({ name: 'demo' }));
    const result = await executeLogInjection({
      cwd,
      plan: basePlan({ bootstrapFile: 'src/logger.ts' }),
      logger: makeLogger(cwd),
    });
    expect(result.filesChanged).toContain('src/logger.ts');
    const txt = fs.readFileSync(path.join(cwd, 'src/logger.ts'), 'utf8');
    expect(txt).toContain('export const logger');
    expect(txt).toContain('pino');
  });

  it('does not overwrite an existing bootstrap file', async () => {
    const cwd = await tmpdir();
    await writeFile(cwd, 'package.json', JSON.stringify({ name: 'demo' }));
    await writeFile(cwd, 'src/logger.ts', '// user owned\nexport const logger = console;\n');
    const result = await executeLogInjection({
      cwd,
      plan: basePlan({ bootstrapFile: 'src/logger.ts' }),
      logger: makeLogger(cwd),
    });
    expect(result.filesChanged).not.toContain('src/logger.ts');
    const txt = fs.readFileSync(path.join(cwd, 'src/logger.ts'), 'utf8');
    expect(txt).toContain('// user owned');
  });

  it('creates middleware.ts when plan asks for it', async () => {
    const cwd = await tmpdir();
    await writeFile(cwd, 'package.json', JSON.stringify({ name: 'demo' }));
    const result = await executeLogInjection({
      cwd,
      plan: basePlan({
        framework: 'next.js',
        bootstrapFile: 'src/logger.ts',
        middlewareFile: 'middleware.ts',
      }),
      logger: makeLogger(cwd),
    });
    expect(result.filesChanged).toContain('middleware.ts');
    const txt = fs.readFileSync(path.join(cwd, 'middleware.ts'), 'utf8');
    expect(txt).toContain('NextResponse');
    expect(txt).toContain('correlationId');
  });

  it('patches package.json devDependencies with pinned versions', async () => {
    const cwd = await tmpdir();
    await writeFile(cwd, 'package.json', JSON.stringify({ name: 'demo' }, null, 2));
    const result = await executeLogInjection({
      cwd,
      plan: basePlan({ installDeps: ['pino', 'pino-http'] }),
      logger: makeLogger(cwd),
    });
    expect(result.filesChanged).toContain('package.json');
    const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));
    expect(pkg.devDependencies.pino).toMatch(/^\^9\./);
    expect(pkg.devDependencies['pino-http']).toMatch(/^\^10\./);
  });

  it('package.json patch is idempotent — second run does not re-stage changes', async () => {
    const cwd = await tmpdir();
    await writeFile(cwd, 'package.json', JSON.stringify({ name: 'demo' }, null, 2));
    await executeLogInjection({
      cwd,
      plan: basePlan({ installDeps: ['pino', 'pino-http'] }),
      logger: makeLogger(cwd),
    });
    const second = await executeLogInjection({
      cwd,
      plan: basePlan({ installDeps: ['pino', 'pino-http'] }),
      logger: makeLogger(cwd),
    });
    expect(second.filesChanged).not.toContain('package.json');
  });
});

describe('log-executor / transformations', () => {
  it('rewrites silent catch blocks', async () => {
    const cwd = await tmpdir();
    await writeFile(cwd, 'package.json', JSON.stringify({ name: 'demo' }));
    await writeFile(
      cwd,
      'src/db.ts',
      `import { logger } from './logger';
export async function bad() {
  try {
    await doSomething();
  } catch (e) {}
}
`,
    );
    const result = await executeLogInjection({
      cwd,
      plan: basePlan({
        sites: [
          {
            file: 'src/db.ts',
            line: 4,
            endLine: 4,
            kind: 'silent-catch',
            preview: 'catch (e) {}',
          },
        ],
      }),
      logger: makeLogger(cwd),
    });
    expect(result.filesChanged).toContain('src/db.ts');
    const txt = fs.readFileSync(path.join(cwd, 'src/db.ts'), 'utf8');
    expect(txt).toContain("logger.error({ err: e }, 'unhandled')");
  });

  it('silent-catch rewrite is idempotent', async () => {
    const cwd = await tmpdir();
    await writeFile(cwd, 'package.json', JSON.stringify({ name: 'demo' }));
    await writeFile(
      cwd,
      'src/db.ts',
      `import { logger } from './logger';
export async function bad() {
  try { await doSomething(); } catch (e) {}
}
`,
    );
    const plan = basePlan({
      sites: [
        {
          file: 'src/db.ts',
          line: 3,
          endLine: 3,
          kind: 'silent-catch',
          preview: 'catch',
        },
      ],
    });
    const first = await executeLogInjection({ cwd, plan, logger: makeLogger(cwd) });
    expect(first.filesChanged).toContain('src/db.ts');
    const second = await executeLogInjection({ cwd, plan, logger: makeLogger(cwd) });
    expect(second.filesChanged).not.toContain('src/db.ts');
  });

  it('rewrites console.log → logger.info and injects import', async () => {
    const cwd = await tmpdir();
    await writeFile(cwd, 'package.json', JSON.stringify({ name: 'demo' }));
    await writeFile(
      cwd,
      'src/util.ts',
      `export function run() {
  console.log('hi');
  console.error('boom');
}
`,
    );
    const result = await executeLogInjection({
      cwd,
      plan: basePlan({
        bootstrapFile: 'src/logger.ts',
        sites: [
          {
            file: 'src/util.ts',
            line: 2,
            endLine: 2,
            kind: 'console-log',
            preview: 'console.log',
          },
        ],
      }),
      logger: makeLogger(cwd),
    });
    expect(result.filesChanged).toContain('src/util.ts');
    const txt = fs.readFileSync(path.join(cwd, 'src/util.ts'), 'utf8');
    expect(txt).toContain('logger.info(');
    expect(txt).toContain('logger.error(');
    expect(txt).not.toContain('console.log(');
    expect(txt).toMatch(/import \{ logger \} from ['"]\.\/logger['"]/);
  });

  it('does not duplicate logger import when one already exists', async () => {
    const cwd = await tmpdir();
    await writeFile(cwd, 'package.json', JSON.stringify({ name: 'demo' }));
    await writeFile(
      cwd,
      'src/util.ts',
      `import { logger } from './logger';
export function run() {
  console.log('hi');
}
`,
    );
    const result = await executeLogInjection({
      cwd,
      plan: basePlan({
        bootstrapFile: 'src/logger.ts',
        sites: [
          {
            file: 'src/util.ts',
            line: 3,
            endLine: 3,
            kind: 'console-log',
            preview: 'console.log',
          },
        ],
      }),
      logger: makeLogger(cwd),
    });
    expect(result.filesChanged).toContain('src/util.ts');
    const txt = fs.readFileSync(path.join(cwd, 'src/util.ts'), 'utf8');
    const importMatches = txt.match(/import \{ logger \}/g) ?? [];
    expect(importMatches.length).toBe(1);
  });
});

describe('log-executor / failure handling', () => {
  it('records a failure when target file does not exist', async () => {
    const cwd = await tmpdir();
    await writeFile(cwd, 'package.json', JSON.stringify({ name: 'demo' }));
    const result = await executeLogInjection({
      cwd,
      plan: basePlan({
        sites: [
          {
            file: 'src/nonexistent.ts',
            line: 1,
            endLine: 1,
            kind: 'console-log',
            preview: 'console.log',
          },
        ],
      }),
      logger: makeLogger(cwd),
    });
    expect(result.failures.length).toBe(1);
    expect(result.failures[0]!.file).toBe('src/nonexistent.ts');
  });

  it('skips files where no applicable transformation kind is present', async () => {
    const cwd = await tmpdir();
    await writeFile(cwd, 'package.json', JSON.stringify({ name: 'demo' }));
    await writeFile(cwd, 'src/route.ts', 'export async function POST() {}\n');
    const result = await executeLogInjection({
      cwd,
      plan: basePlan({
        sites: [
          {
            file: 'src/route.ts',
            line: 1,
            endLine: 1,
            // v1 doesn't handle http-boundary in executor; middleware module does.
            kind: 'http-boundary',
            preview: 'POST',
          },
        ],
      }),
      logger: makeLogger(cwd),
    });
    expect(result.filesChanged).not.toContain('src/route.ts');
    expect(result.failures).toEqual([]);
  });
});

describe('log-executor / observability', () => {
  it('emits enhance.log.executor.start and .complete events', async () => {
    const cwd = await tmpdir();
    await writeFile(cwd, 'package.json', JSON.stringify({ name: 'demo' }));
    const { entries } = await captureLogsFor(
      { track: 'enhance', eventPattern: /^enhance\.log\.executor\./ },
      async () => {
        await executeLogInjection({
          cwd,
          plan: basePlan({ bootstrapFile: 'src/logger.ts' }),
          logger: makeLogger(cwd),
        });
      },
    );
    expect(entries.some((e) => e.event === 'enhance.log.executor.start')).toBe(true);
    expect(entries.some((e) => e.event === 'enhance.log.executor.complete')).toBe(true);
  });
});
