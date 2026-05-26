/**
 * Cross-Engine Reviewer — proposeFix tests.
 *
 * Surface: docs/details/14-protocol-1-public-surface.md
 * Test plan: docs/details/14-protocol-1-tests.md §B-4.
 *
 * Covers:
 *   B-4-1 — patch applies + verifyStep exits non-zero → verified: true
 *   B-4-2 — patch fails to apply → verified: false + patch-failed log
 *           — verifyStep is NEVER executed (sentinel-file assertion)
 *   B-4-3 — verifyStep exits zero → verified: false
 *           — verifyStep times out → verified: false + verify-timeout log
 *   B-4-4 — response missing verifyStep OR patch → returns null + fix-proposal-invalid
 *
 * Test discipline (per dispatch-notes #7): NEVER hardcode /tmp/. Always
 * `path.join(os.tmpdir(), '<prefix>-')`.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { execSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import path from 'node:path';

import { proposeFix } from './propose-fix.js';
import { pickCriticEngine } from './router.js';
import { captureLogsFor } from '../../log/test-helpers.js';
import type { EngineConfig } from '../../config/types.js';
import type {
  Finding,
  MinimalCriticEngineSurface,
} from './types.js';

beforeAll(() => {
  process.env.ZEROU_LOG_NULL = '1';
});

// ── Engine configs ──────────────────────────────────────────────────────────

const claudeCliCfg = (): EngineConfig => ({ kind: 'claude-cli' });
const codexCliCfg = (): EngineConfig => ({ kind: 'codex-cli' });

const codexMeta = {
  kind: 'codex-cli',
  modelId: 'gpt-5-mini',
  releaseDate: '2025-08-15',
};

// ── MockEngine for fix proposals (same shape as review.test.ts) ─────────────

interface FixScriptStep {
  kind: 'respond' | 'throw';
  json?: string;
  error?: Error;
}

class FixMockEngine implements MinimalCriticEngineSurface {
  calls = 0;
  private cursor = 0;
  reportedCostPerCall = 0;

  constructor(
    private meta: { kind: string; modelId: string; releaseDate: string },
    private script: FixScriptStep[],
  ) {}

  async call(_prompt: string): Promise<string> {
    this.calls += 1;
    const step = this.script[this.cursor++];
    if (!step) throw new Error('FixMockEngine script exhausted');
    if (step.kind === 'throw') throw step.error ?? new Error('mock throw');
    return step.json ?? '';
  }

  lastCallCostUsd(): number | null {
    return this.reportedCostPerCall;
  }

  getMeta() {
    return this.meta;
  }
}

function mockFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'secrets-leak.abc12345',
    presetId: 'secrets-leak',
    ruleId: 'hardcoded-stripe-key',
    severity: 'P1',
    file: 'file.ts',
    line: 1,
    evidence: 'OLD_TOKEN = "x"',
    matched_content_normalized: 'old_token="x"',
    message: 'Hardcoded token.',
    remediationHint: 'Remove.',
    fixAvailable: 'llm-only',
    version: '1.0',
    ...overrides,
  };
}

function crossFamilyPolicyWithMock(mock: FixMockEngine) {
  const policy = pickCriticEngine(claudeCliCfg(), [codexCliCfg()]);
  (policy as { criticEngine: MinimalCriticEngineSurface }).criticEngine = mock;
  return policy;
}

// ── Helpers: temp git repo ──────────────────────────────────────────────────

interface TempRepo {
  cwd: string;
  cleanup: () => void;
}

function makeTempRepo(files: Record<string, string>): TempRepo {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p1-fix-test-'));
  for (const [name, content] of Object.entries(files)) {
    const abs = path.join(dir, name);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
  }
  execSync('git init -q', { cwd: dir });
  execSync('git config user.email "test@example.com"', { cwd: dir });
  execSync('git config user.name "Test"', { cwd: dir });
  execSync('git add -A', { cwd: dir });
  execSync('git -c commit.gpgsign=false commit -q -m "init"', { cwd: dir });
  return {
    cwd: dir,
    cleanup: () => {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // best-effort
      }
    },
  };
}

/**
 * Compute a unified-diff that removes `OLD_TOKEN = "x"\n` from file.ts. Hand-
 * crafted patches don't depend on git's diff state and are stable across
 * platforms.
 */
