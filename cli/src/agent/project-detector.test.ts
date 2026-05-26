/**
 * Tests for the Project Detector.
 *
 * Cover happy paths, LLM-fallback, and a no-LLM empty-cwd minimal profile.
 *
 * All filesystem state lives under os.tmpdir() (per dispatch-note #7).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { detectProject, type LlmInferFn } from './project-detector.js';
import {
  createTrackLogger,
  __resetMetaLoggersForTests,
  __resetLiveLoggersForTests,
  __resetRotationGateForTests,
  type LogEntry,
  type TrackLogger,
} from '../log-types.js';
import type { EngineConfig } from '../stubs.js';
import { readLogsUnder } from '../__fixtures__/helpers.js';

async function tmpdir(): Promise<string> {
  return fsp.mkdtemp(path.join(os.tmpdir(), 'zerou-detect-'));
}

async function writeFile(root: string, rel: string, content: string): Promise<void> {
  const abs = path.join(root, rel);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, content);
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

describe('detectProject — heuristic path', () => {
  it('detects Next.js + Supabase + pnpm + tests from package.json deps', async () => {
    const cwd = await tmpdir();
    try {
      await writeFile(
        cwd,
        'package.json',
        JSON.stringify({
          name: 'foo',
          dependencies: { next: '14', '@supabase/supabase-js': '2', typescript: '5' },
          scripts: { test: 'vitest' },
        }),
      );
      await writeFile(cwd, 'README.md', '# Foo\n\nA Next.js demo.');
      await writeFile(cwd, 'pnpm-lock.yaml', '# pnpm');
      await writeFile(cwd, '.env.example', 'SUPABASE_URL=');

      const logger = makeLogger(cwd);
      const profile = await detectProject({
        cwd,
        logger,
        criticConfig: null,
        criticApiKey: null,
      });
      await logger.flush();

      expect(profile.framework).toBe('next.js');
      expect(profile.backend).toBe('supabase');
      expect(profile.language).toContain('typescript');
      expect(profile.hasTests).toBe(true);
      expect(profile.hasEnvFile).toBe(true);
      expect(profile.packageMgr).toBe('pnpm');

      const log = readAgentLog(cwd);
      const events = log.map((e) => e.event);
      expect(events).toContain('agent.project-detection.start');
      expect(events).toContain('agent.project-detection.files-read');
      expect(events).toContain('agent.project-detection.heuristic-fallback');
      expect(events).toContain('agent.project-detection.complete');
    } finally {
      await fsp.rm(cwd, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('returns minimal unknown profile when cwd is empty', async () => {
    const cwd = await tmpdir();
    try {
      const logger = makeLogger(cwd);
      const profile = await detectProject({
        cwd,
        logger,
        criticConfig: null,
        criticApiKey: null,
      });
      await logger.flush();

      expect(profile.framework).toBe('unknown');
      expect(profile.backend).toBe(null);
      expect(profile.hasGit).toBe(false);
      expect(profile.hasTests).toBe(false);
      expect(profile.hasEnvFile).toBe(false);
      expect(profile.packageMgr).toBe(null);

      const log = readAgentLog(cwd);
      const filesRead = log.find((e) => e.event === 'agent.project-detection.files-read');
      expect(filesRead).toBeTruthy();
      expect(filesRead?.count).toBe(0);
    } finally {
      await fsp.rm(cwd, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('detects vite framework from vite.config.ts', async () => {
    const cwd = await tmpdir();
    try {
      await writeFile(cwd, 'vite.config.ts', 'export default {};');
      await writeFile(cwd, 'package.json', JSON.stringify({ name: 'v', dependencies: {} }));
      const logger = makeLogger(cwd);
      const profile = await detectProject({
        cwd,
        logger,
        criticConfig: null,
        criticApiKey: null,
      });
      await logger.flush();
      expect(profile.framework).toBe('vite');
    } finally {
      await fsp.rm(cwd, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('detects firebase backend from deps', async () => {
    const cwd = await tmpdir();
    try {
      await writeFile(
        cwd,
        'package.json',
        JSON.stringify({ name: 'f', dependencies: { firebase: '10' } }),
      );
      const logger = makeLogger(cwd);
      const profile = await detectProject({
        cwd,
        logger,
        criticConfig: null,
        criticApiKey: null,
      });
      await logger.flush();
      expect(profile.backend).toBe('firebase');
    } finally {
      await fsp.rm(cwd, { recursive: true, force: true }).catch(() => {});
    }
  });
});

describe('detectProject — LLM path', () => {
  it('uses LLM result when call succeeds (happy path)', async () => {
    const cwd = await tmpdir();
    try {
      await writeFile(
        cwd,
        'package.json',
        JSON.stringify({ name: 'x', dependencies: { next: '14' } }),
      );

      const llmCall: LlmInferFn = async () => ({
        ok: true,
        raw: '{}',
        parsed: {
          framework: 'next.js-app-router',
          backend: 'supabase',
          language: ['typescript'],
          hasTests: true,
          hasEnvFile: false,
          packageMgr: 'pnpm',
          evidence: { source: 'llm-inferred' },
        },
      });

      const logger = makeLogger(cwd);
      const profile = await detectProject({
        cwd,
        logger,
        criticConfig: fakeCriticConfig,
        criticApiKey: 'k',
        llmCall,
      });
      await logger.flush();

      expect(profile.framework).toBe('next.js-app-router');
      expect(profile.backend).toBe('supabase');
      expect(profile.packageMgr).toBe('pnpm');

      const log = readAgentLog(cwd);
      const events = log.map((e) => e.event);
      expect(events).toContain('agent.project-detection.llm-call.start');
      expect(events).toContain('agent.project-detection.llm-call.success');
      expect(events).not.toContain('agent.project-detection.heuristic-fallback');
    } finally {
      await fsp.rm(cwd, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('falls back to heuristic when LLM fails', async () => {
    const cwd = await tmpdir();
    try {
      await writeFile(
        cwd,
        'package.json',
        JSON.stringify({ name: 'x', dependencies: { express: '4' } }),
      );

      const llmCall: LlmInferFn = async () => ({
        ok: false,
        error: 'network down',
        raw: '',
      });

      const logger = makeLogger(cwd);
      const profile = await detectProject({
        cwd,
        logger,
        criticConfig: fakeCriticConfig,
        criticApiKey: 'k',
        llmCall,
      });
      await logger.flush();

      // Heuristic should still work: express framework.
      expect(profile.framework).toBe('express');

      const log = readAgentLog(cwd);
      const events = log.map((e) => e.event);
      expect(events).toContain('agent.project-detection.llm-call.start');
      expect(events).toContain('agent.project-detection.llm-call.failure');
      expect(events).toContain('agent.project-detection.heuristic-fallback');
    } finally {
      await fsp.rm(cwd, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('handles LLM throw without crashing', async () => {
    const cwd = await tmpdir();
    try {
      await writeFile(cwd, 'package.json', JSON.stringify({ name: 'x' }));

      const llmCall: LlmInferFn = async () => {
        throw new Error('boom');
      };

      const logger = makeLogger(cwd);
      const profile = await detectProject({
        cwd,
        logger,
        criticConfig: fakeCriticConfig,
        criticApiKey: 'k',
        llmCall,
      });
      await logger.flush();

      expect(profile).toBeTruthy();
      const log = readAgentLog(cwd);
      const events = log.map((e) => e.event);
      expect(events).toContain('agent.project-detection.llm-call.failure');
    } finally {
      await fsp.rm(cwd, { recursive: true, force: true }).catch(() => {});
    }
  });
});
