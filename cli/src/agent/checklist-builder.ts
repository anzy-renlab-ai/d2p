/**
 * Checklist Builder (Phase 4 / Track A).
 *
 * Given a ProjectProfile + the set of available presets, decides which
 * audit categories should be tested, at what priority, and which preset(s)
 * cover each category.
 *
 * v1 mapping is intentionally narrow — we only have two preset families
 * (secrets-leak → 'secrets', supabase-rls → 'db'). Other categories are
 * recorded as 'skip' with reason 'no-preset-coverage-v1' so future expansion
 * is easy.
 *
 * Every decision branch emits a log event under `agent.checklist.*`
 * (event taxonomy per `docs/plans/2026-05-26-phase-4-agent-orchestrator.md`).
 */

import type { TrackLogger } from '../log-types.js';
import type { EngineConfig, LoadedPreset } from '../stubs.js';
import {
  ALL_AUDIT_CATEGORIES,
  type AuditCategory,
  type ChecklistItem,
  type ProjectProfile,
} from './types.js';
import { defaultLlmInfer, type LlmInferFn } from './project-detector.js';

export interface ChecklistOptions {
  profile: ProjectProfile;
  availablePresets: LoadedPreset[];
  logger: TrackLogger;
  criticConfig: EngineConfig | null;
  criticApiKey: string | null;
  /** Test seam: inject LLM call. Falls back to the project-detector default. */
  llmCall?: LlmInferFn;
  timeoutMs?: number;
}

/**
 * v1 preset-id → AuditCategory mapping. Hard-coded; expand when new
 * presets ship. Any category not present here has no preset coverage.
 */
const PRESET_TO_CATEGORY: Record<string, AuditCategory> = {
  'secrets-leak': 'secrets',
  'no-hardcoded-llm-keys': 'secrets',
  'supabase-rls': 'db',
};

function categoryToPresetIds(
  category: AuditCategory,
  available: LoadedPreset[],
): string[] {
  const ids: string[] = [];
  for (const p of available) {
    const mapped = PRESET_TO_CATEGORY[p.manifest.id];
    if (mapped === category) ids.push(p.manifest.id);
  }
  return ids;
}

// ── Deterministic fallback ─────────────────────────────────────────────────

function deterministicChecklist(
  profile: ProjectProfile,
  availablePresets: LoadedPreset[],
): ChecklistItem[] {
  const items: ChecklistItem[] = [];
  for (const category of ALL_AUDIT_CATEGORIES) {
    const presetIds = categoryToPresetIds(category, availablePresets);
    if (presetIds.length === 0) {
      items.push({
        category,
        priority: 'skip',
        reasoning: 'no-preset-coverage-v1',
        presetIds: [],
      });
      continue;
    }
    // Special-case the 'db' category: only include if backend looks DB-shaped.
    if (category === 'db') {
      if (profile.backend === 'supabase' || profile.backend === 'firebase') {
        items.push({
          category,
          priority: 'high',
          reasoning: `backend=${profile.backend}; ${presetIds.join(',')} preset applies`,
          presetIds,
        });
      } else {
        items.push({
          category,
          priority: 'skip',
          reasoning: `backend=${profile.backend ?? 'none'}; no DB preset applicable`,
          presetIds: [],
        });
      }
      continue;
    }
    // Otherwise include with medium priority.
    items.push({
      category,
      priority: 'medium',
      reasoning: `${presetIds.join(',')} preset covers ${category} for this project`,
      presetIds,
    });
  }
  return items;
}

// ── LLM path ───────────────────────────────────────────────────────────────

const CHECKLIST_SYSTEM_PROMPT =
  'You decide which of 12 audit categories should be tested for the given project. Output JSON ONLY (no markdown fence, no preamble) matching the schema exactly.';

function buildChecklistPrompt(
  profile: ProjectProfile,
  availablePresets: LoadedPreset[],
): string {
  const presets = availablePresets.map((p) => ({
    id: p.manifest.id,
    name: p.manifest.id,
    appliesTo: p.manifest.appliesTo ?? [],
    ruleCount: p.manifest.rules?.length ?? 0,
  }));
  return [
    'Project profile:',
    JSON.stringify(profile, null, 2),
    '',
    'Available presets (each preset maps to one of the 12 audit categories):',
    JSON.stringify(presets, null, 2),
    '',
    `Available categories (12): ${ALL_AUDIT_CATEGORIES.join(', ')}`,
    '',
    'For EACH of the 12 categories, decide:',
    '- priority: "high" | "medium" | "low" | "skip"',
    '- reasoning: short string (≤200 chars)',
    '- presetIds: which preset id(s) cover this category (or [])',
    '',
    'Return strict JSON: an array of 12 objects (one per category).',
    'Schema:',
    '[',
    '  {"category": "secrets", "priority": "high"|"medium"|"low"|"skip", "reasoning": "...", "presetIds": ["..."]},',
    '  ...',
    ']',
  ].join('\n');
}

function isLlmItem(x: unknown): x is {
  category: string;
  priority: string;
  reasoning?: unknown;
  presetIds?: unknown;
} {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  return typeof o.category === 'string' && typeof o.priority === 'string';
}

