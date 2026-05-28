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
 * Preset-id → AuditCategory mapping. Used to classify each loaded preset into
 * one of the 12 canonical audit categories for checklist output. Presets with
 * IDs not present here default to `'secrets'` for legacy preset families
 * matching that pattern, otherwise are bucketed into the closest category
 * inferred from the id.
 *
 * Phase 16: expanded so every rule-bearing preset (after Workers B/C/D) gets
 * a category. The categorisation is informational — actual *inclusion* decision
 * is `appliesTo` + ProjectProfile based via `presetAppliesToProfile`.
 */
const PRESET_TO_CATEGORY: Record<string, AuditCategory> = {
  'secrets-leak': 'secrets',
  'no-hardcoded-llm-keys': 'secrets',
  'supabase-rls': 'db',
  'supabase-rls-missing': 'db',
  'db-injection': 'db',
  'auth-weakness': 'auth',
  'authz-bola': 'authz',
  'security-cors-csp': 'security',
  'xss-injection': 'security',
  'ssrf-path-traversal': 'security',
  'command-injection': 'security',
  'crypto-misuse': 'security',
  'observability-missing': 'observability',
  'error-handling': 'error-handling',
  'async-pitfalls': 'error-handling',
  'type-safety-holes': 'error-handling',
  'tests-missing': 'tests',
  'perf-issues': 'perf',
  'llm-cost-uncapped': 'llm-cost',
  'gdpr-compliance': 'gdpr',
  'deploy-incident': 'deploy-incident',
};

/** Best-effort inference for a preset id we don't know about. */
function inferCategory(presetId: string): AuditCategory {
  const id = presetId.toLowerCase();
  if (id.includes('secret') || id.includes('key')) return 'secrets';
  if (id.includes('auth') && !id.includes('authz')) return 'auth';
  if (id.includes('authz') || id.includes('bola') || id.includes('idor')) return 'authz';
  if (id.includes('sql') || id.includes('db') || id.includes('supabase')) return 'db';
  if (id.includes('cors') || id.includes('xss') || id.includes('ssrf') || id.includes('crypto') || id.includes('inject')) return 'security';
  if (id.includes('observ') || id.includes('log') || id.includes('monitor')) return 'observability';
  if (id.includes('error') || id.includes('async') || id.includes('type')) return 'error-handling';
  if (id.includes('test')) return 'tests';
  if (id.includes('perf')) return 'perf';
  if (id.includes('llm') || id.includes('cost')) return 'llm-cost';
  if (id.includes('gdpr') || id.includes('privacy')) return 'gdpr';
  if (id.includes('deploy') || id.includes('incident')) return 'deploy-incident';
  return 'security';
}

function categoryForPreset(presetId: string): AuditCategory {
  return PRESET_TO_CATEGORY[presetId] ?? inferCategory(presetId);
}

function categoryToPresetIds(
  category: AuditCategory,
  available: LoadedPreset[],
): string[] {
  const ids: string[] = [];
  for (const p of available) {
    if (categoryForPreset(p.manifest.id) === category) ids.push(p.manifest.id);
  }
  return ids;
}

/**
 * Decides whether a preset applies to the given project profile.
 *
 * - Empty `appliesTo` array → "applies to all" — always true.
 * - Non-empty array → at least one entry must match the profile via
 *   `profileMatches`.
 * - If the profile is fully unknown (no framework signal AND no backend AND
 *   no language detected), be permissive: we don't know enough to filter, so
 *   dispatch all presets rather than dropping every one. This keeps the
 *   useful-by-default behavior intact for the fallback detector and for repos
 *   we couldn't classify (audit value > false-negative risk).
 */
export function presetAppliesToProfile(
  preset: LoadedPreset,
  profile: ProjectProfile,
): boolean {
  const targets = preset.manifest.appliesTo ?? [];
  if (targets.length === 0) return true;
  if (isProfileFullyUnknown(profile)) return true;
  return targets.some((t) => profileMatches(profile, t));
}

function isProfileFullyUnknown(profile: ProjectProfile): boolean {
  const fw = (profile.framework ?? '').toLowerCase();
  const langs = (profile.language ?? []).map((l) => l.toLowerCase());
  return (
    (fw === 'unknown' || fw === '') &&
    !profile.backend &&
    (langs.length === 0 || (langs.length === 1 && langs[0] === 'unknown'))
  );
}

