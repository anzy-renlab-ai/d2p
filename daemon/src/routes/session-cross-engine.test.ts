/**
 * Tests for /api/session/start cross-engine enforcement (v0.7 §3.1).
 *
 * The session route refuses POST /start with 412 E_CROSS_ENGINE_REQUIRED when
 * cross-engine reviewer policy is degraded. D2P_ALLOW_DEGRADED_REVIEWER=1 is a
 * test-only escape hatch — verified here both ways.
 *
 * We mock the engines/registry so we don't need to spin a real engine pool.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';

// Mock the registry BEFORE importing the route under test.
// The route's `crossEngineBlockedReason()` calls `currentCriticPolicy()`.
const mockPolicy = vi.hoisted(() => ({ current: null as null | { crossFamily: boolean; reason: string } }));
vi.mock('../engines/registry.js', () => ({
  currentCriticPolicy: () => mockPolicy.current,
}));

// Also mock heavy modules the route transitively imports so the test stays
// hermetic (no real DB, no real git probing).
vi.mock('../storage/db.js', () => ({ openDatabase: () => ({}), defaultDbPath: () => ':memory:' }));
vi.mock('../storage/migrations/index.js', () => ({ runMigrations: () => undefined }));
vi.mock('../storage/queries.js', () => ({
  Queries: class {
    upsertDemo() { return { id: 1, path: '/tmp/demo' }; }
    findActiveSessionForDemo() { return null; }
    getCurrentActiveSession() { return null; }
    insertSession() { return { id: 1, status: 'SETUP', startedAt: Date.now() }; }
    setDemoLastSession() {}
    insertLogEvent() { return { id: 1, ts: Date.now(), payload: {} }; }
    getLatestSession() { return null; }
  },
}));
vi.mock('../subproc/git.js', () => ({ git: vi.fn().mockResolvedValue({ exitCode: 0, stderr: '' }) }));
vi.mock('../log/sse.js', () => ({ sseHub: { publish: vi.fn() } }));

// Now import the route — it picks up the mocks above.
const { sessionRoutes } = await import('./session.js');

function buildApp() {
  const app = new Hono();
  app.route('/api/session', sessionRoutes);
  return app;
}

describe('POST /api/session/start cross-engine enforcement', () => {
  beforeEach(() => {
    mockPolicy.current = null;
    delete process.env.D2P_ALLOW_DEGRADED_REVIEWER;
  });
  afterEach(() => {
    delete process.env.D2P_ALLOW_DEGRADED_REVIEWER;
  });

  it('refuses 412 with E_CROSS_ENGINE_REQUIRED when no critic configured', async () => {
    mockPolicy.current = { crossFamily: false, reason: 'no-critic-configured' };
    const app = buildApp();
    const res = await app.fetch(new Request('http://localhost/api/session/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ demoPath: '/tmp/d2p-test-demo' }),
    }));
    expect(res.status).toBe(412);
    const body = (await res.json()) as { code: string; reason: string; detail: string };
    expect(body.code).toBe('E_CROSS_ENGINE_REQUIRED');
    expect(body.reason).toBe('no-critic-configured');
    expect(body.detail).toMatch(/criticEngine/);
  });

  it('refuses 412 when worker and critic share family', async () => {
    mockPolicy.current = { crossFamily: false, reason: 'same-family-as-worker' };
    const app = buildApp();
    const res = await app.fetch(new Request('http://localhost/api/session/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ demoPath: '/tmp/d2p-test-demo' }),
    }));
    expect(res.status).toBe(412);
    const body = (await res.json()) as { code: string; reason: string; detail: string };
    expect(body.code).toBe('E_CROSS_ENGINE_REQUIRED');
    expect(body.reason).toBe('same-family-as-worker');
    expect(body.detail).toMatch(/different family/);
  });

  it('does NOT refuse 412 when D2P_ALLOW_DEGRADED_REVIEWER=1 (test bypass)', async () => {
    mockPolicy.current = { crossFamily: false, reason: 'no-critic-configured' };
    process.env.D2P_ALLOW_DEGRADED_REVIEWER = '1';
    const app = buildApp();
    const res = await app.fetch(new Request('http://localhost/api/session/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ demoPath: '/tmp/d2p-test-demo' }),
    }));
    // We don't care exactly what 200/400/etc. — only that the 412 enforcement
    // is bypassed. Anything except 412 satisfies the contract.
    expect(res.status).not.toBe(412);
  });

  it('does NOT refuse 412 when cross-family is active', async () => {
    mockPolicy.current = { crossFamily: true, reason: 'cross-family-active' };
    const app = buildApp();
    const res = await app.fetch(new Request('http://localhost/api/session/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ demoPath: '/tmp/d2p-test-demo' }),
    }));
    expect(res.status).not.toBe(412);
  });

  it('does NOT refuse 412 when policy is null (engine not yet initialized)', async () => {
    mockPolicy.current = null;
    const app = buildApp();
    const res = await app.fetch(new Request('http://localhost/api/session/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ demoPath: '/tmp/d2p-test-demo' }),
    }));
    // Pre-bootstrap: let downstream code handle. We just verify the 412 gate
    // doesn't block legitimate cold-start scenarios.
    expect(res.status).not.toBe(412);
  });

  it('D2P_ALLOW_DEGRADED_REVIEWER must be exactly "1" — any other value blocks', async () => {
    mockPolicy.current = { crossFamily: false, reason: 'no-critic-configured' };
    process.env.D2P_ALLOW_DEGRADED_REVIEWER = 'true';
    const app = buildApp();
    const res = await app.fetch(new Request('http://localhost/api/session/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ demoPath: '/tmp/d2p-test-demo' }),
    }));
    expect(res.status).toBe(412);
  });
});
