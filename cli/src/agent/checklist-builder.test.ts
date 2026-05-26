/**
 * Tests for the Checklist Builder.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { buildChecklist } from './checklist-builder.js';
import {
  createTrackLogger,
  __resetMetaLoggersForTests,
  __resetLiveLoggersForTests,
  __resetRotationGateForTests,
  type LogEntry,
  type TrackLogger,
} from '../log-types.js';
import type { EngineConfig, LoadedPreset } from '../stubs.js';
import { readLogsUnder } from '../__fixtures__/helpers.js';
import type { LlmInferFn } from './project-detector.js';
import type { ProjectProfile } from './types.js';

async function tmpdir(): Promise<string> {
  return fsp.mkdtemp(path.join(os.tmpdir(), 'zerou-checklist-'));
}

function makeLogger(cwd: string): TrackLogger {
  return createTrackLogger('agent', { logRoot: path.join(cwd, '.zerou', 'logs') });
}

function readAgentLog(cwd: string): LogEntry[] {
  const all = readLogsUnder(cwd);
  const entries: LogEntry[] = [];
  for (const [key, v] of all) {
    if (key.startsWith('agent/')) entries.push(...v);
  }
  return entries;
}

function preset(id: string): LoadedPreset {
  return {
    manifest: { id, version: 1, appliesTo: ['saas-web'], rules: [], body: '' },
    source: 'plugin',
    resolvedPath: `/fake/${id}.md`,
    shadowedBy: [],
  };
}

const baseProfile: ProjectProfile = {
  framework: 'next.js',
  backend: 'supabase',
  language: ['typescript'],
  hasGit: true,
  hasTests: true,
  hasEnvFile: true,
  packageMgr: 'pnpm',
  evidence: {},
};

const fakeCriticConfig: EngineConfig = {
  kind: 'openai-compat',
  modelId: 'fake-model',
  releaseDate: '2026-01-01',
  baseUrl: 'http://invalid.local',
};

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

describe('buildChecklist — deterministic path', () => {
  it('without critic key, marks secrets/db included and others skip-no-preset (supabase profile)', async () => {
    const cwd = await tmpdir();
    try {
      const logger = makeLogger(cwd);
      const items = await buildChecklist({
        profile: baseProfile,
        availablePresets: [preset('secrets-leak'), preset('supabase-rls')],
        logger,
        criticConfig: null,
        criticApiKey: null,
      });
      await logger.flush();

      // Should return all 12 categories.
      expect(items).toHaveLength(12);
      const secrets = items.find((i) => i.category === 'secrets');
      expect(secrets?.priority).toBe('medium');
      expect(secrets?.presetIds).toEqual(['secrets-leak']);

      const db = items.find((i) => i.category === 'db');
      expect(db?.priority).toBe('high');
      expect(db?.presetIds).toEqual(['supabase-rls']);

      const auth = items.find((i) => i.category === 'auth');
      expect(auth?.priority).toBe('skip');
      expect(auth?.reasoning).toBe('no-preset-coverage-v1');

      const log = readAgentLog(cwd);
      const events = log.map((e) => e.event);
      expect(events).toContain('agent.checklist.start');
      expect(events).toContain('agent.checklist.heuristic-fallback');
      expect(events).toContain('agent.checklist.complete');
      const includedEvents = log.filter((e) => e.event === 'agent.checklist.category.included');
      const skippedEvents = log.filter((e) => e.event === 'agent.checklist.category.skipped');
      expect(includedEvents.length).toBe(2); // secrets + db
      expect(skippedEvents.length).toBe(10);
    } finally {
      await fsp.rm(cwd, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('without supabase backend, db category is skipped even when supabase-rls preset is available', async () => {
    const cwd = await tmpdir();
    try {
      const profile: ProjectProfile = { ...baseProfile, backend: null };
      const logger = makeLogger(cwd);
      const items = await buildChecklist({
        profile,
        availablePresets: [preset('secrets-leak'), preset('supabase-rls')],
        logger,
        criticConfig: null,
        criticApiKey: null,
      });
      await logger.flush();

      const db = items.find((i) => i.category === 'db');
      expect(db?.priority).toBe('skip');
      expect(db?.presetIds).toEqual([]);
    } finally {
      await fsp.rm(cwd, { recursive: true, force: true }).catch(() => {});
    }
  });
});

describe('buildChecklist — LLM path', () => {
  it('uses LLM-returned checklist when available and schema-valid', async () => {
    const cwd = await tmpdir();
    try {
      const llmCall: LlmInferFn = async () => ({
        ok: true,
        raw: '[]',
        // The defaultLlmInfer types parsed as Partial<ProjectProfile>, but at
        // runtime we pass any JSON. We cast through unknown.
        parsed: [
          { category: 'secrets', priority: 'high', reasoning: 'llm says high', presetIds: ['secrets-leak'] },
          { category: 'auth', priority: 'low', reasoning: 'minor', presetIds: [] },
        ] as unknown as Partial<ProjectProfile>,
      });
      const logger = makeLogger(cwd);
      const items = await buildChecklist({
        profile: baseProfile,
        availablePresets: [preset('secrets-leak')],
        logger,
        criticConfig: fakeCriticConfig,
        criticApiKey: 'k',
        llmCall,
      });
      await logger.flush();

      // Should have all 12 categories, with LLM-provided ones honored
      expect(items).toHaveLength(12);
      const secrets = items.find((i) => i.category === 'secrets');
      expect(secrets?.priority).toBe('high');
      expect(secrets?.reasoning).toBe('llm says high');
      const auth = items.find((i) => i.category === 'auth');
      expect(auth?.priority).toBe('low');

      const log = readAgentLog(cwd);
      const events = log.map((e) => e.event);
      expect(events).toContain('agent.checklist.llm-call.start');
      expect(events).toContain('agent.checklist.llm-call.success');
      expect(events).not.toContain('agent.checklist.heuristic-fallback');
    } finally {
      await fsp.rm(cwd, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('falls back to deterministic when LLM returns invalid schema', async () => {
    const cwd = await tmpdir();
    try {
      const llmCall: LlmInferFn = async () => ({
        ok: true,
        raw: '{}',
        parsed: { not: 'an array' } as unknown as Partial<ProjectProfile>,
      });
      const logger = makeLogger(cwd);
      const items = await buildChecklist({
        profile: baseProfile,
        availablePresets: [preset('secrets-leak')],
        logger,
        criticConfig: fakeCriticConfig,
        criticApiKey: 'k',
        llmCall,
      });
      await logger.flush();
      expect(items).toHaveLength(12);
      // The deterministic mapping should be applied.
      const secrets = items.find((i) => i.category === 'secrets');
      expect(secrets?.priority).toBe('medium');

      const log = readAgentLog(cwd);
      const events = log.map((e) => e.event);
      expect(events).toContain('agent.checklist.llm-call.failure');
    } finally {
      await fsp.rm(cwd, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('falls back when LLM call itself errors', async () => {
    const cwd = await tmpdir();
    try {
      const llmCall: LlmInferFn = async () => ({ ok: false, error: 'boom', raw: '' });
      const logger = makeLogger(cwd);
      const items = await buildChecklist({
        profile: baseProfile,
        availablePresets: [preset('secrets-leak')],
        logger,
        criticConfig: fakeCriticConfig,
        criticApiKey: 'k',
        llmCall,
      });
      await logger.flush();
      expect(items).toHaveLength(12);
      const log = readAgentLog(cwd);
      const events = log.map((e) => e.event);
      expect(events).toContain('agent.checklist.llm-call.failure');
    } finally {
      await fsp.rm(cwd, { recursive: true, force: true }).catch(() => {});
    }
  });
});