/**
 * Maps a ProjectProfile to one of the project-type buckets used in `appliesTo`
 * arrays: 'saas-web' | 'api-service' | 'cli-tool' | 'library' | 'static-site' |
 * 'unknown'.
 *
 * Heuristics:
 *   - next.js / vite / nuxt + a backend → saas-web (browser + server present)
 *   - express / fastify / koa / nest / hono → api-service
 *   - has bin field (we approximate via framework='cli'-ish) → cli-tool
 *   - library = none of the above + no backend
 *   - static-site = vite/eleventy/astro without backend
 */
export function profileMatches(profile: ProjectProfile, target: string): boolean {
  const fw = (profile.framework ?? '').toLowerCase();
  const backend = (profile.backend ?? '').toLowerCase();
  const hasBackend =
    backend.length > 0 ||
    fw === 'express' ||
    fw === 'fastify' ||
    fw === 'koa' ||
    fw === 'nest' ||
    fw === 'hono';

  switch (target) {
    case 'saas-web':
      // Browser-rendering framework + some kind of server / backend.
      if (fw === 'next.js' || fw === 'nuxt' || fw === 'remix' || fw === 'sveltekit') return true;
      if ((fw === 'vite' || fw === 'astro') && hasBackend) return true;
      return false;
    case 'api-service':
      if (fw === 'express' || fw === 'fastify' || fw === 'koa' || fw === 'nest' || fw === 'hono') return true;
      // Next.js with API routes also acts as an API service.
      if (fw === 'next.js') return true;
      if (backend === 'custom-express' || backend === 'supabase' || backend === 'firebase') return true;
      return false;
    case 'cli-tool':
      // Heuristic: framework is "cli" or evidence flags a bin entry. We don't
      // (yet) probe package.json.bin in detectProject, so this is best-effort.
      if (fw === 'cli' || fw === 'cli-tool') return true;
      if (profile.evidence && 'bin' in profile.evidence) return true;
      return false;
    case 'library':
      // No framework, no backend, no app endpoints — likely a library / SDK.
      if (fw === 'unknown' && !hasBackend) return true;
      return false;
    case 'static-site':
      if ((fw === 'vite' || fw === 'astro' || fw === 'eleventy' || fw === 'hugo' || fw === 'jekyll') && !hasBackend) return true;
      return false;
    case 'unknown':
      return fw === 'unknown';
    default:
      // Unknown target string — be permissive (don't accidentally drop a preset).
      return true;
  }
}

// ── Deterministic fallback ─────────────────────────────────────────────────

/**
 * Build a deterministic checklist by including every loaded preset whose
 * `appliesTo` array either matches the project profile or is empty
 * ("applies to all"). Each preset gets bucketed into one of the 12 canonical
 * categories for reporting purposes via `categoryForPreset`.
 *
 * Phase 16 change: previously this only mapped 3 preset IDs to categories,
 * causing 16 of the 19 on-disk presets to be dropped before dispatch. Now we
 * include every preset whose appliesTo matches.
 */
function deterministicChecklist(
  profile: ProjectProfile,
  availablePresets: LoadedPreset[],
): ChecklistItem[] {
  // Step 1: bucket presets into categories based on appliesTo + profile match.
  const byCategory = new Map<AuditCategory, string[]>();
  for (const p of availablePresets) {
    if (!presetAppliesToProfile(p, profile)) continue;
    const cat = categoryForPreset(p.manifest.id);
    const existing = byCategory.get(cat) ?? [];
    existing.push(p.manifest.id);
    byCategory.set(cat, existing);
  }

  // Step 2: emit one ChecklistItem per canonical category. Categories with at
  // least one included preset are dispatched; others are skipped.
  const items: ChecklistItem[] = [];
  for (const category of ALL_AUDIT_CATEGORIES) {
    const presetIds = byCategory.get(category) ?? [];
    if (presetIds.length === 0) {
      // Was a category that previously had presets but they were filtered out?
      const allForCategory = categoryToPresetIds(category, availablePresets);
      if (allForCategory.length === 0) {
        items.push({
          category,
          priority: 'skip',
          reasoning: 'no-preset-coverage',
          presetIds: [],
        });
      } else {
        items.push({
          category,
          priority: 'skip',
          reasoning: `presets ${allForCategory.join(',')} appliesTo did not match profile (framework=${profile.framework}, backend=${profile.backend ?? 'none'})`,
          presetIds: [],
        });
      }
      continue;
    }
    items.push({
      category,
      priority: 'medium',
      reasoning: `${presetIds.join(',')} preset(s) cover ${category} for this project`,
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
