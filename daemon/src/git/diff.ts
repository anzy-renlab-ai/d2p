/**
 * parseDiff — shell-out git diff and parse the unified patch format into
 * structured FileDiff[].
 *
 * Supports: modified, added, deleted, renamed files + binary files.
 * Uses --find-renames to detect renames.
 */

import { git } from '../subproc/git.js';
import type { FileDiff, Hunk, DiffLine, FileStatus } from '../types.js';

// ─── Hunk header regex  @@  -oldStart,oldLines +newStart,newLines @@ ──────

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)/;

// ─── diff --git header regexes ────────────────────────────────────────────

const DIFF_HEADER_RE = /^diff --git a\/(.+) b\/(.+)$/;
const RENAME_FROM_RE = /^rename from (.+)$/;
const RENAME_TO_RE = /^rename to (.+)$/;
const NEW_FILE_RE = /^new file mode/;
const DELETED_FILE_RE = /^deleted file mode/;
const BINARY_RE = /^Binary files/;
const INDEX_RE = /^index /;
const OLD_FILE_RE = /^--- /;
const NEW_FILE_HDR_RE = /^\+\+\+ /;

/**
 * Parse the output of `git diff fromSha..toSha --unified=3 --find-renames`
 * into structured FileDiff[].
 */
export function parsePatch(patchText: string): FileDiff[] {
  const lines = patchText.split('\n');
  const files: FileDiff[] = [];

  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    // Look for "diff --git" header line
    const headerMatch = DIFF_HEADER_RE.exec(line);
    if (!headerMatch) {
      i++;
      continue;
    }

    // aPath is the left side, bPath is the right side
    const aPath = headerMatch[1]!;
    const bPath = headerMatch[2]!;

    let status: FileStatus = 'modified';
    let oldPath: string | null = null;
    let binary = false;
    let renameFrom: string | null = null;
    let renameTo: string | null = null;
    let isNew = false;
    let isDeleted = false;

    i++;

    // Consume metadata lines until we hit a hunk @@ or next diff --git
    while (i < lines.length) {
      const ml = lines[i]!;
      if (DIFF_HEADER_RE.test(ml)) break;
      if (HUNK_RE.test(ml)) break;

      if (NEW_FILE_RE.test(ml)) {
        isNew = true;
      } else if (DELETED_FILE_RE.test(ml)) {
        isDeleted = true;
      } else if (BINARY_RE.test(ml)) {
        binary = true;
      }

      const renFrom = RENAME_FROM_RE.exec(ml);
      if (renFrom) renameFrom = renFrom[1]!;

      const renTo = RENAME_TO_RE.exec(ml);
      if (renTo) renameTo = renTo[1]!;

      i++;
    }

    // Determine status
    if (renameFrom && renameTo) {
      status = 'renamed';
      oldPath = renameFrom;
    } else if (isNew) {
      status = 'added';
    } else if (isDeleted) {
      status = 'deleted';
    } else {
      status = 'modified';
    }

    const filePath = renameTo ?? bPath;

    if (binary) {
      files.push({
        path: filePath,
        status,
        oldPath,
        insertions: 0,
        deletions: 0,
        binary: true,
        hunks: [],
      });
      continue;
    }

    // Parse hunks
    const hunks: Hunk[] = [];
    let insertions = 0;
    let deletions = 0;

    while (i < lines.length) {
      const hl = lines[i]!;
      if (DIFF_HEADER_RE.test(hl)) break;

      const hunkMatch = HUNK_RE.exec(hl);
      if (!hunkMatch) {
        // Lines like "--- a/..." or "+++ b/..." or "index ..." — skip
        i++;
        continue;
      }

      const oldStart = parseInt(hunkMatch[1]!, 10);
      const oldLines = hunkMatch[2] !== undefined ? parseInt(hunkMatch[2], 10) : 1;
      const newStart = parseInt(hunkMatch[3]!, 10);
      const newLines = hunkMatch[4] !== undefined ? parseInt(hunkMatch[4], 10) : 1;
      const header = hl;

      i++;

      const diffLines: DiffLine[] = [];
      let oldLineNo = oldStart;
      let newLineNo = newStart;

      // Consume hunk body lines
      while (i < lines.length) {
        const dl = lines[i]!;
        if (DIFF_HEADER_RE.test(dl)) break;
        if (HUNK_RE.test(dl)) break;

        if (dl.startsWith('+')) {
          diffLines.push({ type: 'add', text: dl.slice(1), oldLineNo: null, newLineNo: newLineNo++ });
          insertions++;
        } else if (dl.startsWith('-')) {
          diffLines.push({ type: 'del', text: dl.slice(1), oldLineNo: oldLineNo++, newLineNo: null });
          deletions++;
        } else if (dl.startsWith(' ')) {
          diffLines.push({ type: 'context', text: dl.slice(1), oldLineNo: oldLineNo++, newLineNo: newLineNo++ });
        } else if (dl === '\\ No newline at end of file') {
          // annotation — skip but don't break
        } else if (dl === '') {
          // empty line within hunk body — treat as context if we expect more lines
        }
        // else: unexpected line; skip

        i++;
      }

      hunks.push({ header, oldStart, oldLines, newStart, newLines, lines: diffLines });
    }

    files.push({
      path: filePath,
      status,
      oldPath,
      insertions,
      deletions,
      binary: false,
      hunks,
    });
  }

  return files;
}

/**
 * Shell-out git diff fromSha..toSha --unified=3 --find-renames for the given
 * worktreeRoot and parse the result into FileDiff[].
 *
 * @param worktreeRoot  Absolute path to git working directory
 * @param fromSha       Base commit SHA (exclusive)
 * @param toSha         Head commit SHA (inclusive)
 */
export async function parseDiff(
  worktreeRoot: string,
  fromSha: string,
  toSha: string,
): Promise<FileDiff[]> {
  const result = await git(
    ['diff', `${fromSha}..${toSha}`, '--unified=3', '--find-renames'],
    worktreeRoot,
    { timeoutMs: 30_000 },
  );

  if (result.exitCode !== 0) {
    throw new Error(
      `git diff failed (exit ${result.exitCode}): ${result.stderr.slice(0, 500)}`,
    );
  }

  return parsePatch(result.stdout);
}
