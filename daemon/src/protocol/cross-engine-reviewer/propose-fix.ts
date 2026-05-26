/**
 * Cross-Engine Reviewer Protocol — proposeFix.
 *
 * Surface authority: docs/details/14-protocol-1-public-surface.md
 *
 * Behavior contract:
 *   B-4-1 — patch applies + verifyStep exits non-zero → verified: true
 *   B-4-2 — patch fails to apply → verified: false + fix-proposal-patch-failed
 *           log; verifyStep is NEVER run (per surface §"verify ordering")
 *   B-4-3 — verifyStep exits zero (finding still detected) → verified: false
 *           — variant: verifyStep times out → verified: false + verify-timeout log
 *   B-4-4 — response missing patch OR verifyStep → returns null + fix-proposal-invalid
 *
 * Implementation:
 *   - Apply the unified diff via `git apply` in a temp clone of ctx.cwd
 *   - Run verifyStep via child_process.execSync (cwd = temp clone)
 *   - Honor verifyTimeoutMs (default 60_000)
 *   - Restore: temp clone is a separate directory; nothing to undo in ctx.cwd
 */

import { execSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import path from 'node:path';

import { createTrackLogger, type TrackLogger } from '../../log/track-logger.js';
import { engineFamily } from './router.js';
import type { ReviewContext, ReviewOptions } from './review.js';
import type {
  CriticInfo,
  CriticPolicy,
  Finding,
  FixProposal,
  MinimalCriticEngineSurface,
} from './types.js';

export interface ProposeFixOptions extends ReviewOptions {
  /** Override the 60-second default verify timeout. */
  verifyTimeoutMs?: number;
}

interface ParsedFixResponse {
  patch: string;
  verifyStep: string;
  reasoning: string;
}

function tryParseFixJson(raw: string): {
  parsed: ParsedFixResponse | null;
  invalidReason: string | null;
} {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch (err) {
    return { parsed: null, invalidReason: `JSON parse error: ${(err as Error).message}` };
  }
  if (!obj || typeof obj !== 'object') {
    return { parsed: null, invalidReason: 'response is not an object' };
  }
  const o = obj as Record<string, unknown>;
  const patch = typeof o.patch === 'string' ? o.patch : null;
  const verifyStep = typeof o.verifyStep === 'string' ? o.verifyStep : null;
  const reasoning = typeof o.reasoning === 'string' ? o.reasoning : '';
  if (patch === null && verifyStep === null) {
    return { parsed: null, invalidReason: 'missing patch and verifyStep' };
  }
  if (patch === null) {
    return { parsed: null, invalidReason: 'missing patch' };
  }
  if (verifyStep === null) {
    return { parsed: null, invalidReason: 'missing verifyStep' };
  }
  return { parsed: { patch, verifyStep, reasoning }, invalidReason: null };
}

function renderFixPrompt(finding: Finding): string {
  return [
    'You are a code-fix critic. A finding has been confirmed real. Propose a',
    'minimal fix as a unified diff, plus a deterministic verify command that',
    'should exit NON-ZERO after the patch is applied (meaning the finding is',
    'no longer detected). If your fix is correct, the verify command exits',
    'non-zero in the patched tree.',
    '',
    'Return JSON only:',
    '{',
    '  "patch":      string (unified diff format),',
    '  "verifyStep": string (shell command),',
    '  "reasoning":  string (≤500 chars)',
    '}',
    '',
    `Preset:       ${finding.presetId}`,
    `Rule:         ${finding.ruleId}`,
    `Severity:     ${finding.severity}`,
    `File:         ${finding.file}:${finding.line}`,
    `Evidence:     ${finding.evidence}`,
    `Message:      ${finding.message}`,
    finding.remediationHint
      ? `Remediation:  ${finding.remediationHint}`
      : '(no remediation hint)',
    '',
    'Return JSON only.',
  ].join('\n');
}

function resolveCriticLogger(opts?: ReviewOptions): TrackLogger {
  if (opts?.logger) {
    return createTrackLogger('critic', {
      parentTrace: opts.logger.trace,
      minLevel: 'debug',
    });
  }
  return createTrackLogger('critic', { minLevel: 'debug' });
}

function buildCriticInfo(
  policy: CriticPolicy,
  meta: { kind: string; modelId: string; releaseDate: string },
  costUsd: number | null,
): CriticInfo {
  return {
    kind: meta.kind,
    modelId: meta.modelId,
    releaseDate: meta.releaseDate,
    family: engineFamily(policy.critic),
    costUsd,
  };
}

/**
 * Apply a unified diff in a temp clone of ctx.cwd. Returns the clone path
 * + an error if patch failed. Caller is responsible for cleanup.
 */
function applyPatchInTempClone(
  srcCwd: string,
  patch: string,
): { cloneDir: string; error: string | null } {
  const cloneDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p1-fix-'));
  // Shallow copy via recursive fs.cpSync. Per surface §"What this surface
  // does NOT promise": clone strategy is not guaranteed to be efficient;
  // full repo copy is acceptable.
  try {
    fs.cpSync(srcCwd, cloneDir, { recursive: true, dereference: false });
  } catch (err) {
    return { cloneDir, error: `failed to clone cwd: ${(err as Error).message}` };
  }

  // Apply patch via `git apply` for robust handling of unified diff hunks.
  // We use `git apply` (not `patch` or `apply`-like) because it tolerates
  // missing repo state better — it can apply patches to non-git directories
  // via --unsafe-paths if needed. For our temp clone (which IS the user repo),
  // git is present.
  const patchFile = path.join(cloneDir, '.p1-proposed.patch');
  fs.writeFileSync(patchFile, patch, 'utf8');

  // Use spawnSync to capture stderr without throwing.
  const result = spawnSync('git', ['apply', '--whitespace=nowarn', '.p1-proposed.patch'], {
    cwd: cloneDir,
    encoding: 'utf8',
  });

  // Clean up the patch sidecar regardless of outcome.
  try {
    fs.unlinkSync(patchFile);
  } catch {
    // best-effort
  }

  if (result.status !== 0) {
    const stderr = (result.stderr ?? '').toString();
    const errMsg = stderr.length > 0 ? stderr.trim() : `git apply exit ${result.status}`;
    return { cloneDir, error: errMsg };
  }

  return { cloneDir, error: null };
}

/**
 * Run verifyStep in the clone with a timeout. Returns:
 * - { exitCode: number } if it ran to completion
 * - { timedOut: true } if it exceeded timeout
 */
function runVerifyStep(
  cwd: string,
  command: string,
  timeoutMs: number,
): { exitCode: number; timedOut: false } | { exitCode: null; timedOut: true } {
  try {
    execSync(command, {
      cwd,
      stdio: 'pipe',
      timeout: timeoutMs,
      killSignal: 'SIGKILL',
    });
    return { exitCode: 0, timedOut: false };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & {
      status?: number | null;
      signal?: string | null;
    };
    // execSync sets `signal: 'SIGTERM'`/`'SIGKILL'` on timeout.
    if (e.signal === 'SIGTERM' || e.signal === 'SIGKILL' || e.code === 'ETIMEDOUT') {
      return { exitCode: null, timedOut: true };
    }
    const exitCode = typeof e.status === 'number' ? e.status : 1;
    return { exitCode, timedOut: false };
  }
}

function cleanup(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

// ── proposeFix ─────────────────────────────────────────────────────────────

export async function proposeFix(
  finding: Finding,
  ctx: ReviewContext,
  policy: CriticPolicy,
  opts?: ProposeFixOptions,
): Promise<FixProposal | null> {
  if (policy === null || policy === undefined) {
    throw new Error('P1-E-1: proposeFix called with null/undefined policy');
  }

  const logger = resolveCriticLogger(opts);
  const verifyTimeoutMs = opts?.verifyTimeoutMs ?? 60_000;

  logger.log('info', 'critic.fix-proposal.start', {
    findingId: finding.id,
    presetId: finding.presetId,
    ruleId: finding.ruleId,
  });

  const engine: MinimalCriticEngineSurface = policy.criticEngine;
  const prompt = renderFixPrompt(finding);

  let raw: string;
  try {
    raw = await engine.call(prompt);
  } catch (err) {
    const errMsg = (err as Error)?.message ?? String(err);
    logger.log('warn', 'critic.fix-proposal-invalid', {
      findingId: finding.id,
      reason: `critic call failed: ${errMsg}`,
    });
    return null;
  }

  // Capture cost synchronously after the call resolves.
  let costUsd: number | null = null;
  try {
    costUsd = engine.lastCallCostUsd();
  } catch {
    costUsd = null;
  }

  const meta = engine.getMeta();
  const { parsed, invalidReason } = tryParseFixJson(raw);

  if (!parsed) {
    logger.log('warn', 'critic.fix-proposal-invalid', {
      findingId: finding.id,
      reason: invalidReason ?? 'unknown',
    });
    return null;
  }

  // Apply patch in a temp clone of ctx.cwd.
  const { cloneDir, error: patchError } = applyPatchInTempClone(ctx.cwd, parsed.patch);

  if (patchError !== null) {
    logger.log('warn', 'critic.fix-proposal-patch-failed', {
      findingId: finding.id,
      error: patchError,
    });
    const proposal: FixProposal = {
      findingId: finding.id,
      proposalKind: 'llm-only',
      patch: parsed.patch,
      verifyStep: parsed.verifyStep,
      verified: false,
      reasoning: `patch apply failed: ${patchError}`,
      critic: buildCriticInfo(policy, meta, costUsd),
      version: '1.0',
    };
    cleanup(cloneDir);
    logger.log('info', 'critic.fix-proposal.success', {
      findingId: finding.id,
      verified: false,
    });
    return proposal;
  }

  // Run verify step.
  const verifyResult = runVerifyStep(cloneDir, parsed.verifyStep, verifyTimeoutMs);

  let verified: boolean;
  let reasoning = parsed.reasoning;

  if (verifyResult.timedOut) {
    verified = false;
    reasoning = `${parsed.reasoning} | verify timed out after ${verifyTimeoutMs}ms`;
    logger.log('warn', 'critic.fix-proposal-verify-timeout', {
      findingId: finding.id,
      timeoutMs: verifyTimeoutMs,
    });
  } else {
    // verifyStep semantics: exit non-zero IFF finding gone. So verified:true
    // when exitCode !== 0.
    verified = verifyResult.exitCode !== 0;
  }

  cleanup(cloneDir);

  const proposal: FixProposal = {
    findingId: finding.id,
    proposalKind: 'llm-only',
    patch: parsed.patch,
    verifyStep: parsed.verifyStep,
    verified,
    reasoning,
    critic: buildCriticInfo(policy, meta, costUsd),
    version: '1.0',
  };

  logger.log('info', 'critic.fix-proposal.success', {
    findingId: finding.id,
    verified,
  });

  return proposal;
}
