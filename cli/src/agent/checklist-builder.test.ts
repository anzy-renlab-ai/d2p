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
  it('with saas-web profile, includes every preset whose appliesTo matches', async () => {
    // Phase 16: deterministic checklist now dispatches every loaded preset
    // whose appliesTo matches the profile (or is empty). The fake preset()
    // helper builds presets with appliesTo: ['saas-web']; the saas-web
    // profile (next.js + supabase) matches both, so both should be included.
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
      expect(db?.priority).toBe('medium');
      expect(db?.presetIds).toEqual(['supabase-rls']);

      const auth = items.find((i) => i.category === 'auth');
      expect(auth?.priority).toBe('skip');

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

  it('with appliesTo: [] preset, includes preset regardless of profile', async () => {
    // Phase 16: presets with empty appliesTo apply to all projects. The
    // markdown loader emits appliesTo: [] for most rule-bearing presets so
    // they run everywhere.
    const cwd = await tmpdir();
    try {
      const alwaysOn: LoadedPreset = {
        manifest: { id: 'db-injection', version: 2, appliesTo: [], rules: [], body: '' },
        source: 'plugin',
        resolvedPath: '/fake/db-injection.md',
        shadowedBy: [],
      };
      const profile: ProjectProfile = { ...baseProfile, backend: null };
      const logger = makeLogger(cwd);
      const items = await buildChecklist({
        profile,
        availablePresets: [alwaysOn],
        logger,
        criticConfig: null,
        criticApiKey: null,
      });
      await logger.flush();

      const db = items.find((i) => i.category === 'db');
      expect(db?.priority).toBe('medium');
      expect(db?.presetIds).toEqual(['db-injection']);
    } finally {
      await fsp.rm(cwd, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('with appliesTo: [saas-web], skips preset when profile is cli-only', async () => {
    // Phase 16: presets with explicit appliesTo are filtered by profile match.
    const cwd = await tmpdir();
    try {
      const saasOnly: LoadedPreset = {
        manifest: {
          id: 'auth-weakness',
          version: 2,
          appliesTo: ['saas-web', 'api-service'],
          rules: [],
          body: '',
        },
        source: 'plugin',
        resolvedPath: '/fake/auth-weakness.md',
        shadowedBy: [],
      };
      const profile: ProjectProfile = {
        framework: 'cli-tool',
        backend: null,
        language: ['typescript'],
        hasGit: true,
        hasTests: false,
        hasEnvFile: false,
        packageMgr: 'npm',
        evidence: { bin: 'true' },
      };
      const logger = makeLogger(cwd);
      const items = await buildChecklist({
        profile,
        availablePresets: [saasOnly],
        logger,
        criticConfig: null,
        criticApiKey: null,
      });
      await logger.flush();

      const auth = items.find((i) => i.category === 'auth');
      expect(auth?.priority).toBe('skip');
      expect(auth?.presetIds).toEqual([]);
    } finally {
      await fsp.rm(cwd, { recursive: true, force: true }).catch(() => {});
    }
  });
});

describe('profileMatches', () => {
  it('matches next.js project to saas-web', async () => {
    const { profileMatches } = await import('./checklist-builder.js');
    const profile: ProjectProfile = {
      framework: 'next.js',
      backend: null,
      language: ['typescript'],
      hasGit: true,
      hasTests: false,
      hasEnvFile: false,
      packageMgr: 'npm',
      evidence: {},
    };
    expect(profileMatches(profile, 'saas-web')).toBe(true);
  });

  it('matches express project to api-service', async () => {
    const { profileMatches } = await import('./checklist-builder.js');
    const profile: ProjectProfile = {
      framework: 'express',
      backend: 'custom-express',
      language: ['javascript'],
      hasGit: true,
      hasTests: false,
      hasEnvFile: false,
      packageMgr: 'npm',
      evidence: {},
    };
    expect(profileMatches(profile, 'api-service')).toBe(true);
  });

  it('does NOT match cli-only project to saas-web', async () => {
    const { profileMatches } = await import('./checklist-builder.js');
    const profile: ProjectProfile = {
      framework: 'cli-tool',
      backend: null,
      language: ['typescript'],
      hasGit: true,
      hasTests: false,
      hasEnvFile: false,
      packageMgr: 'npm',
      evidence: { bin: 'true' },
    };
    expect(profileMatches(profile, 'saas-web')).toBe(false);
    expect(profileMatches(profile, 'cli-tool')).toBe(true);
  });

  it('matches library profile to library target', async () => {
    const { profileMatches } = await import('./checklist-builder.js');
    const profile: ProjectProfile = {
      framework: 'unknown',
      backend: null,
      language: ['typescript'],
      hasGit: true,
      hasTests: false,
      hasEnvFile: false,
      packageMgr: 'npm',
      evidence: {},
    };
    expect(profileMatches(profile, 'library')).toBe(true);
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
