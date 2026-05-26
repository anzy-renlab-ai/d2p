/**
 * Detection strategist — picks HOW to detect each checklist category.
 *
 * Surface: docs/plans/2026-05-26-phase-4-agent-orchestrator.md
 *          §"agent/detection-strategist.ts".
 *
 * v1 SCOPE:
 *   - If `item.presetIds.length > 0` → 'use-preset'
 *   - Else → 'skip-no-preset'
 *   - 'preset-modified' and 'llm-judgment' are future scope (Phase 4+1).
 *
 * Emits (track='agent'):
 *   - agent.strategy.start          { category }
 *   - agent.strategy.preset-matched { category, presetId, reasoning }
 *   - agent.strategy.skip-no-preset { category, reasoning }
 *   - agent.strategy.complete       { category, approach, presetIds }
 */
import type { TrackLogger } from '../log-types.js';
import type { ChecklistItem, ProjectProfile } from './types.js';
import type { LoadedPreset, EngineConfig } from '../stubs.js';

export interface StrategyOptions {
  item: ChecklistItem;
  profile: ProjectProfile;
  availablePresets: LoadedPreset[];
  logger: TrackLogger;
  criticConfig: EngineConfig | null;
  criticApiKey: string | null;
}

export interface DetectionStrategy {
  approach: 'use-preset' | 'preset-modified' | 'llm-judgment' | 'skip-no-preset';
  presetIds: string[];
  promptOverride?: string;
  reasoning: string;
}

export async function chooseStrategy(
  opts: StrategyOptions,
): Promise<DetectionStrategy> {
  const { item, availablePresets, logger } = opts;

  logger.log('info', 'agent.strategy.start', {
    category: item.category,
    presetIdsRequested: item.presetIds,
  });

  // v1: only 'use-preset' or 'skip-no-preset'
  if (item.presetIds.length === 0) {
    const strat: DetectionStrategy = {
      approach: 'skip-no-preset',
      presetIds: [],
      reasoning: 'no preset coverage in v1',
    };
    logger.log('info', 'agent.strategy.skip-no-preset', {
      category: item.category,
      reasoning: strat.reasoning,
    });
    logger.log('info', 'agent.strategy.complete', {
      category: item.category,
      approach: strat.approach,
      presetIds: strat.presetIds,
    });
    return strat;
  }

  // Filter to presets that actually exist in availablePresets
  const availableIds = new Set(availablePresets.map((p) => p.manifest.id));
  const matchedIds = item.presetIds.filter((id) => availableIds.has(id));

  if (matchedIds.length === 0) {
    const strat: DetectionStrategy = {
      approach: 'skip-no-preset',
      presetIds: [],
      reasoning: `requested presets not loaded: ${item.presetIds.join(',')}`,
    };
    logger.log('info', 'agent.strategy.skip-no-preset', {
      category: item.category,
      reasoning: strat.reasoning,
    });
    logger.log('info', 'agent.strategy.complete', {
      category: item.category,
      approach: strat.approach,
      presetIds: strat.presetIds,
    });
    return strat;
  }

  const strat: DetectionStrategy = {
    approach: 'use-preset',
    presetIds: matchedIds,
    reasoning: `preset(s) matched for category ${item.category}`,
  };
  for (const id of matchedIds) {
    logger.log('info', 'agent.strategy.preset-matched', {
      category: item.category,
      presetId: id,
      reasoning: strat.reasoning,
    });
  }
  logger.log('info', 'agent.strategy.complete', {
    category: item.category,
    approach: strat.approach,
    presetIds: strat.presetIds,
  });
  return strat;
}
