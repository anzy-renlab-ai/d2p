/**
 * Tests for `zerou trace`.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { runTrace } from './trace.js';
import { runAudit } from './audit.js';
import {
  tmpRepo,
  writeConfig,
  validConfigData,
  mockPreset,
} from './__fixtures__/helpers.js';
import {
  __resetMetaLoggersForTests,
  __resetLiveLoggersForTests,
  __resetRotationGateForTests,
} from './log-types.js';

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

describe('zerou trace --last', () => {
  it('reads the most-recent audit run and outputs entries in ts order', async () => {
    const repo = await tmpRepo({
      git: true,
      files: { 'a.ts': 'const A = "MARK";\n' },
    });
    const cfg = writeConfig(repo.cwd, validConfigData);
    const preset = mockPreset({ id: 'p', pattern: 'MARK', fix: 'none' });
    // Run an audit so logs exist
    await runAudit({
      argv: ['node', 'zerou', 'audit', repo.cwd, '--config', cfg, '--preset', 'p', '--no-color'],
      deps: {
        loadPreset: async () => preset,
        stdoutWrite: () => undefined,
        stderrWrite: () => undefined,
      },
    });

    // Now invoke trace with --last
    let out = '';
    const code = await runTrace({
      cwd: repo.cwd,
      last: true,
      stdoutWrite: (s) => {
        out += s;
      },
      stderrWrite: () => undefined,
    });
    expect(code).toBe(0);
    expect(out.length).toBeGreaterThan(0);
    const lines = out.split('\n').filter((l) => l.trim().length > 0);
    expect(lines.length).toBeGreaterThan(0);
    // Parse ISO timestamps and confirm sorted
    const tsList = lines.map((l) => {
      const m = l.match(/^(\S+)/);
      return m ? new Date(m[1]!).getTime() : 0;
    });
    for (let i = 1; i < tsList.length; i++) {
      expect(tsList[i]).toBeGreaterThanOrEqual(tsList[i - 1]!);
    }
    // Output contains at least one cli.* event line and one critic.* event line
    expect(lines.some((l) => l.includes('cli.audit.start'))).toBe(true);
    expect(lines.some((l) => l.includes('critic.policy-selected'))).toBe(true);
    await repo.cleanup();
  });

  it('--filter cli.audit.* limits output', async () => {
    const repo = await tmpRepo({
      git: true,
      files: { 'a.ts': 'const A = "MARK";\n' },
    });
    const cfg = writeConfig(repo.cwd, validConfigData);
    const preset = mockPreset({ id: 'p', pattern: 'MARK', fix: 'none' });
    await runAudit({
      argv: ['node', 'zerou', 'audit', repo.cwd, '--config', cfg, '--preset', 'p', '--no-color'],
      deps: {
        loadPreset: async () => preset,
        stdoutWrite: () => undefined,
        stderrWrite: () => undefined,
      },
    });
    let out = '';
    await runTrace({
      cwd: repo.cwd,
      last: true,
      filter: 'cli.audit.*',
      stdoutWrite: (s) => {
        out += s;
      },
      stderrWrite: () => undefined,
    });
    const lines = out.split('\n').filter((l) => l.trim().length > 0);
    for (const ln of lines) {
      expect(ln).toMatch(/cli\.audit\./);
    }
    expect(lines.length).toBeGreaterThan(0);
    await repo.cleanup();
  });

  it('returns non-zero when no logs', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'zerou-trace-empty-'));
    try {
      const code = await runTrace({
        cwd: dir,
        last: true,
        stdoutWrite: () => undefined,
        stderrWrite: () => undefined,
      });
      expect(code).toBe(1);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });
});
