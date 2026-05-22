import { describe, it, expect } from 'vitest';
import {
  engineFamily,
  engineFamilyLabel,
  pickCriticEngine,
  CRITIC_ROLES,
} from './router.js';

describe('engineFamily', () => {
  it('claude-cli + anthropic-api share family "anthropic"', () => {
    expect(engineFamily({ kind: 'claude-cli' })).toBe('anthropic');
    expect(
      engineFamily({
        kind: 'anthropic-api',
        apiKey: 'k',
        models: { haiku: 'h', sonnet: 's', opus: 'o' },
      }),
    ).toBe('anthropic');
  });

  it('openai-compat family is the hostname of baseUrl', () => {
    expect(
      engineFamily({
        kind: 'openai-compat',
        baseUrl: 'https://api.minimaxi.chat/v1',
        apiKey: 'k',
        models: { haiku: 'h', sonnet: 's', opus: 'o' },
      }),
    ).toBe('api.minimaxi.chat');
    expect(
      engineFamily({
        kind: 'openai-compat',
        baseUrl: 'https://api.deepseek.com/v1',
        apiKey: 'k',
        models: { haiku: 'h', sonnet: 's', opus: 'o' },
      }),
    ).toBe('api.deepseek.com');
  });

  it('codex-cli family is "openai"', () => {
    expect(engineFamily({ kind: 'codex-cli' })).toBe('openai');
  });

  it('gemini-cli family is "google"', () => {
    expect(engineFamily({ kind: 'gemini-cli' })).toBe('google');
  });

  it('codex-cli vs claude-cli are cross-family', () => {
    const p = pickCriticEngine({ kind: 'claude-cli' }, { kind: 'codex-cli' });
    expect(p.crossFamily).toBe(true);
    expect(p.reason).toBe('cross-family-active');
  });

  it('gemini-cli vs claude-cli are cross-family', () => {
    const p = pickCriticEngine({ kind: 'claude-cli' }, { kind: 'gemini-cli' });
    expect(p.crossFamily).toBe(true);
    expect(p.reason).toBe('cross-family-active');
  });

  it('falls back to unknown for malformed baseUrl', () => {
    expect(
      engineFamily({
        kind: 'openai-compat',
        baseUrl: 'not-a-url',
        apiKey: 'k',
        models: { haiku: 'h', sonnet: 's', opus: 'o' },
      }),
    ).toBe('openai-compat:unknown');
  });
});

describe('pickCriticEngine', () => {
  const claudeCli = { kind: 'claude-cli' as const };
  const anthropicApi = {
    kind: 'anthropic-api' as const,
    apiKey: 'k',
    models: { haiku: 'h', sonnet: 's', opus: 'o' },
  };
  const minimax = {
    kind: 'openai-compat' as const,
    baseUrl: 'https://api.minimaxi.chat/v1',
    apiKey: 'k',
    models: { haiku: 'h', sonnet: 's', opus: 'o' },
  };
  const deepseek = {
    kind: 'openai-compat' as const,
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: 'k',
    models: { haiku: 'h', sonnet: 's', opus: 'o' },
  };

  it('returns cross-family-active when critic differs', () => {
    const p = pickCriticEngine(claudeCli, minimax);
    expect(p.crossFamily).toBe(true);
    expect(p.critic).toBe(minimax);
    expect(p.reason).toBe('cross-family-active');
  });

  it('returns no-critic-configured when critic is null/undefined', () => {
    const p = pickCriticEngine(claudeCli, null);
    expect(p.crossFamily).toBe(false);
    expect(p.critic).toBe(claudeCli);
    expect(p.reason).toBe('no-critic-configured');
  });

  it('returns same-family-as-worker when critic shares family', () => {
    // claude-cli + anthropic-api both "anthropic" family
    const p = pickCriticEngine(claudeCli, anthropicApi);
    expect(p.crossFamily).toBe(false);
    expect(p.reason).toBe('same-family-as-worker');
  });

  it('two openai-compat hosts are different families', () => {
    const p = pickCriticEngine(minimax, deepseek);
    expect(p.crossFamily).toBe(true);
    expect(p.reason).toBe('cross-family-active');
  });
});

describe('engineFamilyLabel', () => {
  it('keeps "anthropic" verbatim', () => {
    expect(engineFamilyLabel('anthropic')).toBe('anthropic');
  });

  it('shortens hostnames to last 2 segments', () => {
    expect(engineFamilyLabel('api.minimaxi.chat')).toBe('minimaxi.chat');
    expect(engineFamilyLabel('open.bigmodel.cn')).toBe('bigmodel.cn');
  });

  it('returns short hostnames unchanged', () => {
    expect(engineFamilyLabel('localhost')).toBe('localhost');
  });
});

describe('CRITIC_ROLES', () => {
  it('contains all 4 reviewer roles', () => {
    expect(CRITIC_ROLES.has('alignment')).toBe(true);
    expect(CRITIC_ROLES.has('behavioral')).toBe(true);
    expect(CRITIC_ROLES.has('adversarial')).toBe(true);
    expect(CRITIC_ROLES.has('done-check')).toBe(true);
  });

  it('does NOT contain worker roles', () => {
    expect(CRITIC_ROLES.has('detector')).toBe(false);
    expect(CRITIC_ROLES.has('differ')).toBe(false);
    expect(CRITIC_ROLES.has('implementer')).toBe(false);
    expect(CRITIC_ROLES.has('vision')).toBe(false);
  });
});
