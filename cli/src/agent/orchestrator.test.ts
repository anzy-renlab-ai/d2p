/**
 * Tests for agent/orchestrator.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runOrchestrator, HARDCODED_SUPABASE_RLS_PRESET } from './orchestrator.js';
import { createTrackLogger, captureLogsFor } from '../log-types.js';
import {
  __resetMetaLoggersForTests,
  __resetLiveLoggersForTests,
  __resetRotationGateForTests,
} from '../log-types.js';
import {
  HARDCODED_KEY_PRESET,
  type EngineConfig,
  type VerdictedFinding,
  type PresetManifest,
  type RunPresetOptions,
} from '../stubs.js';
import type { ChecklistItem, ProjectProfile } from './types.js';

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

const worker: EngineConfig = {
  kind: 'claude-cli',
  modelId: 'm',
  releaseDate: '2026-05-01',
};

describe('orchestrator.runOrchestrator', () => {
  it('runs end-to-end with fallback project detector + checklist builder', async () => {
    const logger = createTrackLogger('cli', { silent: true });

    // Mock runPreset so we don't actually scan files.
    const stubRun = async (m: PresetManifest, _ctx: RunPresetOptions): Promise<VerdictedFinding[]> => {
      if (m.id === 'no-hardcoded-llm-keys') {
        return [
          {
            id: `${m.id}.r.f.ts:1`,
            presetId: m.id,
            ruleId: 'stripe-live-key',
            severity: 'P1',
            file: 'f.ts',
            line: 1,
            evidence: 'sk_live_abc',
            message: 'mock',
            verdict: 'confirmed',
          },
        ];
      }
      return [];
    };

    const cap = await captureLogsFor(
      { track: 'agent', eventPattern: /^agent\./ },
      async () =>
        runOrchestrator({
          cwd: '/tmp',
          config: {
            worker,
            criticPool: [],
            failOn: 'none',
          },
          logger,
          applyMode: false,
          deps: {
            runPresetFn: stubRun as unknown as never,
          },
        }),
    );

    const result = cap.result;
    expect(result.profile.framework).toBe('unknown');
    expect(result.checklist.length).toBeGreaterThan(0);
    expect(result.iterationResult.findings.length).toBe(1);
    expect(result.evidenceBundle.findings.length).toBe(1);
    expect(result.evidenceBundle.summary.counts.confirmed).toBe(1);

    const events = cap.entries.map((e) => e.event);
    expect(events).toContain('agent.orchestrator.start');
    expect(events).toContain('agent.project-detection.start');
    expect(events).toContain('agent.project-detection.complete');
    expect(events).toContain('agent.checklist.start');
    expect(events).toContain('agent.checklist.complete');
    expect(events).toContain('agent.category.included');
    expect(events).toContain('agent.iteration.start');
    expect(events).toContain('agent.iteration.complete');
    expect(events).toContain('agent.orchestrator.complete');
  });

  it('honors injected detectProject and buildChecklist', async () => {
    const logger = createTrackLogger('cli', { silent: true });
    const profile: ProjectProfile = {
      framework: 'next.js',
      backend: 'supabase',
      language: ['typescript', 'sql'],
      hasGit: true,
      hasTests: true,
      hasEnvFile: true,
      packageMgr: 'pnpm',
      evidence: { 'package.json': 'detected' },
    };
    const checklist: ChecklistItem[] = [
      {
        category: 'secrets',
        priority: 'high',
        reasoning: 'always test',
        presetIds: ['no-hardcoded-llm-keys'],
      },
    ];

    const stubRun = async () => [] as VerdictedFinding[];
    const result = await runOrchestrator({
      cwd: '/tmp',
      config: { worker, criticPool: [], failOn: 'none' },
      logger,
      applyMode: false,
      deps: {
        detectProject: async () => profile,
        buildChecklist: async () => checklist,
        runPresetFn: stubRun as unknown as never,
      },
    });
    expect(result.profile.framework).toBe('next.js');
    expect(result.checklist).toEqual(checklist);
    expect(result.iterationResult.findings.length).toBe(0);
  });

  it('produces an evidence bundle with the expected schema', async () => {
    const logger = createTrackLogger('cli', { silent: true });
    const stubRun = async () => [] as VerdictedFinding[];
    const result = await runOrchestrator({
      cwd: '/tmp',
      config: { worker, criticPool: [], failOn: 'none' },
      logger,
      applyMode: false,
      deps: {
        runPresetFn: stubRun as unknown as never,
      },
      zerouVersion: '9.9.9',
    });
    expect(result.evidenceBundle.zerouVersion).toBe('9.9.9');
    expect(result.evidenceBundle.version).toBe('1.0');
    expect(result.evidenceBundle.audit.engineConfig.worker.kind).toBe('claude-cli');
    expect(result.evidenceBundle.summary.exitCode).toBe(0);
    expect(result.evidenceBundle.apply).toBeUndefined();
  });

  it('includes apply counters when applyMode=true', async () => {
    const logger = createTrackLogger('cli', { silent: true });
    const stubRun = async () => [] as VerdictedFinding[];
    const result = await runOrchestrator({
      cwd: '/tmp',
      config: { worker, criticPool: [], failOn: 'none' },
      logger,
      applyMode: true,
      deps: {
        runPresetFn: stubRun as unknown as never,
      },
    });
    expect(result.evidenceBundle.apply).toBeDefined();
    expect(result.evidenceBundle.apply!.requested).toBe(true);
  });

  it('exports HARDCODED_SUPABASE_RLS_PRESET as a builtin preset', () => {
    expect(HARDCODED_SUPABASE_RLS_PRESET.manifest.id).toBe('supabase-rls-missing');
    expect(HARDCODED_SUPABASE_RLS_PRESET.source).toBe('builtin');
    expect(HARDCODED_SUPABASE_RLS_PRESET.manifest.rules.length).toBeGreaterThan(0);
  });

  it('uses HARDCODED_KEY_PRESET + HARDCODED_SUPABASE_RLS_PRESET as defaults', async () => {
    const logger = createTrackLogger('cli', { silent: true });
    const stubRun = async () => [] as VerdictedFinding[];
    const result = await runOrchestrator({
      cwd: '/tmp',
      config: { worker, criticPool: [], failOn: 'none' },
      logger,
      applyMode: false,
      deps: {
        runPresetFn: stubRun as unknown as never,
      },
    });
    const presetIds = result.evidenceBundle.audit.presets.map((p) => p.id);
    expect(presetIds).toContain(HARDCODED_KEY_PRESET.manifest.id);
    expect(presetIds).toContain('supabase-rls-missing');
  });
});
