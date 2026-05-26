/**
 * Tests for agent/iteration-loop.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runIterationLoop } from './iteration-loop.js';
import { createTrackLogger, captureLogsFor } from '../log-types.js';
import {
  __resetMetaLoggersForTests,
  __resetLiveLoggersForTests,
  __resetRotationGateForTests,
} from '../log-types.js';
import type {
  EngineConfig,
  LoadedPreset,
  VerdictedFinding,
  CriticPolicy,
  PresetManifest,
  RunPresetOptions,
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

const profile: ProjectProfile = {
  framework: 'unknown',
  backend: null,
  language: [],
  hasGit: false,
  hasTests: false,
  hasEnvFile: false,
  packageMgr: null,
  evidence: {},
};

const worker: EngineConfig = {
  kind: 'claude-cli',
  modelId: 'm',
  releaseDate: '2026-05-01',
};

const policy: CriticPolicy = {
  crossFamily: false,
  reason: 'test',
  workerFamily: 'anthropic',
  criticConfig: null,
};

function makePreset(id: string): LoadedPreset {
  return {
    manifest: {
      id,
      version: 1,
      rules: [
        {
          id: id + '.rule',
          severity: 'P1',
          mechanism: 'static-grep',
          pattern: 'X',
          fix: {
            kind: 'template',
            find: 'X',
            replace: 'Y',
            verifyCommand: 'true',
          },
        },
      ],
      body: '',
    },
    source: 'builtin',
    resolvedPath: '<test>',
    shadowedBy: [],
  };
}

function fakeFinding(presetId: string, verdict: VerdictedFinding['verdict'] = 'confirmed'): VerdictedFinding {
  return {
    id: `${presetId}.r.f.ts:1`,
    presetId,
    ruleId: `${presetId}.rule`,
    severity: 'P1',
    file: 'f.ts',
    line: 1,
    evidence: 'X',
    message: 'matched',
    verdict,
  };
}

describe('iteration-loop.runIterationLoop', () => {
  it('emits start/complete events on empty checklist', async () => {
    const logger = createTrackLogger('agent', { silent: true });
    const cap = await captureLogsFor(
      { track: 'agent', eventPattern: /^agent\.iteration\./ },
      async () =>
        runIterationLoop({
          checklist: [],
          profile,
          cwd: '/tmp',
          presets: [],
          logger,
          criticPolicy: policy,
          worker,
          applyMode: false,
        }),
    );
    expect(cap.result.iterations).toBe(1);
    expect(cap.result.findings).toEqual([]);
    expect(cap.result.applied).toEqual([]);
    expect(cap.result.skipped).toEqual([]);
    const events = cap.entries.map((e) => e.event);
    expect(events).toContain('agent.iteration.start');
    expect(events).toContain('agent.iteration.complete');
  });

  it('processes a checklist item and collects findings (no apply)', async () => {
    const logger = createTrackLogger('agent', { silent: true });
    const preset = makePreset('p1');
    const checklist: ChecklistItem[] = [
      {
        category: 'secrets',
        priority: 'high',
        reasoning: 'test',
        presetIds: ['p1'],
      },
    ];

    // Mock runPresetFn returning a confirmed finding
    const stubRun = async (_m: PresetManifest, _ctx: RunPresetOptions) => [
      fakeFinding('p1', 'confirmed'),
    ];

    const cap = await captureLogsFor(
      { track: 'agent', eventPattern: /^agent\./ },
      async () =>
        runIterationLoop({
          checklist,
          profile,
          cwd: '/tmp',
          presets: [preset],
          logger,
          criticPolicy: policy,
          worker,
          applyMode: false,
          runPresetFn: stubRun as unknown as never,
        }),
    );

    expect(cap.result.findings.length).toBe(1);
    expect(cap.result.applied.length).toBe(0); // no apply mode
    const events = cap.entries.map((e) => e.event);
    expect(events).toContain('agent.iteration.start');
    expect(events).toContain('agent.iteration.item.start');
    expect(events).toContain('agent.strategy.preset-matched');
    expect(events).toContain('agent.iteration.item.complete');
    expect(events).toContain('agent.iteration.complete');
  });

  it('skips item with priority=skip and emits item.skipped', async () => {
    const logger = createTrackLogger('agent', { silent: true });
    const checklist: ChecklistItem[] = [
      {
        category: 'tests',
        priority: 'skip',
        reasoning: 'not relevant for this project',
        presetIds: [],
      },
    ];
    const cap = await captureLogsFor(
      { track: 'agent', eventPattern: /^agent\.iteration\./ },
      async () =>
        runIterationLoop({
          checklist,
          profile,
          cwd: '/tmp',
          presets: [],
          logger,
          criticPolicy: policy,
          worker,
          applyMode: false,
        }),
    );
    const events = cap.entries.map((e) => e.event);
    expect(events).toContain('agent.iteration.item.skipped');
    expect(events).not.toContain('agent.iteration.item.start');
  });

  it('logs item.no-preset when strategy returns skip-no-preset', async () => {
    const logger = createTrackLogger('agent', { silent: true });
    const checklist: ChecklistItem[] = [
      {
        category: 'observability',
        priority: 'medium',
        reasoning: 'no preset',
        presetIds: [],
      },
    ];
    const cap = await captureLogsFor(
      { track: 'agent', eventPattern: /^agent\.iteration\./ },
      async () =>
        runIterationLoop({
          checklist,
          profile,
          cwd: '/tmp',
          presets: [],
          logger,
          criticPolicy: policy,
          worker,
          applyMode: false,
        }),
    );
    const events = cap.entries.map((e) => e.event);
    expect(events).toContain('agent.iteration.item.no-preset');
  });

  it('records non-confirmed findings to skipped[]', async () => {
    const logger = createTrackLogger('agent', { silent: true });
    const preset = makePreset('p1');
    const checklist: ChecklistItem[] = [
      {
        category: 'secrets',
        priority: 'high',
        reasoning: 'test',
        presetIds: ['p1'],
      },
    ];
    const stubRun = async () => [
      fakeFinding('p1', 'false-positive'),
      fakeFinding('p1', 'critic-unavailable'),
    ];
    const result = await runIterationLoop({
      checklist,
      profile,
      cwd: '/tmp',
      presets: [preset],
      logger,
      criticPolicy: policy,
      worker,
      applyMode: false,
      runPresetFn: stubRun as unknown as never,
    });
    expect(result.findings.length).toBe(2);
    expect(result.skipped.length).toBe(2);
    expect(result.skipped.every((s) => s.reason.startsWith('non-confirmed'))).toBe(
      true,
    );
  });

  it('handles runPresetFn throwing without crashing the loop', async () => {
    const logger = createTrackLogger('agent', { silent: true });
    const preset = makePreset('p1');
    const checklist: ChecklistItem[] = [
      {
        category: 'secrets',
        priority: 'high',
        reasoning: 'test',
        presetIds: ['p1'],
      },
    ];
    const stubRun = async () => {
      throw new Error('boom');
    };
    const result = await runIterationLoop({
      checklist,
      profile,
      cwd: '/tmp',
      presets: [preset],
      logger,
      criticPolicy: policy,
      worker,
      applyMode: false,
      runPresetFn: stubRun as unknown as never,
    });
    expect(result.findings.length).toBe(0);
  });
});
