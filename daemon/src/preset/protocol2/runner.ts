/**
 * Protocol-2 Preset Framework — runner.
 *
 * Surface: docs/details/13-protocol-2-public-surface.md §"Entry points"
 * runPreset(manifest, ctx, opts) returns Finding[].
 *
 * Dispatches each rule by mechanism; isolates failures per rule; honors
 * per-rule timeoutMs; emits preset.run.* events.
 */

import { createTrackLogger, type TrackLogger } from '../../log/track-logger.js';
import {
  PresetError,
  PresetMissingCriticPolicyError,
} from './errors.js';
import { buildFindingId } from './finding-id.js';
import { runStaticGrep } from './mechanisms/static-grep.js';
import { runFileExists } from './mechanisms/file-exists.js';
import type {
  Finding,
  PresetManifest,
  PresetRule,
  Severity,
} from './types.js';

// STUB: real type from "core/protocol/cross-engine-reviewer/types" (Track P1 WIP)
// Per surface 14 §"Core types"
export type CriticPolicy = {
  worker: { kind: string; modelId: string; releaseDate: string };
  critic: { kind: string; modelId: string; releaseDate: string };
  criticEngine: unknown; // MinimalCriticEngineSurface — Track P1 owns the shape
  crossFamily: boolean;
  reason: 'cross-family-active' | 'no-critic-configured' | 'same-family-as-worker';
};

export interface RunContext {
  cwd: string;
  repoSha: string | null;
  fileFilter?: (path: string) => boolean;
}

export interface RunOptions {
  logger?: TrackLogger;
  criticPolicy?: CriticPolicy;
}

const DEFAULT_TIMEOUT_MS = 60_000;

function getRuleTimeoutMs(rule: PresetRule): number {
  const det = rule.detection as Record<string, unknown>;
  const v = det.timeoutMs;
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v;
  return DEFAULT_TIMEOUT_MS;
}

