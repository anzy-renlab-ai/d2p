/**
 * Phase 19 — static-grep line-precision tests.
 *
 * Covers the new `scanLinePattern` / `scanMultilinePattern` helpers and
 * the sink-anchor heuristic that drives multi-line finding precision.
 */
import { describe, expect, it } from 'vitest';
import { scanLinePattern, scanMultilinePattern } from './stubs.js';

describe('scanLinePattern', () => {
  it('reports 1-based line and col for the regex match', () => {
    const text = ['const a = 1;', "const key = 'sk_live_ABCDEFGHIJKLMNOPQR';"].join('\n');
    const out = scanLinePattern(text, /sk_live_[A-Za-z0-9]{16,}/);
    expect(out).toHaveLength(1);
    expect(out[0]!.line).toBe(2);
    // col index of "sk_live_" inside the line — text is `const key = '<here>`
    expect(out[0]!.col).toBeGreaterThan(10);
    expect(out[0]!.anchor).toBe('start');
    expect(out[0]!.evidence.startsWith('sk_live_')).toBe(true);
  });

  it('reports one match per line max (legacy single-line behaviour)', () => {
    const text = 'foo bar baz\nfoo qux\nnothing here\n';
    const out = scanLinePattern(text, /foo/);
    expect(out.map((m) => m.line)).toEqual([1, 2]);
  });

  it('skips lines with no match', () => {
    const text = 'apple\nbanana\ncherry';
    const out = scanLinePattern(text, /xyz/);
    expect(out).toEqual([]);
  });
});

describe('scanMultilinePattern — sink anchoring', () => {
  it('anchors a multi-line match to the SINK line, not the wrapping construct', () => {
    // Bug pattern: try { res.send(userInput) } — sink is res.send on line 3,
    // wrapping `try` is on line 1. Naive line-by-line scan would have reported
    // line 1; sink anchor should report line 3.
    const text = [
      '  try {',                           // line 1
      '    const x = userInput;',          // line 2
      '    res.send(x);',                  // line 3 — sink
      '  } catch (e) {}',                  // line 4
    ].join('\n');
    // Multi-line pattern that spans `try` through the catch.
    const re = new RegExp('try\\s*\\{[\\s\\S]*?\\}\\s*catch', 'gm');
    const out = scanMultilinePattern(text, re);
    expect(out).toHaveLength(1);
    expect(out[0]!.anchor).toBe('sink');
    expect(out[0]!.line).toBe(3); // res.send line, not `try` line
  });

  it('falls back to end-of-match line when no sink token is present', () => {
    const text = ['if (a) {', '  let b = 1;', '  let c = 2;', '}'].join('\n');
    const re = new RegExp('if\\s*\\([^)]+\\)\\s*\\{[\\s\\S]*?\\}', 'gm');
    const out = scanMultilinePattern(text, re);
    expect(out).toHaveLength(1);
    expect(out[0]!.anchor).toBe('end');
    // Match ends at the closing `}` on line 4. The anchor offset puts us at
    // the line containing the closing brace.
    expect(out[0]!.line).toBe(4);
  });

  it('finds multiple matches with /g flag', () => {
    const text = [
      'res.send(a);',
      'res.send(b);',
      'console.log("ok");',
      'res.send(c);',
    ].join('\n');
    const re = new RegExp('res\\.send\\(', 'g');
    const out = scanMultilinePattern(text, re);
    expect(out.map((m) => m.line)).toEqual([1, 2, 4]);
  });

  it('reports col on the anchored line', () => {
    const text = ['try {', '    eval(userCode);', '} catch (e) {}'].join('\n');
    const re = new RegExp('try\\s*\\{[\\s\\S]*?\\}\\s*catch', 'gm');
    const out = scanMultilinePattern(text, re);
    expect(out[0]!.line).toBe(2);
    // `eval(` should be near col 5 (4 leading spaces + 1-based)
    expect(out[0]!.col).toBeGreaterThanOrEqual(4);
    expect(out[0]!.col).toBeLessThanOrEqual(6);
  });

  it('truncates very long evidence to keep findings compact', () => {
    const text = 'eval(' + 'x'.repeat(500) + ')';
    const re = new RegExp('eval\\([\\s\\S]+\\)', 'g');
    const out = scanMultilinePattern(text, re);
    expect(out).toHaveLength(1);
    expect(out[0]!.evidence.length).toBeLessThanOrEqual(240);
    expect(out[0]!.evidence.endsWith('...')).toBe(true);
  });

  it('does not infinite-loop on zero-width matches', () => {
    const text = 'aaa';
    const re = new RegExp('(?=a)', 'g');
    const out = scanMultilinePattern(text, re);
    // Zero-width matches contribute nothing useful; we should bail safely.
    expect(out).toEqual([]);
  });
});
