/**
 * Top-level agent orchestrator.
 *
 * Surface: docs/plans/2026-05-26-phase-4-agent-orchestrator.md
 *          §"agent/orchestrator.ts".
 *
 * Flow:
 *   detectProject() → buildChecklist() → runIterationLoop() → buildBundle()
 *
 * v1 SCOPE:
 *   - Track A's `detectProject` / `buildChecklist` not yet integrated. The
 *     orchestrator accepts injectable function references with defensible
 *     deterministic fallbacks so it can be exercised in tests independently.
 *   - Track D integration step swaps these for the real Track A implementations.
 *   - Preset list is whatever caller supplies; Track P2 listPresets() is also a
 *     Track D wiring step.
 */
import { createTrackLogger } from '../log-types.js';
import type { TrackLogger } from '../log-types.js';
import {
  defaultRunPreset,
  selectCriticPolicy,
  engineFamily,
  HARDCODED_KEY_PRESET,
  type EngineConfig,
  type LoadedPreset,
  type PresetDeps,
} from '../stubs.js';
import { buildBundle, type EvidenceBundle, type ApplyCounters } from '../evidence-bundle.js';
import {
  runIterationLoop,
  type IterationResult,
} from './iteration-loop.js';
import type { ChecklistItem, ProjectProfile } from './types.js';

/** Minimal config slice the orchestrator needs. Track D substitutes ResolvedConfig. */
export interface OrchestratorConfig {
  worker: EngineConfig;
  criticPool: EngineConfig[];
  /** API key resolved via Q8 precedence by the caller. */
  criticApiKey?: string | null;
  failOn: 'p1' | 'p2' | 'p3' | 'none';
}

export interface OrchestratorDeps extends Partial<PresetDeps> {
  /** Track A — project detection. Defaults to a deterministic fallback. */
  detectProject?: (args: {
    cwd: string;
    logger: TrackLogger;
    criticConfig: EngineConfig | null;
    criticApiKey: string | null;
  }) => Promise<ProjectProfile>;
  /** Track A — checklist builder. Defaults to a deterministic fallback. */
  buildChecklist?: (args: {
    profile: ProjectProfile;
    availablePresets: LoadedPreset[];
    logger: TrackLogger;
    criticConfig: EngineConfig | null;
    criticApiKey: string | null;
  }) => Promise<ChecklistItem[]>;
  /** Optional override for the underlying runPreset. */
  runPresetFn?: typeof defaultRunPreset;
}

export interface OrchestratorOptions {
  cwd: string;
  config: OrchestratorConfig;
  logger: TrackLogger;
  applyMode: boolean;
  logRoot?: string;
  /** Optional list of presets. Defaults to HARDCODED_KEY_PRESET + supabase-rls stub. */
  presets?: LoadedPreset[];
  zerouVersion?: string;
  repoSha?: string | null;
  deps?: OrchestratorDeps;
}

export interface OrchestratorResult {
  profile: ProjectProfile;
  checklist: ChecklistItem[];
  iterationResult: IterationResult;
  evidenceBundle: EvidenceBundle;
}

/**
 * Bare-minimum Supabase RLS preset compiled into the CLI so dogfood works
 * before Track P2 ships a real one. Tiny on purpose: 1 rule, llm-only fix.
 */
export const HARDCODED_SUPABASE_RLS_PRESET: LoadedPreset = {
  manifest: {
    id: 'supabase-rls-missing',
    version: 1,
    appliesTo: ['saas-web'],
    rules: [
      {
        id: 'public-table-no-rls',
        severity: 'P1',
        mechanism: 'static-grep',
        // Heuristic: CREATE TABLE without an ENABLE ROW LEVEL SECURITY nearby.
        // The static-grep cannot model 'without'; we match CREATE TABLE and
        // let the critic decide whether RLS is missing (cross-engine review).
        pattern: 'CREATE TABLE\\s+\\w+',
        filePattern: '**/*.{sql,ts,js}',
        message: 'Supabase public table — verify Row Level Security is enabled',
        fix: {
          kind: 'llm-only',
        },
      },
    ],
    body:
      'Supabase public tables without RLS are world-readable. Enable RLS and add policies for every table exposed via the auto-generated REST API.',
  },
  source: 'builtin',
  resolvedPath: '<built-in>',
  shadowedBy: [],
};

/** Default project detector — deterministic, no LLM. */
async function fallbackDetectProject(args: {
  cwd: string;
  logger: TrackLogger;
}): Promise<ProjectProfile> {
  args.logger.log('info', 'agent.project-detection.start', { cwd: args.cwd });
  args.logger.log('info', 'agent.project-detection.heuristic-fallback', {
    reason: 'Track A detectProject not injected; using deterministic fallback',
  });
  const profile: ProjectProfile = {
    framework: 'unknown',
    backend: null,
    language: [],
    hasGit: false,
    hasTests: false,
    hasEnvFile: false,
    packageMgr: null,
    evidence: { source: 'fallback' },
  };
  args.logger.log('info', 'agent.project-detection.complete', { profile });
  return profile;
}

