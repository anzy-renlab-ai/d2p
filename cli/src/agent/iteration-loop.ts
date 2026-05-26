/**
 * Iteration loop — main agent execution driver.
 *
 * Surface: docs/plans/2026-05-26-phase-4-agent-orchestrator.md
 *          §"agent/iteration-loop.ts".
 *
 * v1 SCOPE (single-pass):
 *   for each checklist item with priority != 'skip':
 *     strategy = chooseStrategy(item)
 *     if strategy.approach === 'skip-no-preset': log + continue
 *     for each preset in strategy.presetIds:
 *       findings = runPreset(...)   ← Track P2 / stubs.defaultRunPreset
 *       if applyMode:
 *         for each finding (verdict='confirmed'):
 *           fix = chooseFixStrategy(finding)
 *           apply via runApplyPhase (existing apply.ts)
 *       other verdicts → skipped[]
 *
 * Failure-retry / diagnose loop is Phase 4+1; v1 records failures in
 * skipped[] only.
 *
 * Emits (track='agent'):
 *   - agent.iteration.start
 *   - agent.iteration.item.start
 *   - agent.iteration.item.skipped
 *   - agent.iteration.item.no-preset
 *   - agent.iteration.item.complete
 *   - agent.iteration.complete
 */
import type { TrackLogger } from '../log-types.js';
import { createTrackLogger } from '../log-types.js';
import type {
  VerdictedFinding,
  LoadedPreset,
  EngineConfig,
  PresetDeps,
} from '../stubs.js';
import { defaultRunPreset } from '../stubs.js';
import type { ChecklistItem, ProjectProfile, AgentDecision } from './types.js';
import { chooseStrategy } from './detection-strategist.js';
import { chooseFixStrategy } from './fix-strategist.js';
import { runApplyPhase } from '../apply.js';

export interface IterationOptions {
  checklist: ChecklistItem[];
  profile: ProjectProfile;
  cwd: string;
  presets: LoadedPreset[];
  logger: TrackLogger;
  criticPolicy: {
    crossFamily: boolean;
    reason?: string;
    workerFamily: string;
    criticConfig: EngineConfig | null;
    criticApiKey?: string | null;
  };
  worker: EngineConfig;
  applyMode: boolean;
  logRoot?: string;
  /** Test affordance — override the underlying runPreset. */
  runPresetFn?: typeof defaultRunPreset;
  /** Test affordance — fix-application deps (proposeFix mostly). */
  deps?: Partial<PresetDeps>;
  /** Shared bookkeeping set for file reads. */
  readFiles?: Set<string>;
}

export interface AppliedRecord {
  findingId: string;
  method: 'template' | 'llm';
  verified: boolean;
}

export interface SkippedRecord {
  findingId: string;
  reason: string;
}

export interface IterationResult {
  decisions: AgentDecision[];
  findings: VerdictedFinding[];
  applied: AppliedRecord[];
  skipped: SkippedRecord[];
  iterations: number;
}

