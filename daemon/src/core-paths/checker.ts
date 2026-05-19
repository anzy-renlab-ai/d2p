/**
 * checkChangedFiles — given a list of changed file paths and a list of
 * minimatch-style globs, return hits and which glob matched each path.
 *
 * Uses a tiny inline glob matcher (no new npm dep):
 *   - `**` matches any number of path segments (including zero)
 *   - `*` matches any characters within a single segment (no `/`)
 *   - All other chars are literal
 *
 * Glob matching is case-insensitive on Windows, case-sensitive elsewhere.
 */

export interface CheckResult {
  hits: string[];
  matchedGlob: Record<string, string>;
}

// ── Tiny glob matcher ─────────────────────────────────────────────────────────

/**
 * Convert a glob pattern to a RegExp.
 *
 * Supported syntax:
 *   **   → matches anything (including path separators)
 *   *    → matches anything except path separators
 *   ?    → matches one character except path separator
 *   .    → literal dot
 */
export function globToRegex(glob: string): RegExp {
  // Normalize path separators
  const g = glob.replace(/\\/g, '/');
  let re = '^';

  let j = 0;
  while (j < g.length) {
    const ch = g[j]!;

    if (ch === '*' && g[j + 1] === '*') {
      // ** — match anything
      re += '.*';
      j += 2;
      // skip trailing slash after **
      if (g[j] === '/') j++;
    } else if (ch === '*') {
      // * — match anything except /
      re += '[^/]*';
      j++;
    } else if (ch === '?') {
      re += '[^/]';
      j++;
    } else if ('.+^${}()|[]\\'.includes(ch)) {
      re += '\\' + ch;
      j++;
    } else {
      re += ch;
      j++;
    }
  }

  re += '$';
  const flags = process.platform === 'win32' ? 'i' : '';
  return new RegExp(re, flags);
}

/**
 * Test whether a single file path matches a single glob pattern.
 * Also normalizes backslashes to forward slashes before matching.
 */
export function matchGlob(glob: string, filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  const re = globToRegex(glob);
  return re.test(normalized);
}

/**
 * Check which paths hit any of the given globs.
 *
 * @param changedPaths  List of file paths (relative or absolute)
 * @param globs         List of glob patterns
 * @returns { hits, matchedGlob } where matchedGlob maps each hit path to the
 *          first glob that matched it.
 */
export function checkChangedFiles(changedPaths: string[], globs: string[]): CheckResult {
  const hits: string[] = [];
  const matchedGlob: Record<string, string> = {};

  for (const p of changedPaths) {
    for (const glob of globs) {
      if (matchGlob(glob, p)) {
        hits.push(p);
        matchedGlob[p] = glob;
        break; // first matching glob wins
      }
    }
  }

  return { hits, matchedGlob };
}
