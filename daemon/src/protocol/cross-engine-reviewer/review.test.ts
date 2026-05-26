/**
 * Cross-Engine Reviewer — review tests.
 *
 * Surface: docs/details/14-protocol-1-public-surface.md
 * Test plan: docs/details/14-protocol-1-tests.md §B-2 / §B-3.
 *
 * Covers behaviors:
 *   B-2-1 — non-cross-family policy short-circuits (allowDegraded:false)
 *   B-2-2 — confirmed verdict round-trip with critic metadata
 *   B-2-3 — needs-context+empty-requiredContext coerced to FP
 *   B-2-4 — transport error → critic-unavailable + invocation-failure log
 *   B-2-5 — JSON parse failure → critic-unavailable + response-parse-failure
 *   B-3-1 — batch concurrency + batch.start/.success logs
 *   B-3-2 — costCap throttle → drops to serial after threshold
 *   B-3-3 — costCap exhausted → suffix entries are critic-unavailable
 *
 * Test discipline (per dispatch-notes #4 / #b2):
 *   - captureLogsFor MUST be in try/finally — captureLogsFor already wraps
 *     internally, but our usage is wrapping the async test body explicitly.
 *   - MockEngine uses REAL EngineConfig.kind values (no invented kinds).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { reviewFinding, reviewBatch } from './review.js';
import { pickCriticEngine } from './router.js';
import { captureLogsFor } from '../../log/test-helpers.js';
import type { EngineConfig } from '../../config/types.js';
import type {
  Finding,
  MinimalCriticEngineSurface,
} from './types.js';

beforeAll(() => {
  // Per dispatch-notes #6 + tests-doc §1: ZEROU_LOG_NULL=1 makes file I/O
  // impossible during the suite; captureLogsFor still observes.
  process.env.ZEROU_LOG_NULL = '1';
});

// ── Engine-config builders ──────────────────────────────────────────────────

const claudeCliCfg = (): EngineConfig => ({ kind: 'claude-cli' });

const codexCliCfg = (): EngineConfig => ({ kind: 'codex-cli' });

const anthropicApiCfg = (): EngineConfig => ({
  kind: 'anthropic-api',
  apiKey: 'k',
  models: { haiku: 'h', sonnet: 's', opus: 'o' },
});

// ── Fixture: mockFinding ────────────────────────────────────────────────────

function mockFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'secrets-leak.abc12345',
    presetId: 'secrets-leak',
    ruleId: 'hardcoded-stripe-key',
    severity: 'P1',
    file: 'src/billing.ts',
    line: 42,
    evidence: 'const KEY = "sk_live_FAKE"',
    matched_content_normalized: 'constkey="sk_live_fake"',
    message: 'Hardcoded stripe live secret detected.',
    remediationHint: 'Move to env var.',
    fixAvailable: 'llm-only',
    version: '1.0',
    ...overrides,
  };
}

// ── Fixture: MockEngine ─────────────────────────────────────────────────────

type ScriptStep =
  | { kind: 'respond'; json: string }
  | { kind: 'throw'; error: Error }
  | { kind: 'delay-respond'; ms: number; json: string }
  | { kind: 'transport-error'; message?: string };

interface MockEngineMeta {
  kind: string;
  modelId: string;
  releaseDate: string;
}

class MockEngine implements MinimalCriticEngineSurface {
  calls = 0;
  inFlight = 0;
  maxInFlight = 0;
  inFlightHistory: Array<{ time: number; value: number }> = [];
  reportedCostPerCall = 0;
  private cursor = 0;

  constructor(
    private meta: MockEngineMeta,
    private script: ScriptStep[],
  ) {}

  async call(_prompt: string): Promise<string> {
    this.calls += 1;
    this.inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    this.inFlightHistory.push({ time: Date.now(), value: this.inFlight });

    const step = this.script[this.cursor++];
    if (!step) {
      this.inFlight -= 1;
      throw new Error(`MockEngine script exhausted at call ${this.calls}`);
    }

    try {
      if (step.kind === 'respond') {
        return step.json;
      }
      if (step.kind === 'delay-respond') {
        await new Promise((resolve) => setTimeout(resolve, step.ms));
        return step.json;
      }
      if (step.kind === 'throw') {
        throw step.error;
      }
      if (step.kind === 'transport-error') {
        throw new Error(step.message ?? 'ECONNREFUSED');
      }
      throw new Error('unknown script step');
    } finally {
      this.inFlight -= 1;
      this.inFlightHistory.push({ time: Date.now(), value: this.inFlight });
    }
  }

  lastCallCostUsd(): number | null {
    return this.reportedCostPerCall;
  }

  getMeta() {
    return this.meta;
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const codexMeta: MockEngineMeta = {
  kind: 'codex-cli',
  modelId: 'gpt-5-mini',
  releaseDate: '2025-08-15',
};

const anthropicMeta: MockEngineMeta = {
  kind: 'anthropic-api',
  modelId: 'claude-haiku-4-5-20251001',
  releaseDate: '2025-10-01',
};

function ctx() {
  return { cwd: process.cwd(), repoSha: null };
}

// Build a cross-family policy whose criticEngine is the mock.
function crossFamilyPolicyWithMock(mock: MockEngine) {
  const policy = pickCriticEngine(claudeCliCfg(), [codexCliCfg()]);
  // Per surface §"CriticPolicy construction" + tests doc §2: patching
  // policy.criticEngine to a MockEngine is the documented seam.
  (policy as { criticEngine: MinimalCriticEngineSurface }).criticEngine = mock;
  return policy;
}

function noCriticPolicyWithMock(mock: MockEngine) {
  const policy = pickCriticEngine(claudeCliCfg(), null);
  (policy as { criticEngine: MinimalCriticEngineSurface }).criticEngine = mock;
  return policy;
}

function sameFamilyPolicyWithMock(mock: MockEngine) {
  const policy = pickCriticEngine(claudeCliCfg(), [anthropicApiCfg()]);
  (policy as { criticEngine: MinimalCriticEngineSurface }).criticEngine = mock;
  return policy;
}

// ── B-2-1 — non-cross-family policy short-circuits ──────────────────────────

describe('B-2-1 — reviewFinding non-crossFamily policy short-circuit', () => {
  it('returns critic-unavailable + does NOT call critic, with default opts', async () => {
    const mock = new MockEngine(codexMeta, []);
    const policy = noCriticPolicyWithMock(mock);

    const { result, entries } = await captureLogsFor(
      { track: 'critic' },
      async () => {
        return reviewFinding(mockFinding(), ctx(), policy);
      },
    );

    expect(result.verdict).toBe('critic-unavailable');
    expect(result.critic).toBeNull();
    expect(typeof result.reasoning).toBe('string');
    expect(result.reasoning!.length).toBeGreaterThan(0);
    expect(result.id).toBe(mockFinding().id);
    expect(result.version).toBe('1.0');

    expect(mock.calls).toBe(0);

    const startEntry = entries.find((e) => e.event === 'critic.review.start');
    const successEntry = entries.find((e) => e.event === 'critic.review.success');
    expect(startEntry).toBeDefined();
    expect(startEntry?.crossFamily).toBe(false);
    expect(successEntry).toBeDefined();
    expect(successEntry?.verdict).toBe('critic-unavailable');
    expect(successEntry?.criticFamily).toBeNull();
    expect(entries.find((e) => e.event === 'critic.invocation-failure')).toBeUndefined();
  });

  it('allowDegraded:true on same-family policy DOES invoke critic', async () => {
    const mock = new MockEngine(anthropicMeta, [
      { kind: 'respond', json: JSON.stringify({ verdict: 'confirmed', reasoning: 'ok' }) },
    ]);
    const policy = sameFamilyPolicyWithMock(mock);

    const { result, entries } = await captureLogsFor(
      { track: 'critic' },
      async () => {
        return reviewFinding(mockFinding(), ctx(), policy, { allowDegraded: true });
      },
    );

    expect(result.verdict).toBe('confirmed');
    expect(result.critic).not.toBeNull();
    expect(result.critic?.family).toBe('anthropic');
    expect(mock.calls).toBe(1);

    const successEntry = entries.find((e) => e.event === 'critic.review.success');
    expect(successEntry?.criticFamily).toBe('anthropic');
  });
});

// ── B-2-2 — confirmed verdict round-trip ───────────────────────────────────

describe('B-2-2 — reviewFinding cross-family confirmed verdict', () => {
  it('round-trips confirmed verdict with populated CriticInfo', async () => {
    const mock = new MockEngine(codexMeta, [
      {
        kind: 'respond',
        json: JSON.stringify({
          verdict: 'confirmed',
          reasoning: 'real secret, sk_live prefix',
        }),
      },
    ]);
    const policy = crossFamilyPolicyWithMock(mock);

    const { result, entries } = await captureLogsFor(
      { track: 'critic' },
      async () => {
        return reviewFinding(mockFinding(), ctx(), policy);
      },
    );

    expect(result.verdict).toBe('confirmed');
    expect(result.reasoning).toBe('real secret, sk_live prefix');
    expect(result.critic?.kind).toBe('codex-cli');
    expect(result.critic?.modelId).toBe('gpt-5-mini');
    expect(result.critic?.releaseDate).toBe('2025-08-15');
    expect(result.critic?.family).toBe('openai');
    expect(result.requiredContext).toBeNull();

    const startEntry = entries.find((e) => e.event === 'critic.review.start');
    expect(startEntry?.crossFamily).toBe(true);
    expect(startEntry?.presetId).toBe('secrets-leak');
    expect(startEntry?.ruleId).toBe('hardcoded-stripe-key');

    const successEntry = entries.find((e) => e.event === 'critic.review.success');
    expect(successEntry?.verdict).toBe('confirmed');
    expect(successEntry?.criticFamily).toBe('openai');
  });

  it('propagates false-positive verdict end-to-end without coercion log', async () => {
    const mock = new MockEngine(codexMeta, [
      {
        kind: 'respond',
        json: JSON.stringify({
          verdict: 'false-positive',
          reasoning: 'fixture not real key',
        }),
      },
    ]);
    const policy = crossFamilyPolicyWithMock(mock);

    const { result, entries } = await captureLogsFor(
      { track: 'critic' },
      async () => {
        return reviewFinding(mockFinding(), ctx(), policy);
      },
    );

    expect(result.verdict).toBe('false-positive');
    expect(result.requiredContext).toBeNull();
    expect(result.critic).not.toBeNull();
    expect(entries.find((e) => e.event === 'critic.coerced-empty-context-to-fp')).toBeUndefined();
  });
});

// ── B-2-3 — needs-context coercion ──────────────────────────────────────────

describe('B-2-3 — needs-context+empty-requiredContext coercion', () => {
  it('empty requiredContext array → coerced to false-positive, requiredContext: null', async () => {
    const mock = new MockEngine(codexMeta, [
      {
        kind: 'respond',
        json: JSON.stringify({
          verdict: 'needs-context',
          reasoning: 'unsure',
          requiredContext: [],
        }),
      },
    ]);
    const policy = crossFamilyPolicyWithMock(mock);

    const { result, entries } = await captureLogsFor(
      { track: 'critic' },
      async () => reviewFinding(mockFinding(), ctx(), policy),
    );

    expect(result.verdict).toBe('false-positive');
    expect(result.requiredContext).toBeNull();
    expect(result.critic).not.toBeNull();

    const coerceEntry = entries.find(
      (e) => e.event === 'critic.coerced-empty-context-to-fp',
    );
    expect(coerceEntry).toBeDefined();
    expect(coerceEntry?.findingId).toBe(result.id);
  });

  it('absent requiredContext key → coerced (same as empty)', async () => {
    const mock = new MockEngine(codexMeta, [
      {
        kind: 'respond',
        json: '{"verdict":"needs-context","reasoning":"unsure"}',
      },
    ]);
    const policy = crossFamilyPolicyWithMock(mock);

    const { result, entries } = await captureLogsFor(
      { track: 'critic' },
      async () => reviewFinding(mockFinding(), ctx(), policy),
    );

    expect(result.verdict).toBe('false-positive');
    expect(result.requiredContext).toBeNull();
    expect(
      entries.find((e) => e.event === 'critic.coerced-empty-context-to-fp'),
    ).toBeDefined();
  });

  it('legitimate needs-context with non-empty requiredContext survives', async () => {
    const mock = new MockEngine(codexMeta, [
      {
        kind: 'respond',
        json: JSON.stringify({
          verdict: 'needs-context',
          reasoning: 'need .env.example',
          requiredContext: ['.env.example contents'],
        }),
      },
    ]);
    const policy = crossFamilyPolicyWithMock(mock);

    const { result, entries } = await captureLogsFor(
      { track: 'critic' },
      async () => reviewFinding(mockFinding(), ctx(), policy),
    );

    expect(result.verdict).toBe('needs-context');
    expect(result.requiredContext).toEqual(['.env.example contents']);
    expect(
      entries.find((e) => e.event === 'critic.coerced-empty-context-to-fp'),
    ).toBeUndefined();
  });
});

// ── B-2-4 — transport error ─────────────────────────────────────────────────

describe('B-2-4 — reviewFinding transport error → critic-unavailable', () => {
  it('non-rate-limit throw → critic-unavailable + P1-E-2 log entry', async () => {
    const mock = new MockEngine(codexMeta, [
      { kind: 'throw', error: new Error('ECONNREFUSED at api.openai.com:443') },
    ]);
    const policy = crossFamilyPolicyWithMock(mock);

    const { result, entries } = await captureLogsFor(
      { track: 'critic' },
      async () => reviewFinding(mockFinding(), ctx(), policy),
    );

    expect(result.verdict).toBe('critic-unavailable');
    expect(result.critic).toBeNull();
    expect(result.reasoning).toContain('ECONNREFUSED');

    const failEntry = entries.find((e) => e.event === 'critic.invocation-failure');
    expect(failEntry).toBeDefined();
    expect(failEntry?.errorCode).toBe('P1-E-2');
    expect(failEntry?.findingId).toBe(result.id);
    expect(typeof failEntry?.error).toBe('string');

    const successEntry = entries.find((e) => e.event === 'critic.review.success');
    expect(successEntry?.verdict).toBe('critic-unavailable');
    expect(successEntry?.criticFamily).toBeNull();
  });

  it('P1-E-1 synchronous throw when policy is null', async () => {
    expect(() =>
      reviewFinding(mockFinding(), ctx(), null as unknown as ReturnType<typeof pickCriticEngine>),
    ).toThrow(/P1-E-1/);
  });
});

// ── B-2-5 — JSON parse failure ──────────────────────────────────────────────

describe('B-2-5 — critic response parse failure', () => {
  it('malformed JSON → critic-unavailable + P1-E-3 log with raw ≤500 chars', async () => {
    const raw = 'not-a-json-object {{{';
    const mock = new MockEngine(codexMeta, [{ kind: 'respond', json: raw }]);
    const policy = crossFamilyPolicyWithMock(mock);

    const { result, entries } = await captureLogsFor(
      { track: 'critic' },
      async () => reviewFinding(mockFinding(), ctx(), policy),
    );

    expect(result.verdict).toBe('critic-unavailable');
    expect(result.critic).toBeNull();

    const parseEntry = entries.find((e) => e.event === 'critic.response-parse-failure');
    expect(parseEntry).toBeDefined();
    expect(parseEntry?.errorCode).toBe('P1-E-3');
    expect(parseEntry?.raw).toBe(raw);
    expect(parseEntry?.findingId).toBe(result.id);
  });

  it('oversized raw is truncated to ≤500 chars', async () => {
    const raw = 'x'.repeat(5000);
    const mock = new MockEngine(codexMeta, [{ kind: 'respond', json: raw }]);
    const policy = crossFamilyPolicyWithMock(mock);

    const { entries } = await captureLogsFor(
      { track: 'critic' },
      async () => reviewFinding(mockFinding(), ctx(), policy),
    );

    const parseEntry = entries.find((e) => e.event === 'critic.response-parse-failure');
    expect(parseEntry).toBeDefined();
    expect((parseEntry?.raw as string).length).toBeLessThanOrEqual(500);
  });
});

// ── B-3-1 — reviewBatch concurrency + logs ──────────────────────────────────

describe('B-3-1 — reviewBatch concurrency + batch.start/.success logs', () => {
  it('20 findings @ default concurrency 5 calls critic 20x with batch logs', async () => {
    const findings = Array.from({ length: 20 }, (_, i) =>
      mockFinding({ id: `secrets-leak.${String(i).padStart(8, '0')}` }),
    );
    const script: ScriptStep[] = findings.map(() => ({
      kind: 'respond',
      json: JSON.stringify({ verdict: 'confirmed', reasoning: 'ok' }),
    }));
    const mock = new MockEngine(codexMeta, script);
    mock.reportedCostPerCall = 0;
    const policy = crossFamilyPolicyWithMock(mock);

    const { result: results, entries } = await captureLogsFor(
      { track: 'critic' },
      async () => reviewBatch(findings, ctx(), policy),
    );

    expect(results).toHaveLength(20);
    expect(results.every((r) => r.verdict === 'confirmed')).toBe(true);
    expect(results.every((r) => r.critic !== null)).toBe(true);
    expect(mock.calls).toBe(20);
    expect(mock.maxInFlight).toBeLessThanOrEqual(5);

    const startEntry = entries.find((e) => e.event === 'critic.batch.start');
    expect(startEntry).toBeDefined();
    expect(startEntry?.total).toBe(20);
    expect(startEntry?.concurrency).toBe(5);
    expect(startEntry?.costCap).toBeNull(); // Infinity-default → null

    const successEntry = entries.find((e) => e.event === 'critic.batch.success');
    expect(successEntry).toBeDefined();
    expect(successEntry?.total).toBe(20);
    expect(successEntry?.confirmed).toBe(20);
    expect(successEntry?.falsePositive).toBe(0);
    expect(successEntry?.needsContext).toBe(0);
    expect(successEntry?.criticUnavailable).toBe(0);
    expect(typeof successEntry?.durationMs).toBe('number');

    expect(
      entries.filter((e) => e.event === 'critic.batch.progress').length,
    ).toBeGreaterThanOrEqual(1);
  });

  it('empty findings array → no-op + zero-total batch logs', async () => {
    const mock = new MockEngine(codexMeta, []);
    const policy = crossFamilyPolicyWithMock(mock);

    const { result: results, entries } = await captureLogsFor(
      { track: 'critic' },
      async () => reviewBatch([], ctx(), policy),
    );

    expect(results).toEqual([]);
    expect(mock.calls).toBe(0);

    const startEntry = entries.find((e) => e.event === 'critic.batch.start');
    expect(startEntry?.total).toBe(0);
    expect(startEntry?.concurrency).toBe(5);

    const successEntry = entries.find((e) => e.event === 'critic.batch.success');
    expect(successEntry?.total).toBe(0);
    expect(successEntry?.confirmed).toBe(0);
    expect(successEntry?.falsePositive).toBe(0);
    expect(successEntry?.needsContext).toBe(0);
    expect(successEntry?.criticUnavailable).toBe(0);
  });
});

// ── B-3-2 — cost-cap throttle ──────────────────────────────────────────────

describe('B-3-2 — reviewBatch costCap throttle', () => {
  it('drops to serial after costSoFar >= costCap', async () => {
    const findings = Array.from({ length: 10 }, (_, i) =>
      mockFinding({ id: `secrets-leak.${String(i).padStart(8, '0')}` }),
    );
    // Each call delays 20ms so concurrent calls actually overlap.
    const script: ScriptStep[] = findings.map(() => ({
      kind: 'delay-respond',
      ms: 20,
      json: JSON.stringify({ verdict: 'confirmed', reasoning: 'ok' }),
    }));
    const mock = new MockEngine(codexMeta, script);
    mock.reportedCostPerCall = 0.005;
    const policy = crossFamilyPolicyWithMock(mock);

    const { result: results, entries } = await captureLogsFor(
      { track: 'critic' },
      async () =>
        reviewBatch(findings, ctx(), policy, {
          costCap: 0.01,
          concurrency: 5,
        }),
    );

    expect(results).toHaveLength(10);

    const startEntry = entries.find((e) => e.event === 'critic.batch.start');
    expect(startEntry?.costCap).toBe(0.01);
    expect(startEntry?.concurrency).toBe(5);

    const throttleEntries = entries.filter((e) => e.event === 'critic.cost-cap-throttle');
    expect(throttleEntries.length).toBeGreaterThanOrEqual(1);
    expect((throttleEntries[0]!.costSoFar as number) >= 0.01).toBe(true);
    expect(throttleEntries[0]!.costCap).toBe(0.01);

    // After throttle: maxInFlight in the subsequent (serial) phase ≤ 1.
    const throttleTime = (throttleEntries[0]!.ts as number);
    const afterThrottle = mock.inFlightHistory.filter((s) => s.time > throttleTime);
    if (afterThrottle.length > 0) {
      const maxAfter = Math.max(...afterThrottle.map((s) => s.value));
      expect(maxAfter).toBeLessThanOrEqual(1);
    }
  });

  it('costCap:0 + first call succeeds (post-call accounting) then serial', async () => {
    const findings = Array.from({ length: 4 }, (_, i) =>
      mockFinding({ id: `f.${i}` }),
    );
    const script: ScriptStep[] = findings.map(() => ({
      kind: 'respond',
      json: JSON.stringify({ verdict: 'confirmed', reasoning: 'ok' }),
    }));
    const mock = new MockEngine(codexMeta, script);
    mock.reportedCostPerCall = 0.0001;
    const policy = crossFamilyPolicyWithMock(mock);

    const { entries } = await captureLogsFor(
      { track: 'critic' },
      async () =>
        reviewBatch(findings, ctx(), policy, { costCap: 0, concurrency: 5 }),
    );

    // Throttle MUST fire (post-call check, costSoFar 0.0001 >= 0).
    const throttleEntries = entries.filter((e) => e.event === 'critic.cost-cap-throttle');
    expect(throttleEntries.length).toBeGreaterThanOrEqual(1);
    expect(mock.maxInFlight).toBeLessThanOrEqual(1);
  });
});

// ── B-3-3 — cost cap exhausted mid-batch ───────────────────────────────────

describe('B-3-3 — reviewBatch cost-cap exhausted mid-run', () => {
  it('suffix entries are critic-unavailable with reasoning cost-cap-exhausted', async () => {
    const findings = Array.from({ length: 10 }, (_, i) =>
      mockFinding({ id: `f.${i}` }),
    );
    // Provide enough script entries for ALL findings — verify only the
    // first 4 are actually invoked.
    const script: ScriptStep[] = findings.map(() => ({
      kind: 'respond',
      json: JSON.stringify({ verdict: 'confirmed', reasoning: 'ok' }),
    }));
    const mock = new MockEngine(codexMeta, script);
    mock.reportedCostPerCall = 0.005;
    const policy = crossFamilyPolicyWithMock(mock);

    const { result: results, entries } = await captureLogsFor(
      { track: 'critic' },
      async () =>
        reviewBatch(findings, ctx(), policy, {
          costCap: 0.02,
          concurrency: 1,
        }),
    );

    expect(results).toHaveLength(10);
    expect(results.slice(0, 4).every((r) => r.verdict === 'confirmed')).toBe(true);
    expect(
      results.slice(4).every(
        (r) =>
          r.verdict === 'critic-unavailable' &&
          r.reasoning === 'cost-cap-exhausted' &&
          r.critic === null,
      ),
    ).toBe(true);
    expect(mock.calls).toBe(4);

    const exhaustEntry = entries.find(
      (e) => e.event === 'critic.batch-cost-cap-exhausted',
    );
    expect(exhaustEntry).toBeDefined();
    expect(exhaustEntry?.remaining).toBe(6);
    expect(exhaustEntry?.costSoFar).toBe(0.02);
    expect(exhaustEntry?.costCap).toBe(0.02);

    const successEntry = entries.find((e) => e.event === 'critic.batch.success');
    expect(successEntry?.confirmed).toBe(4);
    expect(successEntry?.criticUnavailable).toBe(6);
    expect(successEntry?.total).toBe(10);
  });

  it('costCap higher than total cost runs all findings normally', async () => {
    const findings = Array.from({ length: 5 }, (_, i) =>
      mockFinding({ id: `f.${i}` }),
    );
    const script: ScriptStep[] = findings.map(() => ({
      kind: 'respond',
      json: JSON.stringify({ verdict: 'confirmed', reasoning: 'ok' }),
    }));
    const mock = new MockEngine(codexMeta, script);
    mock.reportedCostPerCall = 0.001;
    const policy = crossFamilyPolicyWithMock(mock);

    const { result: results, entries } = await captureLogsFor(
      { track: 'critic' },
      async () =>
        reviewBatch(findings, ctx(), policy, { costCap: 1.0 }),
    );

    expect(results).toHaveLength(5);
    expect(results.every((r) => r.verdict === 'confirmed')).toBe(true);
    expect(results.every((r) => r.critic !== null)).toBe(true);

    expect(
      entries.filter((e) => e.event === 'critic.cost-cap-throttle'),
    ).toHaveLength(0);
    expect(
      entries.filter((e) => e.event === 'critic.batch-cost-cap-exhausted'),
    ).toHaveLength(0);

    const successEntry = entries.find((e) => e.event === 'critic.batch.success');
    expect(successEntry?.criticUnavailable).toBe(0);
  });
});
