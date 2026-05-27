/**
 * Phase 11 — side-by-side HTML diff renderer.
 *
 * Parses unified-diff text and emits HTML that lays out before/after lines in
 * two columns with line numbers. The render is intentionally simple:
 *
 *   - '-' lines occupy the LEFT column; the RIGHT column shows blank.
 *   - '+' lines occupy the RIGHT column; the LEFT column shows blank.
 *   - ' ' (context) lines appear on BOTH columns at the same row.
 *   - Adjacent '-' and '+' lines are paired into a single row so the user
 *     sees the "changed line" before / after on the same visual row.
 *   - Hunk headers (`@@ ... @@`) become a context-gap separator row.
 *   - Lines that look like our own truncation marker
 *     (`[... N lines omitted ...]`) are passed through as a special row.
 *
 * Why not Myers? Unified diffs already carry the alignment we need. The
 * pairing heuristic above is what every "split view" implementation does
 * (diff2html, GitLab, GitHub) for a single-line edit.
 *
 * Authority: D:\lll\d2p\docs\reviews\2026-05-27-presentation-layer.md
 */

export interface SxsRow {
  /** Left column source line number, or null when blank. */
  leftNo: number | null;
  /** Right column source line number, or null when blank. */
  rightNo: number | null;
  /** Left column text (already HTML-escaped if you used escapeHtml on input). */
  left: string;
  /** Right column text. */
  right: string;
  /** Classification per side: 'removed' | 'added' | 'unchanged' | 'blank'. */
  leftKind: 'removed' | 'added' | 'unchanged' | 'blank';
  rightKind: 'removed' | 'added' | 'unchanged' | 'blank';
  /** Whole-row marker (rendered full-width). */
  marker?: { kind: 'hunk' | 'context-gap' | 'truncation'; text: string };
}

interface HunkHeader {
  leftStart: number;
  leftCount: number;
  rightStart: number;
  rightCount: number;
  raw: string;
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const TRUNCATION_RE = /^\[\.\.\. \d+ lines omitted \.\.\.\]$/;

/**
 * Parse unified-diff text into side-by-side rows.
 *
 * Pre-condition: the caller is responsible for trimming the diff header
 * (`diff --git`, `---`, `+++`) if they want a cleaner output. This function
 * tolerates those lines and renders them as ignored / file-header markers
 * (we suppress them rather than show them in either column).
 */
export function parseDiffToRows(unifiedDiff: string): SxsRow[] {
  if (!unifiedDiff || unifiedDiff.length === 0) return [];

  const rawLines = unifiedDiff.split(/\r?\n/);
  // Drop trailing empty produced by trailing newline split.
  if (rawLines.length > 0 && rawLines[rawLines.length - 1] === '') rawLines.pop();

  const rows: SxsRow[] = [];

  let hunk: HunkHeader | null = null;
  let leftLineNo = 0;
  let rightLineNo = 0;

  // Pending '-' run that we may pair with subsequent '+' lines.
  let pendingDel: { lineNo: number; text: string }[] = [];

  const flushPending = (): void => {
    for (const d of pendingDel) {
      rows.push({
        leftNo: d.lineNo,
        rightNo: null,
        left: d.text,
        right: '',
        leftKind: 'removed',
        rightKind: 'blank',
      });
    }
    pendingDel = [];
  };

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i] ?? '';

    // Skip git diff metadata header lines — they aren't real diff body.
    if (
      line.startsWith('diff --git ') ||
      line.startsWith('index ') ||
      line.startsWith('--- ') ||
      line.startsWith('+++ ') ||
      line.startsWith('new file mode') ||
      line.startsWith('deleted file mode') ||
      line.startsWith('old mode') ||
      line.startsWith('new mode') ||
      line.startsWith('rename from ') ||
      line.startsWith('rename to ') ||
      line.startsWith('similarity index ') ||
      line.startsWith('Binary files ') ||
      line.startsWith('\\ No newline at end of file')
    ) {
      continue;
    }