export async function runIterationLoop(
  opts: IterationOptions,
): Promise<IterationResult> {
  const {
    checklist,
    presets,
    logger,
    applyMode,
    cwd,
    criticPolicy,
    worker,
    logRoot,
  } = opts;

  const runPresetFn = opts.runPresetFn ?? defaultRunPreset;
  const readFiles = opts.readFiles ?? new Set<string>();
  const deps = opts.deps ?? {};

  const decisions: AgentDecision[] = [];
  const findings: VerdictedFinding[] = [];
  const applied: AppliedRecord[] = [];
  const skipped: SkippedRecord[] = [];

  logger.log('info', 'agent.iteration.start', {
    totalItems: checklist.length,
    applyMode,
  });

  for (const item of checklist) {
    if (item.priority === 'skip') {
      logger.log('info', 'agent.iteration.item.skipped', {
        category: item.category,
        reason: item.reasoning,
      });
      decisions.push({
        ts: Date.now(),
        step: 'iteration.item',
        decision: 'skip-priority',
        reasoning: item.reasoning,
        evidence: { category: item.category },
      });
      continue;
    }

    logger.log('info', 'agent.iteration.item.start', {
      category: item.category,
      priority: item.priority,
    });

    // 1. Choose detection strategy
    const strategy = await chooseStrategy({
      item,
      profile: opts.profile,
      availablePresets: presets,
      logger,
      criticConfig: criticPolicy.criticConfig,
      criticApiKey: criticPolicy.criticApiKey ?? null,
    });
    decisions.push({
      ts: Date.now(),
      step: 'detection-strategy',
      decision: strategy.approach,
      reasoning: strategy.reasoning,
      evidence: { category: item.category, presetIds: strategy.presetIds },
    });

    if (strategy.approach === 'skip-no-preset') {
      logger.log('info', 'agent.iteration.item.no-preset', {
        category: item.category,
        reasoning: strategy.reasoning,
      });
      logger.log('info', 'agent.iteration.item.complete', {
        category: item.category,
        findingsCount: 0,
        appliedCount: 0,
        skippedCount: 0,
      });
      continue;
    }

    // 2. Run each strategy preset
    const itemFindings: VerdictedFinding[] = [];
    const itemApplied: AppliedRecord[] = [];
    const itemSkipped: SkippedRecord[] = [];

    for (const presetId of strategy.presetIds) {
      const preset = presets.find((p) => p.manifest.id === presetId);
      if (!preset) continue;

      // Build a preset-track logger inheriting trace + logRoot so events go
      // to .zerou/logs/preset/... like the legacy CLI path.
      const presetLogger = createTrackLogger('preset', {
        parentTrace: logger.trace,
        ...(logRoot ? { logRoot } : {}),
      });

      let rawFindings: VerdictedFinding[] = [];
      try {
        rawFindings = await runPresetFn(preset.manifest, {
          cwd,
          logger: presetLogger,
          criticPolicy,
          worker,
          readFiles,
          ...(logRoot ? { logRoot } : {}),
        });
      } catch (e) {
        logger.log('error', 'agent.iteration.preset-run-failed', {
          category: item.category,
          presetId,
          error: (e as Error).message?.slice(0, 200) ?? 'unknown',
        });
        await presetLogger.flush();
        continue;
      }
      await presetLogger.flush();

      itemFindings.push(...rawFindings);

      if (!applyMode) {
        // Non-apply: tally non-confirmed for visibility
        for (const f of rawFindings) {
          if (f.verdict !== 'confirmed') {
            itemSkipped.push({
              findingId: f.id,
              reason: `non-confirmed verdict: ${f.verdict}`,
            });
          }
        }
        continue;
      }

      // 3. Apply phase — per finding, choose strategy, then delegate to apply.ts
      const confirmedSubset = rawFindings.filter((f) => f.verdict === 'confirmed');
      const nonConfirmed = rawFindings.filter((f) => f.verdict !== 'confirmed');
      for (const nc of nonConfirmed) {
        itemSkipped.push({
          findingId: nc.id,
          reason: `non-confirmed verdict: ${nc.verdict}`,
        });
      }

      for (const finding of confirmedSubset) {
        // Choose strategy (for log + decision trail)
        let fixStrategy;
        try {
          fixStrategy = await chooseFixStrategy({
            finding,
            preset,
            cwd,
            logger,
            criticConfig: criticPolicy.criticConfig,
            criticApiKey: criticPolicy.criticApiKey ?? null,
          });
        } catch (e) {
          itemSkipped.push({
            findingId: finding.id,
            reason: `fix-strategy error: ${(e as Error).message?.slice(0, 200) ?? 'unknown'}`,
          });
          continue;
        }
        decisions.push({
          ts: Date.now(),
          step: 'fix-strategy',
          decision: fixStrategy.approach,
          reasoning: fixStrategy.reasoning,
          evidence: { findingId: finding.id },
        });

        if (fixStrategy.approach === 'manual-only') {
          itemSkipped.push({
            findingId: finding.id,
            reason: `manual-only: ${fixStrategy.reasoning}`,
          });
          continue;
        }

        // Delegate to existing runApplyPhase, scoped to JUST this finding,
        // so counters and event log match the legacy CLI path verbatim.
        const changedFiles = new Set<string>();
        const counters = await runApplyPhase(
          [finding],
          [preset],
          {
            cwd,
            logger,
            worker,
            deps,
            changedFiles,
          },
        );

        const applyMethod: 'template' | 'llm' =
          fixStrategy.approach === 'template' ? 'template' : 'llm';
        const verified =
          counters.templateApplied + counters.llmVerifiedApplied > 0;

        if (verified) {
          itemApplied.push({
            findingId: finding.id,
            method: applyMethod,
            verified: true,
          });
        } else {
          let reason = 'fix not applied';
          if (counters.skipNoProposal > 0) reason = 'skip-no-proposal';
          else if (counters.llmUnverifiedSkipped > 0) reason = 'skip-unverified';
          itemSkipped.push({
            findingId: finding.id,
            reason,
          });
        }
      }
    }

    findings.push(...itemFindings);
    applied.push(...itemApplied);
    skipped.push(...itemSkipped);

    logger.log('info', 'agent.iteration.item.complete', {
      category: item.category,
      findingsCount: itemFindings.length,
      appliedCount: itemApplied.length,
      skippedCount: itemSkipped.length,
    });
  }

  const result: IterationResult = {
    decisions,
    findings,
    applied,
    skipped,
    iterations: 1,
  };

  logger.log('info', 'agent.iteration.complete', {
    totalIterations: result.iterations,
    findingsCount: result.findings.length,
    appliedCount: result.applied.length,
    skippedCount: result.skipped.length,
  });

  return result;
}
