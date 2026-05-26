/**
 * Cross-Engine Reviewer — router tests.
 *
 * Surface: docs/details/14-protocol-1-public-surface.md
 * Test plan: docs/details/14-protocol-1-tests.md §B-1 / §B-5.
 *
 * Covers behaviors:
 *   B-1-1 — cross-family policy selection
 *   B-1-2 — empty/null/undefined pool → no-critic-configured
 *   B-1-3 — same-family pool → same-family-as-worker
 *   B-5-1 — openai-compat hostname normalization + invalid URL sentinel
 *
 * Test discipline (per dispatch-notes #b2): use real EngineConfig.kind values
 * — never invent placeholder kinds.
 */

import { describe, it, expect } from 'vitest';
import { engineFamily, pickCriticEngine } from './router.js';
import type { EngineConfig } from '../../config/types.js';

// ── Engine-config builders (one per family taxonomy row) ────────────────────

const claudeCliCfg = (): EngineConfig => ({ kind: 'claude-cli' });

const anthropicApiCfg = (): EngineConfig => ({
  kind: 'anthropic-api',
  apiKey: 'k',
  models: { haiku: 'claude-haiku-4-5-20251001', sonnet: 's', opus: 'o' },
});

const codexCliCfg = (): EngineConfig => ({ kind: 'codex-cli' });

const geminiCliCfg = (): EngineConfig => ({ kind: 'gemini-cli' });

const openaiCompatCfg = (baseUrl: string): EngineConfig => ({
  kind: 'openai-compat',
  baseUrl,
  apiKey: 'k',
  models: { haiku: 'deepseek-v3', sonnet: 's', opus: 'o' },
});

// ── B-1-1 — cross-family policy selection ───────────────────────────────────

describe('B-1-1 — pickCriticEngine cross-family path', () => {
  it('worker claude-cli + pool [codex-cli] → cross-family-active with critic codex', () => {
    const worker = claudeCliCfg();
    const pool = [codexCliCfg()];
    const policy = pickCriticEngine(worker, pool);

    expect(policy.crossFamily).toBe(true);
    expect(policy.reason).toBe('cross-family-active');
    expect(policy.critic.kind).toBe('codex-cli');
    expect(policy.worker).toBe(worker);
    expect(policy.criticEngine).toBeDefined();
    expect(typeof policy.criticEngine.call).toBe('function');
    expect(typeof policy.criticEngine.lastCallCostUsd).toBe('function');
    expect(typeof policy.criticEngine.getMeta).toBe('function');
  });

  it('picks FIRST cross-family member when multiple qualify (deterministic order)', () => {
    const worker = claudeCliCfg();
    const pool = [anthropicApiCfg(), codexCliCfg(), geminiCliCfg()];
    const policy = pickCriticEngine(worker, pool);

    expect(policy.crossFamily).toBe(true);
    expect(policy.reason).toBe('cross-family-active');
    // First cross-family entry in order is codex-cli (anthropic-api is same-family).
    expect(policy.critic.kind).toBe('codex-cli');
  });
});

// ── B-1-2 — null/undefined/empty pool fall-through ──────────────────────────

describe('B-1-2 — pickCriticEngine no-critic-configured path', () => {
  it('null pool → no-critic-configured, critic === worker', () => {
    const worker = claudeCliCfg();
    const policy = pickCriticEngine(worker, null);
    expect(policy.crossFamily).toBe(false);
    expect(policy.reason).toBe('no-critic-configured');
    expect(policy.critic).toBe(worker);
  });

  it('undefined pool → no-critic-configured', () => {
    const worker = claudeCliCfg();
    const policy = pickCriticEngine(worker);
    expect(policy.crossFamily).toBe(false);
    expect(policy.reason).toBe('no-critic-configured');
    expect(policy.critic).toBe(worker);
  });

  it('empty-array pool → no-critic-configured (per surface fall-through)', () => {
    const worker = claudeCliCfg();
    const policy = pickCriticEngine(worker, []);
    expect(policy.crossFamily).toBe(false);
    expect(policy.reason).toBe('no-critic-configured');
    expect(policy.critic).toBe(worker);
  });

  it('criticEngine adapter exposes getMeta() with kind from worker config', () => {
    const worker = claudeCliCfg();
    const policy = pickCriticEngine(worker, null);
    const meta = policy.criticEngine.getMeta();
    expect(meta.kind).toBe('claude-cli');
    expect(typeof meta.modelId).toBe('string');
    expect(typeof meta.releaseDate).toBe('string');
  });
});

// ── B-1-3 — same-family-as-worker ───────────────────────────────────────────

describe('B-1-3 — pickCriticEngine same-family-as-worker path', () => {
  it('worker claude-cli + pool [anthropic-api] → same-family-as-worker, critic = anthropic-api', () => {
    const worker = claudeCliCfg();
    const pool = [anthropicApiCfg()];
    const policy = pickCriticEngine(worker, pool);

    expect(policy.crossFamily).toBe(false);
    expect(policy.reason).toBe('same-family-as-worker');
    expect(policy.critic.kind).toBe('anthropic-api');
  });

  it('multiple same-family entries → first pool entry chosen', () => {
    const worker = claudeCliCfg();
    const pool = [anthropicApiCfg(), claudeCliCfg()];
    const policy = pickCriticEngine(worker, pool);

    expect(policy.crossFamily).toBe(false);
    expect(policy.reason).toBe('same-family-as-worker');
    expect(policy.critic.kind).toBe('anthropic-api'); // first entry
  });
});

// ── Engine instance pooling — each call returns FRESH adapter ───────────────

describe('pickCriticEngine — engine instance pooling', () => {
  it('each call returns a fresh criticEngine instance (not pooled)', () => {
    const worker = claudeCliCfg();
    const pool = [codexCliCfg()];
    const a = pickCriticEngine(worker, pool);
    const b = pickCriticEngine(worker, pool);
    expect(a.criticEngine).not.toBe(b.criticEngine);
  });
});

// ── B-5-1 — openai-compat family hostname normalization ─────────────────────

describe('B-5-1 — engineFamily openai-compat hostname normalization', () => {
  it('lowercases hostname and strips port + path', () => {
    expect(
      engineFamily(openaiCompatCfg('https://Api.DeepSeek.com:8080/v1/chat')),
    ).toBe('api.deepseek.com');
  });

  it('invalid URL → "openai-compat:unknown" sentinel', () => {
    expect(engineFamily(openaiCompatCfg('not a url'))).toBe('openai-compat:unknown');
  });

  it('canonical kind → family mapping', () => {
    expect(engineFamily(claudeCliCfg())).toBe('anthropic');
    expect(engineFamily(anthropicApiCfg())).toBe('anthropic');
    expect(engineFamily(codexCliCfg())).toBe('openai');
    expect(engineFamily(geminiCliCfg())).toBe('google');
    expect(engineFamily(openaiCompatCfg('https://api.deepseek.com/v1'))).toBe(
      'api.deepseek.com',
    );
  });
});
