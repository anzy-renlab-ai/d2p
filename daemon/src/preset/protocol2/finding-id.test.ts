import { describe, it, expect } from 'vitest';
import { buildFindingId } from './finding-id.js';

describe('buildFindingId', () => {
  // T-5-1-1 (covers B-5-1)
  it('returns identical id on repeated calls with the same inputs', () => {
    const input = {
      presetId: 'x',
      ruleId: 'r',
      file: 'a.ts',
      line: 10,
      evidence: 'foo',
    } as const;
    const a = buildFindingId(input);
    const b = buildFindingId({ ...input });
    expect(a.id).toBe(b.id);
    expect(a.id).toMatch(/^x\.[0-9a-f]{8}$/);
    expect(a.matched_content_normalized).toBe('foo');
    expect(a.matched_content_normalized).toBe(b.matched_content_normalized);
  });

  // T-5-1-2 (covers B-5-1, whitespace normalization)
  it('yields identical id when evidence differs only by whitespace/case', () => {
    const a = buildFindingId({
      presetId: 'x',
      ruleId: 'r',
      file: 'a.ts',
      line: 10,
      evidence: 'Foo Bar',
    });
    const b = buildFindingId({
      presetId: 'x',
      ruleId: 'r',
      file: 'a.ts',
      line: 10,
      evidence: 'foo\tbar',
    });
    expect(a.matched_content_normalized).toBe('foobar');
    expect(b.matched_content_normalized).toBe('foobar');
    expect(a.id).toBe(b.id);
  });

  // T-5-2-2 (covers B-5-2, line-shift caveat)
  it('is line-sensitive: changing line number changes id', () => {
    const a = buildFindingId({
      presetId: 'x',
      ruleId: 'r',
      file: 'a.ts',
      line: 10,
      evidence: 'foo',
    });
    const b = buildFindingId({
      presetId: 'x',
      ruleId: 'r',
      file: 'a.ts',
      line: 11,
      evidence: 'foo',
    });
    expect(a.id).not.toBe(b.id);
    expect(a.matched_content_normalized).toBe(b.matched_content_normalized);
  });

  it('different ruleId yields different id', () => {
    const a = buildFindingId({ presetId: 'x', ruleId: 'r1', file: 'a.ts', line: 1, evidence: 'foo' });
    const b = buildFindingId({ presetId: 'x', ruleId: 'r2', file: 'a.ts', line: 1, evidence: 'foo' });
    expect(a.id).not.toBe(b.id);
  });

  it('different file yields different id', () => {
    const a = buildFindingId({ presetId: 'x', ruleId: 'r', file: 'a.ts', line: 1, evidence: 'foo' });
    const b = buildFindingId({ presetId: 'x', ruleId: 'r', file: 'b.ts', line: 1, evidence: 'foo' });
    expect(a.id).not.toBe(b.id);
  });
});
