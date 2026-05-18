import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from './migrations/index.js';
import { Queries } from './queries.js';
import { PRICING_PER_MTOK } from '../cost/pricing.js';

function setup() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return { db, q: new Queries(db) };
}

describe('Queries: demos & sessions', () => {
  it('upserts a demo idempotently', () => {
    const { q } = setup();
    const p = process.platform === 'win32' ? 'D:\\demo' : '/demo';
    const a = q.upsertDemo(p);
    const b = q.upsertDemo(p);
    expect(a.id).toBe(b.id);
  });

  it('returns active session on resume', () => {
    const { q } = setup();
    const p = process.platform === 'win32' ? 'D:\\demo' : '/demo';
    const demo = q.upsertDemo(p);
    const s = q.insertSession(demo.id);
    const active = q.findActiveSessionForDemo(demo.id);
    expect(active?.id).toBe(s.id);
  });

  it('respects session state machine', () => {
    const { q } = setup();
    const p = process.platform === 'win32' ? 'D:\\demo' : '/demo';
    const demo = q.upsertDemo(p);
    const s = q.insertSession(demo.id);
    q.setSessionPresetType(s.id, 'saas-web');
    q.transitionSession(s.id, 'LOOPING');
    expect(q.getSession(s.id)?.status).toBe('LOOPING');
    expect(() => q.transitionSession(s.id, 'SETUP')).toThrow();
  });
});

describe('Queries: gaps', () => {
  it('picks head gap by severity then created_at', async () => {
    const { q } = setup();
    const p = process.platform === 'win32' ? 'D:\\demo' : '/demo';
    const demo = q.upsertDemo(p);
    const s = q.insertSession(demo.id);
    q.insertGap({
      sessionId: s.id,
      slug: 'a-p2',
      title: 't',
      body: 'b',
      category: 'misc',
      severity: 'P2',
      source: 'preset',
      suggestedApproach: 'a',
      expectedFilesChanged: [],
      parentGapId: null,
    });
    // ensure distinct created_at via tiny await
    await new Promise((r) => setTimeout(r, 5));
    q.insertGap({
      sessionId: s.id,
      slug: 'b-p1',
      title: 't',
      body: 'b',
      category: 'misc',
      severity: 'P1',
      source: 'preset',
      suggestedApproach: 'a',
      expectedFilesChanged: [],
      parentGapId: null,
    });
    const head = q.pickHeadGap(s.id);
    expect(head?.slug).toBe('b-p1');
  });

  it('transitions gap PENDING -> IN_PROGRESS -> DONE', () => {
    const { q } = setup();
    const p = process.platform === 'win32' ? 'D:\\demo' : '/demo';
    const demo = q.upsertDemo(p);
    const s = q.insertSession(demo.id);
    const g = q.insertGap({
      sessionId: s.id,
      slug: 'x',
      title: 't',
      body: 'b',
      category: 'misc',
      severity: 'P1',
      source: 'preset',
      suggestedApproach: 'a',
      expectedFilesChanged: [],
      parentGapId: null,
    });
    q.transitionGap(g.id, 'IN_PROGRESS');
    q.transitionGap(g.id, 'DONE');
    expect(() => q.transitionGap(g.id, 'IN_PROGRESS')).toThrow();
  });

  it('history excludes pending gaps', () => {
    const { q } = setup();
    const p = process.platform === 'win32' ? 'D:\\demo' : '/demo';
    const demo = q.upsertDemo(p);
    const s = q.insertSession(demo.id);
    const g1 = q.insertGap({
      sessionId: s.id,
      slug: 'pending',
      title: 't',
      body: 'b',
      category: 'misc',
      severity: 'P1',
      source: 'preset',
      suggestedApproach: 'a',
      expectedFilesChanged: [],
      parentGapId: null,
    });
    const g2 = q.insertGap({
      sessionId: s.id,
      slug: 'done',
      title: 't',
      body: 'b',
      category: 'misc',
      severity: 'P1',
      source: 'preset',
      suggestedApproach: 'a',
      expectedFilesChanged: [],
      parentGapId: null,
    });
    q.transitionGap(g2.id, 'IN_PROGRESS');
    q.transitionGap(g2.id, 'DONE');
    const hist = q.doneGapHistory(s.id);
    expect(hist.map((h) => h.slug)).toEqual(['done']);
    void g1;
  });
});

describe('Queries: preset status + cost', () => {
  it('isPresetAllDone false on empty', () => {
    const { q } = setup();
    const p = process.platform === 'win32' ? 'D:\\demo' : '/demo';
    const demo = q.upsertDemo(p);
    const s = q.insertSession(demo.id);
    expect(q.isPresetAllDone(s.id)).toBe(false);
  });

  it('isPresetAllDone true when all done', () => {
    const { q } = setup();
    const p = process.platform === 'win32' ? 'D:\\demo' : '/demo';
    const demo = q.upsertDemo(p);
    const s = q.insertSession(demo.id);
    q.setPresetStatus(s.id, [
      { item: 'a', status: 'done', note: null },
      { item: 'b', status: 'done', note: null },
    ]);
    expect(q.isPresetAllDone(s.id)).toBe(true);
  });

  it('costTotals sums token usage and estimates USD', () => {
    const { q } = setup();
    const p = process.platform === 'win32' ? 'D:\\demo' : '/demo';
    const demo = q.upsertDemo(p);
    const s = q.insertSession(demo.id);
    q.insertCostRecord(s.id, 'differ', 'sonnet', 1_000_000, 100_000);
    const t = q.costTotals(s.id, PRICING_PER_MTOK);
    expect(t.inputTokens).toBe(1_000_000);
    expect(t.outputTokens).toBe(100_000);
    expect(t.estimatedUsd).toBeGreaterThan(0);
  });

  it('costAttribution groups per (role × engine) and surfaces cache tokens', () => {
    const { q } = setup();
    const p = process.platform === 'win32' ? 'D:\\demo-attr' : '/demo-attr';
    const demo = q.upsertDemo(p);
    const s = q.insertSession(demo.id);
    q.insertCostRecord(s.id, 'implementer', 'sonnet', 500_000, 50_000, 'claude-cli',   300_000, 0);
    q.insertCostRecord(s.id, 'implementer', 'sonnet', 200_000, 20_000, 'claude-cli',   100_000, 0);
    q.insertCostRecord(s.id, 'alignment',   'haiku',  100_000, 10_000, 'minimax',       40_000, 0);
    q.insertCostRecord(s.id, 'differ',      'sonnet',  50_000,  5_000, 'claude-cli',         0, 0);
    const buckets = q.costAttribution(s.id, PRICING_PER_MTOK);
    // We expect (implementer/claude-cli), (alignment/minimax), (differ/claude-cli)
    expect(buckets).toHaveLength(3);
    const imp = buckets.find((b) => b.role === 'implementer');
    expect(imp).toBeDefined();
    expect(imp!.inputTokens).toBe(700_000);
    expect(imp!.cacheReadTokens).toBe(400_000);
    expect(imp!.engine).toBe('claude-cli');
    const align = buckets.find((b) => b.role === 'alignment');
    expect(align?.engine).toBe('minimax');
    expect(align?.cacheReadTokens).toBe(40_000);
  });
});