function diffRemovingOldToken(): string {
  return [
    'diff --git a/file.ts b/file.ts',
    'index 0000001..0000002 100644',
    '--- a/file.ts',
    '+++ b/file.ts',
    '@@ -1 +0,0 @@',
    '-OLD_TOKEN = "x"',
    '',
  ].join('\n');
}

/**
 * Generate a real diff by checking what `git diff` produces between an
 * initial state and a modified state. This produces a portable diff that
 * `git apply` can roundtrip.
 */
function generateRealDiffRemovingOldToken(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p1-diffgen-'));
  try {
    fs.writeFileSync(path.join(dir, 'file.ts'), 'OLD_TOKEN = "x"\n', 'utf8');
    execSync('git init -q', { cwd: dir });
    execSync('git config user.email "test@example.com"', { cwd: dir });
    execSync('git config user.name "Test"', { cwd: dir });
    execSync('git add -A', { cwd: dir });
    execSync('git -c commit.gpgsign=false commit -q -m "init"', { cwd: dir });
    fs.writeFileSync(path.join(dir, 'file.ts'), '// removed\n', 'utf8');
    const diff = spawnSync('git', ['diff', '--no-color', 'file.ts'], {
      cwd: dir,
      encoding: 'utf8',
    });
    return diff.stdout ?? '';
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
}

// ── B-4-1 — verified true ───────────────────────────────────────────────────

describe('B-4-1 — proposeFix verified:true when patch + verifyStep work', () => {
  it('patch removes OLD_TOKEN; grep verifyStep exits non-zero → verified:true', async () => {
    const repo = makeTempRepo({ 'file.ts': 'OLD_TOKEN = "x"\n' });
    try {
      const realDiff = generateRealDiffRemovingOldToken();
      const mock = new FixMockEngine(codexMeta, [
        {
          kind: 'respond',
          json: JSON.stringify({
            patch: realDiff,
            verifyStep: 'grep -q OLD_TOKEN file.ts',
            reasoning: 'remove hardcoded token',
          }),
        },
      ]);
      const policy = crossFamilyPolicyWithMock(mock);

      const { result: proposal, entries } = await captureLogsFor(
        { track: 'critic' },
        async () =>
          proposeFix(
            mockFinding(),
            { cwd: repo.cwd, repoSha: null },
            policy,
          ),
      );

      expect(proposal).not.toBeNull();
      expect(proposal!.findingId).toBe(mockFinding().id);
      expect(proposal!.proposalKind).toBe('llm-only');
      expect(proposal!.verified).toBe(true);
      expect(proposal!.patch).toBe(realDiff);
      expect(proposal!.verifyStep).toBe('grep -q OLD_TOKEN file.ts');
      expect(proposal!.critic.kind).toBe('codex-cli');
      expect(proposal!.version).toBe('1.0');

      const startEntry = entries.find((e) => e.event === 'critic.fix-proposal.start');
      expect(startEntry).toBeDefined();
      expect(startEntry?.findingId).toBe(mockFinding().id);

      const successEntry = entries.find((e) => e.event === 'critic.fix-proposal.success');
      expect(successEntry).toBeDefined();
      expect(successEntry?.verified).toBe(true);
    } finally {
      repo.cleanup();
    }
  });

  it('verifyStep exits 0 (finding still detected) → verified:false', async () => {
    const repo = makeTempRepo({ 'file.ts': 'OLD_TOKEN = "x"\n' });
    try {
      const realDiff = generateRealDiffRemovingOldToken();
      const mock = new FixMockEngine(codexMeta, [
        {
          kind: 'respond',
          json: JSON.stringify({
            patch: realDiff,
            verifyStep: process.platform === 'win32' ? 'cmd /c exit 0' : 'true',
            reasoning: 'x',
          }),
        },
      ]);
      const policy = crossFamilyPolicyWithMock(mock);

      const { result: proposal, entries } = await captureLogsFor(
        { track: 'critic' },
        async () =>
          proposeFix(mockFinding(), { cwd: repo.cwd, repoSha: null }, policy),
      );

      expect(proposal).not.toBeNull();
      expect(proposal!.verified).toBe(false);
      expect(proposal!.patch).toBe(realDiff);

      const successEntry = entries.find((e) => e.event === 'critic.fix-proposal.success');
      expect(successEntry?.verified).toBe(false);
    } finally {
      repo.cleanup();
    }
  });
});

// ── B-4-2 — patch fails to apply ────────────────────────────────────────────

describe('B-4-2 — proposeFix patch-failed path', () => {
  it('broken diff → verified:false + fix-proposal-patch-failed log', async () => {
    const repo = makeTempRepo({ 'file.ts': 'actual content\n' });
    try {
      const brokenDiff = diffRemovingOldToken(); // references OLD_TOKEN which is not in file
      const mock = new FixMockEngine(codexMeta, [
        {
          kind: 'respond',
          json: JSON.stringify({
            patch: brokenDiff,
            verifyStep: 'true',
            reasoning: 'x',
          }),
        },
      ]);
      const policy = crossFamilyPolicyWithMock(mock);

      const { result: proposal, entries } = await captureLogsFor(
        { track: 'critic' },
        async () =>
          proposeFix(mockFinding(), { cwd: repo.cwd, repoSha: null }, policy),
      );

      expect(proposal).not.toBeNull();
      expect(proposal!.verified).toBe(false);
      expect(proposal!.patch).toBe(brokenDiff);

      const patchFailEntry = entries.find(
        (e) => e.event === 'critic.fix-proposal-patch-failed',
      );
      expect(patchFailEntry).toBeDefined();
      expect(patchFailEntry?.findingId).toBe(mockFinding().id);
      expect(typeof patchFailEntry?.error).toBe('string');
      expect((patchFailEntry?.error as string).length).toBeGreaterThan(0);
    } finally {
      repo.cleanup();
    }
  });

  it('verifyStep is NEVER executed when patch fails (no marker file created)', async () => {
    const repo = makeTempRepo({ 'file.ts': 'actual content\n' });
    const markerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p1-marker-'));
    const markerFile = path.join(markerDir, `marker-${Date.now()}-${Math.random()}`);
    try {
      const brokenDiff = diffRemovingOldToken();
      // verifyStep would create the marker file if executed.
      const verifyStep =
        process.platform === 'win32'
          ? `cmd /c type nul > "${markerFile}"`
          : `touch '${markerFile}'`;

      const mock = new FixMockEngine(codexMeta, [
        {
          kind: 'respond',
          json: JSON.stringify({
            patch: brokenDiff,
            verifyStep,
            reasoning: 'x',
          }),
        },
      ]);
      const policy = crossFamilyPolicyWithMock(mock);

      const { result: proposal, entries } = await captureLogsFor(
        { track: 'critic' },
        async () =>
          proposeFix(mockFinding(), { cwd: repo.cwd, repoSha: null }, policy),
      );

      expect(proposal!.verified).toBe(false);
      // Marker file MUST NOT exist — verifyStep was never executed.
      expect(fs.existsSync(markerFile)).toBe(false);
      // patch-failed log present
      expect(
        entries.find((e) => e.event === 'critic.fix-proposal-patch-failed'),
      ).toBeDefined();
      // No verify-timeout log
      expect(
        entries.find((e) => e.event === 'critic.fix-proposal-verify-timeout'),
      ).toBeUndefined();
    } finally {
      repo.cleanup();
      try {
        fs.rmSync(markerDir, { recursive: true, force: true });
      } catch {
        // best-effort
      }
    }
  });
});

// ── B-4-3 — verifyStep times out ────────────────────────────────────────────

describe('B-4-3 — proposeFix verify-timeout path', () => {
  it('verifyStep that sleeps past timeout → verified:false + verify-timeout log', async () => {
    // Skip on Windows where `sleep 5` command may not exist by default.
    if (process.platform === 'win32') return;

    const repo = makeTempRepo({ 'file.ts': 'OLD_TOKEN = "x"\n' });
    try {
      const realDiff = generateRealDiffRemovingOldToken();
      const mock = new FixMockEngine(codexMeta, [
        {
          kind: 'respond',
          json: JSON.stringify({
            patch: realDiff,
            verifyStep: 'sleep 5',
            reasoning: 'x',
          }),
        },
      ]);
      const policy = crossFamilyPolicyWithMock(mock);

      const startTime = Date.now();
      const { result: proposal, entries } = await captureLogsFor(
        { track: 'critic' },
        async () =>
          proposeFix(
            mockFinding(),
            { cwd: repo.cwd, repoSha: null },
            policy,
            { verifyTimeoutMs: 200 },
          ),
      );
      const elapsed = Date.now() - startTime;

      expect(proposal).not.toBeNull();
      expect(proposal!.verified).toBe(false);
      // Should resolve well under 5 seconds (timeout enforced)
      expect(elapsed).toBeLessThan(4500);

      const timeoutEntry = entries.find(
        (e) => e.event === 'critic.fix-proposal-verify-timeout',
      );
      expect(timeoutEntry).toBeDefined();
      expect(timeoutEntry?.findingId).toBe(mockFinding().id);
      expect(timeoutEntry?.timeoutMs).toBe(200);

      const successEntry = entries.find((e) => e.event === 'critic.fix-proposal.success');
      expect(successEntry?.verified).toBe(false);
    } finally {
      repo.cleanup();
    }
  });
});

// ── B-4-4 — invalid response ───────────────────────────────────────────────

describe('B-4-4 — proposeFix invalid response returns null', () => {
  it('response omits verifyStep → null + fix-proposal-invalid log', async () => {
    const repo = makeTempRepo({ 'file.ts': 'OLD_TOKEN = "x"\n' });
    try {
      const mock = new FixMockEngine(codexMeta, [
        {
          kind: 'respond',
          json: JSON.stringify({
            patch: 'diff --git a/file.ts b/file.ts\n',
            reasoning: 'x',
          }),
        },
      ]);
      const policy = crossFamilyPolicyWithMock(mock);

      const { result: proposal, entries } = await captureLogsFor(
        { track: 'critic' },
        async () =>
          proposeFix(mockFinding(), { cwd: repo.cwd, repoSha: null }, policy),
      );

      expect(proposal).toBeNull();

      const invalidEntry = entries.find(
        (e) => e.event === 'critic.fix-proposal-invalid',
      );
      expect(invalidEntry).toBeDefined();
      expect(invalidEntry?.findingId).toBe(mockFinding().id);
      expect((invalidEntry?.reason as string).toLowerCase()).toContain('verifystep');

      expect(
        entries.find((e) => e.event === 'critic.fix-proposal.success'),
      ).toBeUndefined();
    } finally {
      repo.cleanup();
    }
  });

  it('response omits patch → null + fix-proposal-invalid log', async () => {
    const repo = makeTempRepo({ 'file.ts': 'OLD_TOKEN = "x"\n' });
    try {
      const mock = new FixMockEngine(codexMeta, [
        {
          kind: 'respond',
          json: JSON.stringify({
            verifyStep: 'true',
            reasoning: 'x',
          }),
        },
      ]);
      const policy = crossFamilyPolicyWithMock(mock);

      const { result: proposal, entries } = await captureLogsFor(
        { track: 'critic' },
        async () =>
          proposeFix(mockFinding(), { cwd: repo.cwd, repoSha: null }, policy),
      );

      expect(proposal).toBeNull();
      const invalidEntry = entries.find(
        (e) => e.event === 'critic.fix-proposal-invalid',
      );
      expect(invalidEntry).toBeDefined();
      expect((invalidEntry?.reason as string).toLowerCase()).toContain('patch');
    } finally {
      repo.cleanup();
    }
  });
});
