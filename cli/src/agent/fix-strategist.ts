/**
 * Fix strategist — picks HOW to fix each confirmed finding.
 *
 * Surface: docs/plans/2026-05-26-phase-4-agent-orchestrator.md
 *          §"agent/fix-strategist.ts".
 *
 * v1 SCOPE:
 *   - finding.verdict === 'confirmed' + rule.fix.kind === 'template' → 'template'
 *   - finding.verdict === 'confirmed' + rule.fix.kind === 'llm-only' → 'llm-only'
 *   - finding.verdict === 'needs-context' → 'manual-only'
 *   - finding.verdict === 'false-positive' or 'critic-unavailable' → throws
 *     (loop should filter these out before calling).
 *   - No fix on rule → 'manual-only' (with reasoning).
 *
 * Emits (track='agent'):
 *   - agent.fix-strategy.start            { findingId }
 *   - agent.fix-strategy.template-chosen  { findingId, reasoning }
 *   - agent.fix-strategy.llm-chosen       { findingId, reasoning }
 *   - agent.fix-strategy.manual-required  { findingId, reasoning }
 */
import type { TrackLogger } from '../log-types.js';
import type { VerdictedFinding, LoadedPreset, EngineConfig } from '../stubs.js';

export interface FixStrategyOptions {
  finding: VerdictedFinding;
  preset: LoadedPreset;
  cwd: string;
  logger: TrackLogger;
  criticConfig: EngineConfig | null;
  criticApiKey: string | null;
}

export interface FixStrategy {
  approach: 'template' | 'llm-only' | 'manual-only';
  reasoning: string;
}

export async function chooseFixStrategy(
  opts: FixStrategyOptions,
): Promise<FixStrategy> {
  const { finding, preset, logger } = opts;

  if (finding.verdict === 'false-positive' || finding.verdict === 'critic-unavailable') {
    throw new Error(
      `chooseFixStrategy invoked on non-actionable finding ${finding.id} (verdict=${finding.verdict})`,
    );
  }

  logger.log('info', 'agent.fix-strategy.start', {
    findingId: finding.id,
    verdict: finding.verdict,
    presetId: finding.presetId,
    ruleId: finding.ruleId,
  });

  // needs-context → always manual-only in v1.
  if (finding.verdict === 'needs-context') {
    const strat: FixStrategy = {
      approach: 'manual-only',
      reasoning: 'verdict needs human context',
    };
    logger.log('info', 'agent.fix-strategy.manual-required', {
      findingId: finding.id,
      reasoning: strat.reasoning,
    });
    return strat;
  }

  // Find the rule on the preset.
  const rule = preset.manifest.rules.find((r) => r.id === finding.ruleId);
  if (!rule || !rule.fix) {
    const strat: FixStrategy = {
      approach: 'manual-only',
      reasoning: rule
        ? 'rule has no fix declared'
        : `rule ${finding.ruleId} not found in preset ${preset.manifest.id}`,
    };
    logger.log('info', 'agent.fix-strategy.manual-required', {
      findingId: finding.id,
      reasoning: strat.reasoning,
    });
    return strat;
  }

  if (rule.fix.kind === 'template') {
    const strat: FixStrategy = {
      approach: 'template',
      reasoning: 'preset has template fix',
    };
    logger.log('info', 'agent.fix-strategy.template-chosen', {
      findingId: finding.id,
      reasoning: strat.reasoning,
    });
    return strat;
  }

  if (rule.fix.kind === 'llm-only') {
    const strat: FixStrategy = {
      approach: 'llm-only',
      reasoning: 'preset specifies llm-only fix',
    };
    logger.log('info', 'agent.fix-strategy.llm-chosen', {
      findingId: finding.id,
      reasoning: strat.reasoning,
    });
    return strat;
  }

  // Defensive — unknown fix.kind.
  const strat: FixStrategy = {
    approach: 'manual-only',
    reasoning: `unknown fix.kind: ${(rule.fix as { kind: string }).kind}`,
  };
  logger.log('info', 'agent.fix-strategy.manual-required', {
    findingId: finding.id,
    reasoning: strat.reasoning,
  });
  return strat;
}