function validateLlmChecklist(
  parsed: unknown,
  availablePresets: LoadedPreset[],
): ChecklistItem[] | null {
  if (!Array.isArray(parsed)) return null;
  const validCategories = new Set<string>(ALL_AUDIT_CATEGORIES);
  const validPriority = new Set(['high', 'medium', 'low', 'skip']);
  const validPresetIds = new Set(availablePresets.map((p) => p.manifest.id));
  const items: ChecklistItem[] = [];
  for (const raw of parsed) {
    if (!isLlmItem(raw)) continue;
    if (!validCategories.has(raw.category) || !validPriority.has(raw.priority)) continue;
    const reasoning = typeof raw.reasoning === 'string' ? raw.reasoning.slice(0, 400) : '';
    const presetIds = Array.isArray(raw.presetIds)
      ? raw.presetIds.filter(
          (id): id is string => typeof id === 'string' && validPresetIds.has(id),
        )
      : [];
    items.push({
      category: raw.category as AuditCategory,
      priority: raw.priority as ChecklistItem['priority'],
      reasoning,
      presetIds,
    });
  }
  if (items.length === 0) return null;
  // Backfill any missing categories as skip / no-preset.
  const seen = new Set(items.map((i) => i.category));
  for (const cat of ALL_AUDIT_CATEGORIES) {
    if (!seen.has(cat)) {
      items.push({
        category: cat,
        priority: 'skip',
        reasoning: 'llm-did-not-list-this-category',
        presetIds: [],
      });
    }
  }
  return items;
}

// ── Public entry point ─────────────────────────────────────────────────────

/**
 * Builds a checklist of audit categories with priority + preset mapping.
 *
 * Emits:
 * - agent.checklist.start
 * - agent.checklist.llm-call.start (if LLM available)
 * - agent.checklist.llm-call.success/failure
 * - agent.checklist.heuristic-fallback (if no LLM or LLM failed)
 * - agent.checklist.category.included
 * - agent.checklist.category.skipped
 * - agent.checklist.complete
 */
export async function buildChecklist(opts: ChecklistOptions): Promise<ChecklistItem[]> {
  const { profile, availablePresets, logger } = opts;
  const log = logger.child('checklist');

  log.log('info', 'agent.checklist.start', {
    framework: profile.framework,
    backend: profile.backend,
    presetCount: availablePresets.length,
  });

  let items: ChecklistItem[] | null = null;

  // Decision 1: do we have a critic key + config?
  if (opts.criticConfig && opts.criticApiKey) {
    log.log('info', 'agent.checklist.llm-call.start', {
      decision: 'use-llm',
      reasoning: 'critic config + api key both present',
      modelId: opts.criticConfig.modelId,
    });
    const llmFn = opts.llmCall ?? defaultLlmInfer;
    try {
      const llmResult = await llmFn({
        cfg: opts.criticConfig,
        apiKey: opts.criticApiKey,
        systemPrompt: CHECKLIST_SYSTEM_PROMPT,
        userPrompt: buildChecklistPrompt(profile, availablePresets),
        timeoutMs: opts.timeoutMs ?? 30_000,
      });
      if (llmResult.ok) {
        // The LLM result was parsed into an object/array — re-validate vs schema.
        // defaultLlmInfer returns `parsed` typed as Partial<ProjectProfile> but
        // it's actually whatever JSON came back; we re-shape via Array path.
        const reparsed = (llmResult as { parsed: unknown }).parsed;
        const validated = validateLlmChecklist(reparsed, availablePresets);
        if (validated) {
          items = validated;
          log.log('info', 'agent.checklist.llm-call.success', {
            decision: 'llm-result-accepted',
            included: validated.filter((i) => i.priority !== 'skip').length,
            skipped: validated.filter((i) => i.priority === 'skip').length,
          });
        } else {
          log.log('warn', 'agent.checklist.llm-call.failure', {
            decision: 'fall-back-to-heuristic',
            reasoning: 'llm output failed schema validation',
          });
        }
      } else {
        log.log('warn', 'agent.checklist.llm-call.failure', {
          decision: 'fall-back-to-heuristic',
          reasoning: llmResult.error,
        });
      }
    } catch (e) {
      log.log('warn', 'agent.checklist.llm-call.failure', {
        decision: 'fall-back-to-heuristic',
        reasoning: (e as Error).message ?? String(e),
      });
    }
  } else {
    log.log('info', 'agent.checklist.heuristic-fallback', {
      decision: 'use-heuristic',
      reasoning: opts.criticConfig
        ? 'critic config present but no api key'
        : 'no critic config configured',
    });
  }

  if (!items) {
    items = deterministicChecklist(profile, availablePresets);
  }

  // Emit per-category events
  let includedCount = 0;
  let skippedCount = 0;
  for (const item of items) {
    if (item.priority === 'skip') {
      skippedCount++;
      log.log('info', 'agent.checklist.category.skipped', {
        category: item.category,
        reasoning: item.reasoning,
      });
    } else {
      includedCount++;
      log.log('info', 'agent.checklist.category.included', {
        category: item.category,
        priority: item.priority,
        reasoning: item.reasoning,
        presetIds: item.presetIds,
      });
    }
  }

  log.log('info', 'agent.checklist.complete', {
    includedCount,
    skippedCount,
  });

  return items;
}