class TimeoutError extends Error {
  readonly isPresetTimeout = true;
  constructor(readonly timeoutMs: number) {
    super(`rule timed out after ${timeoutMs}ms`);
  }
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeoutP = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(ms)), ms);
    // Don't keep the event loop alive solely for the timeout
    if (typeof timer.unref === 'function') timer.unref();
  });
  try {
    return await Promise.race([p, timeoutP]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function syntheticTimeoutFinding(
  manifest: PresetManifest,
  rule: PresetRule,
): Finding {
  const evidence = 'rule timed out';
  const { id, matched_content_normalized } = buildFindingId({
    presetId: manifest.id,
    ruleId: rule.ruleId,
    file: '',
    line: 0,
    evidence,
  });
  return {
    id,
    presetId: manifest.id,
    ruleId: rule.ruleId,
    severity: 'P3' as Severity,
    file: '',
    line: 0,
    evidence,
    matched_content_normalized,
    message: 'rule timed out',
    remediationHint: null,
    fixAvailable: null,
    version: '1.0',
  };
}

async function dispatchRule(
  manifest: PresetManifest,
  rule: PresetRule,
  ctx: RunContext,
  opts: RunOptions,
): Promise<Finding[]> {
  switch (rule.mechanism) {
    case 'static-grep':
      return runStaticGrep(manifest, rule, ctx);
    case 'file-exists':
      return runFileExists(manifest, rule, ctx);
    case 'test-execution':
      throw new Error('mechanism "test-execution" not implemented in this build');
    case 'cross-file-cohesion':
      throw new Error('mechanism "cross-file-cohesion" not implemented in this build');
    case 'llm-judgment': {
      if (!opts.criticPolicy) {
        // Signaled with sentinel; runPreset converts to PRESET-E-7
        throw new MissingCriticPolicySentinel();
      }
      throw new Error('mechanism "llm-judgment" not implemented in this build');
    }
    default:
      throw new Error(`unknown mechanism: ${(rule as PresetRule).mechanism}`);
  }
}

class MissingCriticPolicySentinel extends Error {
  readonly isMissingCriticPolicy = true;
  constructor() {
    super('PRESET-E-7: criticPolicy missing for llm-judgment rule');
  }
}

export async function runPreset(
  manifest: PresetManifest,
  ctx: RunContext,
  opts: RunOptions = {},
): Promise<Finding[]> {
  const presetLogger =
    opts.logger && opts.logger.track !== 'preset'
      ? createTrackLogger('preset', { parentTrace: opts.logger.trace, silent: true })
      : opts.logger ??
        createTrackLogger('preset', {
          silent: process.env.ZEROU_LOG_NULL === '1',
        });

  const runStart = Date.now();
  presetLogger.log('info', 'preset.run.start', {
    presetId: manifest.id,
    rulesCount: manifest.rules.length,
  });

  const findings: Finding[] = [];
  let missingCriticForRule: PresetRule | null = null;

  for (const rule of manifest.rules) {
    presetLogger.log('debug', 'preset.run.rule.start', {
      presetId: manifest.id,
      ruleId: rule.ruleId,
      mechanism: rule.mechanism,
    });

    const ruleStart = Date.now();
    const timeoutMs = getRuleTimeoutMs(rule);

    try {
      const ruleFindings = await withTimeout(
        dispatchRule(manifest, rule, ctx, opts),
        timeoutMs,
      );

      // Emit per-finding events
      for (const f of ruleFindings) {
        findings.push(f);
        presetLogger.log('debug', 'preset.run.rule.finding', {
          presetId: manifest.id,
          ruleId: rule.ruleId,
          findingId: f.id,
          severity: f.severity,
          file: f.file,
          line: f.line,
        });
      }

      presetLogger.log('info', 'preset.run.rule.success', {
        presetId: manifest.id,
        ruleId: rule.ruleId,
        findingsCount: ruleFindings.length,
        durationMs: Date.now() - ruleStart,
      });
    } catch (err) {
      if (err instanceof MissingCriticPolicySentinel) {
        // Lazy dispatch: log failure for this rule, then abort the run with PRESET-E-7
        missingCriticForRule = rule;
        presetLogger.log('error', 'preset.run.failure', {
          presetId: manifest.id,
          ruleId: rule.ruleId,
          errorCode: 'PRESET-E-7',
        });
        break;
      } else if (err instanceof TimeoutError) {
        // Synthetic timeout finding (B-6-1)
        const synthetic = syntheticTimeoutFinding(manifest, rule);
        findings.push(synthetic);
        presetLogger.log('warn', 'preset.run.rule.timeout', {
          presetId: manifest.id,
          ruleId: rule.ruleId,
          timeoutMs,
        });
        // Per surface AU-4 resolution: synthetic finding ALSO emits finding event
        presetLogger.log('debug', 'preset.run.rule.finding', {
          presetId: manifest.id,
          ruleId: rule.ruleId,
          findingId: synthetic.id,
          severity: synthetic.severity,
          file: synthetic.file,
          line: synthetic.line,
        });
        // No success event for timed-out rules (timeout event substitutes for it).
      } else {
        const msg = (err as Error).message ?? String(err);
        presetLogger.log('error', 'preset.run.rule.failure', {
          presetId: manifest.id,
          ruleId: rule.ruleId,
          error: msg,
        });
        // Sibling rules continue.
      }
    }
  }

  if (missingCriticForRule) {
    throw new PresetMissingCriticPolicyError(
      `criticPolicy required for llm-judgment rule "${missingCriticForRule.ruleId}"`,
      findings.slice(),
    );
  }

  presetLogger.log('info', 'preset.run.success', {
    presetId: manifest.id,
    findingsCount: findings.length,
    durationMs: Date.now() - runStart,
  });

  return findings;
}

// Re-export so callers can `import { PresetError } from './runner.js'` if desired
export { PresetError, PresetMissingCriticPolicyError };
