/**
 * Tests for apply.ts — verifyCommand enforcement (dispatch-note #12).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import path from 'node:path';
import { runAudit } from './audit.js';
import {
  tmpRepo,
  writeConfig,
  validConfigData,
  mockPreset,
  readLogsUnder,
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

describe('verifyCommand enforcement (dispatch-note #12)', () => {
  it('rolls back the fix when verifyCommand fails', async () => {
    const repo = await tmpRepo({
      git: true,
      files: { 'a.ts': 'const A = "SECRET_TOKEN";\n' },
    });
    const cfg = writeConfig(repo.cwd, validConfigData);
    const preset = mockPreset({
      id: 'p',
      pattern: 'SECRET_TOKEN',
      fix: 'template',
      verifyCommand: process.platform === 'win32' ? 'exit 1' : 'false',
    });
    const orig = fs.readFileSync(path.join(repo.cwd, 'a.ts'), 'utf8');
    const exitCode = await runAudit({
      argv: ['node', 'zerou', 'audit', repo.cwd, '--config', cfg, '--apply', '--preset', 'p', '--no-color'],
      deps: {
        loadPreset: async () => preset,
        stdoutWrite: () => undefined,
        stderrWrite: () => undefined,
      },
    });
    expect(exitCode).toBe(0);
    // file should be unchanged after rollback
    const after = fs.readFileSync(path.join(repo.cwd, 'a.ts'), 'utf8');
    expect(after).toBe(orig);
    const logs = readLogsUnder(repo.cwd);
    const cliEntries = [...logs.entries()].find(([k]) => k.startsWith('cli/'))?.[1] ?? [];
    expect(cliEntries.some((e) => e.event === 'cli.apply.verify-failed')).toBe(true);
    expect(cliEntries.some((e) => e.event === 'cli.apply.template')).toBe(false);
    await repo.cleanup();
  });

  it('applies the fix when verifyCommand succeeds', async () => {
    const repo = await tmpRepo({
      git: true,
      files: { 'a.ts': 'const A = "SECRET_TOKEN";\n' },
    });
    const cfg = writeConfig(repo.cwd, validConfigData);
    const preset = mockPreset({
      id: 'p',
      pattern: 'SECRET_TOKEN',
      fix: 'template',
      verifyCommand: process.platform === 'win32' ? 'exit 0' : 'true',
    });
    const exitCode = await runAudit({
      argv: ['node', 'zerou', 'audit', repo.cwd, '--config', cfg, '--apply', '--preset', 'p', '--no-color'],
      deps: {
        loadPreset: async () => preset,
        stdoutWrite: () => undefined,
        stderrWrite: () => undefined,
      },
    });
    expect(exitCode).toBe(0);
    const after = fs.readFileSync(path.join(repo.cwd, 'a.ts'), 'utf8');
    expect(after).not.toMatch(/SECRET_TOKEN/);
    const logs = readLogsUnder(repo.cwd);
    const cliEntries = [...logs.entries()].find(([k]) => k.startsWith('cli/'))?.[1] ?? [];
    expect(cliEntries.some((e) => e.event === 'cli.apply.template')).toBe(true);
    await repo.cleanup();
  });

  it('skip-unverified for llm-only proposal with verified=false', async () => {
    const repo = await tmpRepo({
      git: true,
      files: { 'a.ts': 'const A = "SECRET_TOKEN";\n' },
    });
    const cfg = writeConfig(repo.cwd, validConfigData);
    const preset = mockPreset({
      id: 'p',
      pattern: 'SECRET_TOKEN',
      fix: 'llm-only',
    });
    const orig = fs.readFileSync(path.join(repo.cwd, 'a.ts'), 'utf8');
    const exitCode = await runAudit({
      argv: ['node', 'zerou', 'audit', repo.cwd, '--config', cfg, '--apply', '--preset', 'p', '--no-color'],
      deps: {
        loadPreset: async () => preset,
        proposeFix: async () => ({ patch: 'noop', verified: false }),
        stdoutWrite: () => undefined,
        stderrWrite: () => undefined,
      },
    });
    expect(exitCode).toBe(0);
    expect(fs.readFileSync(path.join(repo.cwd, 'a.ts'), 'utf8')).toBe(orig);
    const logs = readLogsUnder(repo.cwd);
    const cliEntries = [...logs.entries()].find(([k]) => k.startsWith('cli/'))?.[1] ?? [];
    expect(cliEntries.some((e) => e.event === 'cli.apply.skip-unverified')).toBe(true);
    await repo.cleanup();
  });
});