    // Hunk header.
    const m = HUNK_RE.exec(line);
    if (m) {
      flushPending();
      const leftStart = parseInt(m[1] ?? '1', 10);
      const leftCount = m[2] ? parseInt(m[2], 10) : 1;
      const rightStart = parseInt(m[3] ?? '1', 10);
      const rightCount = m[4] ? parseInt(m[4], 10) : 1;
      hunk = { leftStart, leftCount, rightStart, rightCount, raw: line };
      leftLineNo = leftStart;
      rightLineNo = rightStart;
      rows.push({
        leftNo: null,
        rightNo: null,
        left: '',
        right: '',
        leftKind: 'blank',
        rightKind: 'blank',
        marker: { kind: 'hunk', text: line },
      });
      continue;
    }

    if (!hunk) {
      // Pass-through: truncation marker we emit ourselves between hunks.
      if (TRUNCATION_RE.test(line.trim())) {
        rows.push({
          leftNo: null,
          rightNo: null,
          left: '',
          right: '',
          leftKind: 'blank',
          rightKind: 'blank',
          marker: { kind: 'truncation', text: line.trim() },
        });
      }
      // Otherwise: still in pre-hunk preamble; skip silently.
      continue;
    }

    if (line.startsWith('-')) {
      pendingDel.push({ lineNo: leftLineNo, text: line.slice(1) });
      leftLineNo++;
      continue;
    }

    if (line.startsWith('+')) {
      // Pair with the head of pendingDel if any.
      if (pendingDel.length > 0) {
        const d = pendingDel.shift()!;
        rows.push({
          leftNo: d.lineNo,
          rightNo: rightLineNo,
          left: d.text,
          right: line.slice(1),
          leftKind: 'removed',
          rightKind: 'added',
        });
      } else {
        rows.push({
          leftNo: null,
          rightNo: rightLineNo,
          left: '',
          right: line.slice(1),
          leftKind: 'blank',
          rightKind: 'added',
        });
      }
      rightLineNo++;
      continue;
    }

    if (line.startsWith(' ') || line === '') {
      flushPending();
      const body = line.startsWith(' ') ? line.slice(1) : line;
      rows.push({
        leftNo: leftLineNo,
        rightNo: rightLineNo,
        left: body,
        right: body,
        leftKind: 'unchanged',
        rightKind: 'unchanged',
      });
      leftLineNo++;
      rightLineNo++;
      continue;
    }

    if (TRUNCATION_RE.test(line.trim())) {
      flushPending();
      rows.push({
        leftNo: null,
        rightNo: null,
        left: '',
        right: '',
        leftKind: 'blank',
        rightKind: 'blank',
        marker: { kind: 'truncation', text: line.trim() },
      });
      continue;
    }

    // Unknown line — render as context-gap marker.
    flushPending();
    rows.push({
      leftNo: null,
      rightNo: null,
      left: '',
      right: '',
      leftKind: 'blank',
      rightKind: 'blank',
      marker: { kind: 'context-gap', text: line },
    });
  }

  flushPending();
  return rows;
}

/**
 * HTML-escape a string. Use on user-controlled code text before it lands in
 * any HTML attribute or text node.
 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Render side-by-side rows as HTML. Wrap in a `<div class="diff-sxs">`.
 * The caller is responsible for the surrounding article + caption.
 */
export function renderDiffHtml(unifiedDiff: string): string {
  const rows = parseDiffToRows(unifiedDiff);
  if (rows.length === 0) {
    return '<div class="diff-sxs diff-empty">No diff content.</div>';
  }

  const parts: string[] = ['<div class="diff-sxs">'];
  for (const row of rows) {
    if (row.marker) {
      const cls = `diff-marker diff-marker-${row.marker.kind}`;
      parts.push(`<div class="${cls}">${escapeHtml(row.marker.text)}</div>`);
      continue;
    }
    const leftNoStr = row.leftNo === null ? '' : String(row.leftNo);
    const rightNoStr = row.rightNo === null ? '' : String(row.rightNo);
    parts.push(
      `<div class="diff-row">` +
        `<span class="lineno lineno-l">${leftNoStr}</span>` +
        `<span class="code code-l code-${row.leftKind}">${escapeHtml(row.left)}</span>` +
        `<span class="lineno lineno-r">${rightNoStr}</span>` +
        `<span class="code code-r code-${row.rightKind}">${escapeHtml(row.right)}</span>` +
        `</div>`,
    );
  }
  parts.push('</div>');
  return parts.join('');
}