/** Default checklist builder — picks `secrets` + `db` categories. */
async function fallbackBuildChecklist(args: {
  profile: ProjectProfile;
  availablePresets: LoadedPreset[];
  logger: TrackLogger;
}): Promise<ChecklistItem[]> {
  args.logger.log('info', 'agent.checklist.start', {
    framework: args.profile.framework,
    backend: args.profile.backend,
  });

  const items: ChecklistItem[] = [];
  // Default high-signal items: secrets always; supabase-rls if preset available.
  const secretsPreset = args.availablePresets.find(
    (p) => p.manifest.id === 'no-hardcoded-llm-keys',
  );
  if (secretsPreset) {
    const item: ChecklistItem = {
      category: 'secrets',
      priority: 'high',
      reasoning: 'every project ships with hardcoded-secret risk',
      presetIds: [secretsPreset.manifest.id],
    };
    items.push(item);
    args.logger.log('info', 'agent.category.included', {
      category: item.category,
      priority: item.priority,
      reasoning: item.reasoning,
    });
  }

  const rlsPreset = args.availablePresets.find(
    (p) => p.manifest.id === 'supabase-rls-missing',
  );
  if (rlsPreset) {
    const item: ChecklistItem = {
      category: 'db',
      priority: 'medium',
      reasoning: 'supabase-rls-missing preset is available',
      presetIds: [rlsPreset.manifest.id],
    };
    items.push(item);
    args.logger.log('info', 'agent.category.included', {
      category: item.category,
      priority: item.priority,
      reasoning: item.reasoning,
    });
  }

  args.logger.log('info', 'agent.checklist.complete', {
    includedCount: items.length,
    skippedCount: 0,
  });
  return items;
}

export async function runOrchestrator(
  opts: OrchestratorOptions,
): Promise<OrchestratorResult> {
  const startedAt = new Date();
  const { cwd, config, logger, applyMode, logRoot } = opts;
  const zerouVersion = opts.zerouVersion ?? '0.1.0';
  const deps = opts.deps ?? {};

  // Build agent track logger inheriting trace from caller's cli logger.
  const agentLogger = createTrackLogger('agent', {
    parentTrace: logger.trace,
    ...(logRoot ? { logRoot } : {}),
  });

  agentLogger.log('info', 'agent.orchestrator.start', {
    cwd,
    applyMode,
    worker: { kind: config.worker.kind, modelId: config.worker.modelId },
  });

  // Critic policy
  const policy = selectCriticPolicy(config.worker, config.criticPool);
  if (config.criticApiKey && policy.criticConfig) {
    policy.criticApiKey = config.criticApiKey;
  }

  // Presets — default to the two hardcoded ones for v1.
  const presets = opts.presets ?? [
    HARDCODED_KEY_PRESET,
    HARDCODED_SUPABASE_RLS_PRESET,
  ];

  // 1. Detect project
  const detectFn = deps.detectProject ?? fallbackDetectProject;
  const profile = await detectFn({
    cwd,
    logger: agentLogger,
    criticConfig: policy.criticConfig,
    criticApiKey: policy.criticApiKey ?? null,
  });

  // 2. Build checklist
  const buildFn = deps.buildChecklist ?? fallbackBuildChecklist;
  const checklist = await buildFn({
    profile,
    availablePresets: presets,
    logger: agentLogger,
    criticConfig: policy.criticConfig,
    criticApiKey: policy.criticApiKey ?? null,
  });

  // 3. Iteration loop
  const readFiles = new Set<string>();
  const iterationResult = await runIterationLoop({
    checklist,
    profile,
    cwd,
    presets,
    logger: agentLogger,
    criticPolicy: policy,
    worker: config.worker,
    applyMode,
    ...(logRoot ? { logRoot } : {}),
    ...(deps.runPresetFn ? { runPresetFn: deps.runPresetFn } : {}),
    deps,
    readFiles,
  });

  // 4. Build evidence bundle
  // Aggregate apply counters from iteration result (loop hands us per-finding
  // applied[]/skipped[] records; we tally to ApplyCounters shape).
  const applyCounters: ApplyCounters | null = applyMode
    ? {
        requested: true,
        templateApplied: iterationResult.applied.filter((a) => a.method === 'template')
          .length,
        llmVerifiedApplied: iterationResult.applied.filter((a) => a.method === 'llm')
          .length,
        llmUnverifiedSkipped: iterationResult.skipped.filter((s) =>
          s.reason.includes('skip-unverified'),
        ).length,
        skipNoProposal: iterationResult.skipped.filter((s) =>
          s.reason.includes('skip-no-proposal'),
        ).length,
      }
    : null;

  const endedAt = new Date();
  const exitCode = computeExitCode(iterationResult.findings, config.failOn);
  const bundle = buildBundle({
    startedAt,
    endedAt,
    cwd,
    repoSha: opts.repoSha ?? null,
    presets,
    worker: config.worker,
    critic: policy.criticConfig,
    findings: iterationResult.findings,
    readFiles,
    failOnThreshold: config.failOn,
    exitCode,
    apply: applyCounters,
    trace: logger.trace,
    zerouVersion,
  });

  agentLogger.log('info', 'agent.orchestrator.complete', {
    findingsCount: iterationResult.findings.length,
    appliedCount: iterationResult.applied.length,
    skippedCount: iterationResult.skipped.length,
    iterations: iterationResult.iterations,
    criticFamily: policy.criticConfig ? engineFamily(policy.criticConfig) : null,
  });
  await agentLogger.flush();

  return {
    profile,
    checklist,
    iterationResult,
    evidenceBundle: bundle,
  };
}

function computeExitCode(
  findings: { severity: 'P1' | 'P2' | 'P3'; verdict: string }[],
  failOn: 'p1' | 'p2' | 'p3' | 'none',
): number {
  if (failOn === 'none') return 0;
  const threshold = severityRank(failOn);
  for (const f of findings) {
    if (f.verdict !== 'confirmed') continue;
    if (severityRank(f.severity.toLowerCase() as 'p1' | 'p2' | 'p3') <= threshold) {
      return 2;
    }
  }
  return 0;
}

function severityRank(s: 'p1' | 'p2' | 'p3'): number {
  if (s === 'p1') return 1;
  if (s === 'p2') return 2;
  if (s === 'p3') return 3;
  return 99;
}
