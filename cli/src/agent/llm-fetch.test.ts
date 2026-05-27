/**
 * Tests for agent/llm-fetch — consolidated OpenAI-compat fetcher with retry.
 *
 * Phase 11.1 — Audit Parallelization. Tests use injected mock fetchImpl +
 * sleepImpl so they never hit a real network and never burn real wall time.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fetchLlm } from './llm-fetch.js';
import {
  createTrackLogger,
  captureLogsFor,
  __resetMetaLoggersForTests,
  __resetLiveLoggersForTests,
  __resetRotationGateForTests,
} from '../log-types.js';

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

function mkEnvelope(content: string): string {
  return JSON.stringify({
    choices: [{ message: { content } }],
  });
}

function mkResponse(
  status: number,
  body: string,
  headers: Record<string, string> = {},
): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

// Mock sleep that records delays but doesn't actually wait.
function mkSleep(): { delays: number[]; impl: (ms: number) => Promise<void> } {
  const delays: number[] = [];
  return {
    delays,
    impl: (ms: number) => {
      delays.push(ms);
      return Promise.resolve();
    },
  };
}

const ARGS_BASE = {
  url: 'https://example.test/v1/chat/completions',
  apiKey: 'sk-test',
  model: 'fake-model',
  systemPrompt: 'sys',
  userPrompt: 'usr',
  timeoutMs: 5_000,
};

describe('fetchLlm', () => {
  it('returns ok on 200 with attempts=1', async () => {
    const out = await fetchLlm({
      ...ARGS_BASE,
      fetchImpl: async () => mkResponse(200, mkEnvelope('hello')),
      sleepImpl: mkSleep().impl,
    });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.rawText).toBe('hello');
      expect(out.attempts).toBe(1);
    }
  });

  it('retries on 429 then succeeds (attempts=2)', async () => {
    let calls = 0;
    const sleep = mkSleep();
    const out = await fetchLlm({
      ...ARGS_BASE,
      fetchImpl: async () => {
        calls++;
        if (calls === 1) return mkResponse(429, 'rate limited');
        return mkResponse(200, mkEnvelope('ok'));
      },
      sleepImpl: sleep.impl,
    });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.attempts).toBe(2);
    }
    expect(sleep.delays.length).toBe(1);
    expect(calls).toBe(2);
  });

  it('5xx 3 times → fail with attempts=3', async () => {
    let calls = 0;
    const sleep = mkSleep();
    const out = await fetchLlm({
      ...ARGS_BASE,
      fetchImpl: async () => {
        calls++;
        return mkResponse(503, 'svc unavail');
      },
      sleepImpl: sleep.impl,
    });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.attempts).toBe(3);
      expect(out.statusCode).toBe(503);
    }
    expect(calls).toBe(3);
    expect(sleep.delays.length).toBe(2); // sleep BETWEEN attempts only
  });

  it('4xx (non-429) fails fast with attempts=1', async () => {
    let calls = 0;
    const sleep = mkSleep();
    const out = await fetchLlm({
      ...ARGS_BASE,
      fetchImpl: async () => {
        calls++;
        return mkResponse(401, 'unauthorized');
      },
      sleepImpl: sleep.impl,
    });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.attempts).toBe(1);
      expect(out.statusCode).toBe(401);
    }
    expect(calls).toBe(1);
    expect(sleep.delays.length).toBe(0);
  });

  it('honors Retry-After (seconds) header on 429', async () => {
    let calls = 0;
    const sleep = mkSleep();
    const out = await fetchLlm({
      ...ARGS_BASE,
      fetchImpl: async () => {
        calls++;
        if (calls === 1) return mkResponse(429, 'rate', { 'retry-after': '2' });
        return mkResponse(200, mkEnvelope('ok'));
      },
      sleepImpl: sleep.impl,
    });
    expect(out.ok).toBe(true);
    // Retry-After: 2 → 2000ms
    expect(sleep.delays[0]).toBe(2000);
  });

  it('aborts mid-attempt via AbortSignal', async () => {
    const ctl = new AbortController();
    ctl.abort();
    const out = await fetchLlm({
      ...ARGS_BASE,
      signal: ctl.signal,
      fetchImpl: async () => mkResponse(200, mkEnvelope('never')),
      sleepImpl: mkSleep().impl,
    });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error).toMatch(/abort/i);
    }
  });

  it('retries on network error then succeeds', async () => {
    let calls = 0;
    const sleep = mkSleep();
    const out = await fetchLlm({
      ...ARGS_BASE,
      fetchImpl: async () => {
        calls++;
        if (calls === 1) throw new Error('ECONNRESET');
        return mkResponse(200, mkEnvelope('recovered'));
      },
      sleepImpl: sleep.impl,
    });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.attempts).toBe(2);
      expect(out.rawText).toBe('recovered');
    }
    expect(sleep.delays.length).toBe(1);
  });

  it('returns ok=false when envelope is not JSON', async () => {
    const out = await fetchLlm({
      ...ARGS_BASE,
      fetchImpl: async () => mkResponse(200, 'not-json-at-all'),
      sleepImpl: mkSleep().impl,
    });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error).toMatch(/envelope/i);
    }
  });

  it('returns ok=false when content field is missing', async () => {
    const out = await fetchLlm({
      ...ARGS_BASE,
      fetchImpl: async () => mkResponse(200, JSON.stringify({ choices: [] })),
      sleepImpl: mkSleep().impl,
    });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error).toMatch(/missing/i);
    }
  });

  it('fails (no infinite retry) when all attempts time out', async () => {
    let calls = 0;
    const sleep = mkSleep();
    const out = await fetchLlm({
      ...ARGS_BASE,
      retry: { maxAttempts: 2 },
      fetchImpl: async () => {
        calls++;
        const e = new Error('TimeoutError');
        e.name = 'TimeoutError';
        throw e;
      },
      sleepImpl: sleep.impl,
    });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.attempts).toBe(2);
    }
    expect(calls).toBe(2);
  });

  it('emits attempt.start / attempt.success events on the logger', async () => {
    const logger = createTrackLogger('agent', { silent: true, minLevel: 'debug' });
    const { entries } = await captureLogsFor(
      { track: 'agent', eventPattern: /^agent\.llm-fetch\./ },
      async () =>
        fetchLlm({
          ...ARGS_BASE,
          logger,
          branchPrefix: 'agent.llm-fetch',
          fetchImpl: async () => mkResponse(200, mkEnvelope('ok')),
          sleepImpl: mkSleep().impl,
        }),
    );
    const events = entries.map((e) => e.event);
    expect(events).toContain('agent.llm-fetch.attempt.start');
    expect(events).toContain('agent.llm-fetch.attempt.success');
  });

  it('emits attempt.retry on retryable failure', async () => {
    const logger = createTrackLogger('agent', { silent: true, minLevel: 'debug' });
    let n = 0;
    const { entries } = await captureLogsFor(
      { track: 'agent', eventPattern: /^agent\.llm-fetch\./ },
      async () =>
        fetchLlm({
          ...ARGS_BASE,
          logger,
          branchPrefix: 'agent.llm-fetch',
          fetchImpl: async () => {
            n++;
            if (n === 1) return mkResponse(500, 'err');
            return mkResponse(200, mkEnvelope('ok'));
          },
          sleepImpl: mkSleep().impl,
        }),
    );
    const events = entries.map((e) => e.event);
    expect(events).toContain('agent.llm-fetch.attempt.retry');
  });

  it('default branchPrefix is agent.llm-fetch when omitted', async () => {
    const logger = createTrackLogger('agent', { silent: true, minLevel: 'debug' });
    const { entries } = await captureLogsFor(
      { track: 'agent', eventPattern: /^agent\.llm-fetch\./ },
      async () =>
        fetchLlm({
          ...ARGS_BASE,
          logger,
          fetchImpl: async () => mkResponse(200, mkEnvelope('ok')),
          sleepImpl: mkSleep().impl,
        }),
    );
    const events = entries.map((e) => e.event);
    expect(events.some((e) => e.startsWith('agent.llm-fetch.'))).toBe(true);
  });
});
