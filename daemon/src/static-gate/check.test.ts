import { describe, it, expect } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { readCheckCommands, runStaticGate } from './check.js';

describe('readCheckCommands', () => {
  it('uses fallback when no yaml present', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'd2p-cc-no-'));
    const cc = await readCheckCommands(dir, { build: 'npm run build', test: 'npm test' });
    expect(cc.build).toBe('npm run build');
    expect(cc.test).toBe('npm test');
    expect(cc.typecheck).toBe('');
    await rm(dir, { recursive: true, force: true });
  });

  it('reads yaml overrides over fallback', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'd2p-cc-yes-'));
    await mkdir(path.join(dir, '.d2p'), { recursive: true });
    await writeFile(
      path.join(dir, '.d2p', 'check-commands.yaml'),
      'build: bun run build\ntest: bun test\ntypecheck: tsc --noEmit',
    );
    const cc = await readCheckCommands(dir, { build: 'fallback', test: 'fallback', typecheck: '' });
    expect(cc.build).toBe('bun run build');
    expect(cc.test).toBe('bun test');
    expect(cc.typecheck).toBe('tsc --noEmit');
    await rm(dir, { recursive: true, force: true });
  });
});

describe('runStaticGate', () => {
  it('passes when all commands are empty (no checks configured)', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'd2p-gate-empty-'));
    const r = await runStaticGate(dir, { build: '', test: '', typecheck: '' });
    expect(r.passed).toBe(true);
    expect(r.failedStage).toBeNull();
    await rm(dir, { recursive: true, force: true });
  });

  it('fails when typecheck exits non-zero', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'd2p-gate-fail-'));
    await writeFile(path.join(dir, 'fail.js'), 'process.exit(7);');
    const r = await runStaticGate(dir, {
      typecheck: 'node fail.js',
      build: '',
      test: '',
    });
    expect(r.passed).toBe(false);
    expect(r.failedStage).toBe('typecheck');
    expect(r.excerpt).toContain('typecheck');
    await rm(dir, { recursive: true, force: true });
  });

  it('rejects commands with shell metacharacters', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'd2p-gate-meta-'));
    // `;` should be denied; runOne returns null → treated as PASS for that stage
    const r = await runStaticGate(dir, {
      build: 'echo a; echo b',
      test: '',
      typecheck: '',
    });
    expect(r.passed).toBe(true); // metachar rejection → treated as no-op
    await rm(dir, { recursive: true, force: true });
  });
});
