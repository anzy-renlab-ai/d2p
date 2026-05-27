/**
 * Tests for enhance/html-diff.ts (Phase 11 side-by-side diff renderer).
 */
import { describe, it, expect } from 'vitest';
import { parseDiffToRows, renderDiffHtml, escapeHtml } from './html-diff.js';

describe('escapeHtml', () => {
  it('escapes <, >, &, ", \'', () => {
    expect(escapeHtml('<a href="x">&\'</a>')).toBe(
      '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;',
    );
  });
  it('preserves Unicode', () => {
    expect(escapeHtml('日本語 — résumé')).toBe('日本語 — résumé');
  });
});

describe('parseDiffToRows', () => {
  it('empty diff → empty body', () => {
    expect(parseDiffToRows('')).toEqual([]);
  });

  it('1 hunk all additions → rows have added on right, blank on left', () => {
    const diff = '@@ -0,0 +1,2 @@\n+const foo = 1;\n+const bar = 2;\n';
    const rows = parseDiffToRows(diff);
    // Skip the hunk marker row.
    const body = rows.filter((r) => !r.marker);
    expect(body).toHaveLength(2);
    expect(body[0]?.rightKind).toBe('added');
    expect(body[0]?.leftKind).toBe('blank');
    expect(body[0]?.right).toBe('const foo = 1;');
    expect(body[0]?.leftNo).toBeNull();
    expect(body[0]?.rightNo).toBe(1);
    expect(body[1]?.rightNo).toBe(2);
  });

  it('1 hunk all removals → rows have removed on left', () => {
    const diff = '@@ -1,2 +0,0 @@\n-const foo = 1;\n-const bar = 2;\n';
    const rows = parseDiffToRows(diff).filter((r) => !r.marker);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.leftKind).toBe('removed');
    expect(rows[0]?.rightKind).toBe('blank');
    expect(rows[0]?.left).toBe('const foo = 1;');
    expect(rows[0]?.leftNo).toBe(1);
    expect(rows[1]?.leftNo).toBe(2);
  });

  it('paired -/+ lines become single side-by-side row', () => {
    const diff = '@@ -1,1 +1,1 @@\n-old line\n+new line\n';
    const rows = parseDiffToRows(diff).filter((r) => !r.marker);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.left).toBe('old line');
    expect(rows[0]?.right).toBe('new line');
    expect(rows[0]?.leftKind).toBe('removed');
    expect(rows[0]?.rightKind).toBe('added');
  });

  it('context lines appear on both sides', () => {
    const diff = '@@ -1,3 +1,3 @@\n unchanged\n-old\n+new\n unchanged after\n';
    const rows = parseDiffToRows(diff).filter((r) => !r.marker);
    expect(rows).toHaveLength(3);
    expect(rows[0]?.leftKind).toBe('unchanged');
    expect(rows[0]?.rightKind).toBe('unchanged');
    expect(rows[0]?.left).toBe('unchanged');
    expect(rows[0]?.right).toBe('unchanged');
    expect(rows[2]?.left).toBe('unchanged after');
  });

  it('multi-hunk emits two hunk markers + truncation marker between', () => {
    const diff =
      '@@ -1,1 +1,1 @@\n unchanged-a\n[... 50 lines omitted ...]\n@@ -100,1 +100,1 @@\n-old\n+new\n';
    const rows = parseDiffToRows(diff);
    const markers = rows.filter((r) => r.marker);
    expect(markers.length).toBeGreaterThanOrEqual(2);
    expect(markers.some((m) => m.marker?.kind === 'hunk')).toBe(true);
    // Truncation between hunks falls outside any hunk; tolerated by parser.
    expect(rows.some((r) => r.marker?.kind === 'truncation')).toBe(true);
  });

  it('line numbers correct on both sides', () => {
    const diff = '@@ -10,2 +20,3 @@\n unchanged\n-removed\n+added1\n+added2\n';
    const rows = parseDiffToRows(diff).filter((r) => !r.marker);
    // row 0: context — left 10 / right 20
    expect(rows[0]?.leftNo).toBe(10);
    expect(rows[0]?.rightNo).toBe(20);
    // row 1: pairs the removed (line 11) with the first +added (line 21)
    expect(rows[1]?.leftNo).toBe(11);
    expect(rows[1]?.rightNo).toBe(21);
    // row 2: orphan +added2 → left blank, right 22
    expect(rows[2]?.leftNo).toBeNull();
    expect(rows[2]?.rightNo).toBe(22);
  });

  it('drops git diff header lines (diff --git, ---, +++)', () => {
    const diff =
      'diff --git a/foo b/foo\nindex 1..2 100644\n--- a/foo\n+++ b/foo\n@@ -1,1 +1,1 @@\n-a\n+b\n';
    const rows = parseDiffToRows(diff).filter((r) => !r.marker);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.left).toBe('a');
    expect(rows[0]?.right).toBe('b');
  });

  it('handles CRLF line endings', () => {
    const diff = '@@ -1,1 +1,1 @@\r\n-old\r\n+new\r\n';
    const rows = parseDiffToRows(diff).filter((r) => !r.marker);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.left).toBe('old');
    expect(rows[0]?.right).toBe('new');
  });

  it('preserves Unicode in code', () => {
    const diff = '@@ -1,1 +1,1 @@\n-héllo\n+世界\n';
    const rows = parseDiffToRows(diff).filter((r) => !r.marker);
    expect(rows[0]?.left).toBe('héllo');
    expect(rows[0]?.right).toBe('世界');
  });

  it('renders truncation marker outside hunks', () => {
    const diff = '[... 200 lines omitted ...]';
    const rows = parseDiffToRows(diff);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.marker?.kind).toBe('truncation');
  });
});

describe('renderDiffHtml', () => {
  it('empty diff returns empty placeholder', () => {
    const out = renderDiffHtml('');
    expect(out).toContain('diff-empty');
  });

  it('escapes special chars in code', () => {
    const diff = '@@ -1,1 +1,1 @@\n-<script>alert(1)</script>\n+&amp;\n';
    const out = renderDiffHtml(diff);
    expect(out).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(out).toContain('&amp;amp;'); // & in code → &amp;, then escaped to &amp;amp;
    expect(out).not.toContain('<script>alert(1)</script>');
  });

  it('emits diff-row spans with code-added / code-removed classes', () => {
    const diff = '@@ -1,1 +1,1 @@\n-old\n+new\n';
    const out = renderDiffHtml(diff);
    expect(out).toContain('code-removed');
    expect(out).toContain('code-added');
    expect(out).toContain('class="diff-sxs"');
  });

  it('hunk marker rendered as diff-marker-hunk', () => {
    const diff = '@@ -1,0 +1,1 @@\n+foo\n';
    const out = renderDiffHtml(diff);
    expect(out).toContain('diff-marker-hunk');
  });
});
