/**
 * Scope filter — keeps ZeroU's static scans focused on application code.
 *
 * Context: ZeroU is intended for vibe-coded user apps, not third-party / vendored
 * library internals. When we accidentally scanned the `secbench-subset` dataset
 * containing 28 real npm package vulnerabilities, our static-grep presets fired
 * 406 times on legitimate library code (`'SELECT ' + variable` inside pg test
 * fixtures, `eval(` inside a test runner's source, etc.). None of those 406
 * matched the 28 real vulnerabilities.
 *
 * This module centralises the previously-duplicated SKIP_DIRS sets across
 * stubs.ts / test-case-generator.ts / branch-coverage.ts and adds a soft
 * "looks-like-library" heuristic so heavy-licence/utility files in user repos
 * are also skipped in app-scope mode.
 *
 * Two scope modes:
 *   - 'app' (DEFAULT): skip ALWAYS_SKIP + THIRD_PARTY + SKIP_FILE_PATTERNS +
 *     looksLikeLibraryFile heuristic. Use this for user app audits.
 *   - 'all': skip only ALWAYS_SKIP. Use this when intentionally scanning
 *     library code or when the demo IS a library.
 *
 * POSIX paths only. All inputs are normalised before matching.
 *
 * Surface:
 *   - `ALWAYS_SKIP_DIRS`: directories never scanned regardless of scope.
 *   - `THIRD_PARTY_DIRS`: directory names that LOOK like vendored deps.
 *   - `SKIP_FILE_PATTERNS`: regex patterns matched against POSIX rel path.
 *   - `shouldScanDir(name, scope)`: cheap per-directory gate, used inside walk.
 *   - `shouldScanFile({scope, cwd, relPath})`: per-file decision with reason.
 *   - `looksLikeLibraryFile(content, relPath)`: soft heuristic for user-repo
 *     files that "feel like" library internals (license header heavy, only
 *     `module.exports`, etc.).
 *
 * Log taxonomy: callers may emit `agent.scope-filter.skip` via logBranch when
 * they want the `--explain-skipped` summary to pick up the decision.
 */

/** Directories that NEVER get scanned regardless of scope. */
export const ALWAYS_SKIP_DIRS: ReadonlySet<string> = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  '.zerou',
  '.worktrees',
  'coverage',
  '.turbo',
  '.cache',
  'out',
  '.nuxt',
  '__pycache__',
  '.venv',
  'venv',
  '.pytest_cache',
  'target', // Rust
  '.gradle', // Java
  '.idea',
  '.vscode',
]);

/** Directories that look like third-party / vendored code. */
export const THIRD_PARTY_DIRS: ReadonlySet<string> = new Set([
  'vendor',
  'vendored',
  'third_party',
  'third-party',
  'externals',
  'bower_components',
  'jspm_packages',
]);

/**
 * POSIX path-segment patterns that indicate third-party-ish locations.
 * These are joined by `/` so they match a fragment in the relative path.
 */
export const THIRD_PARTY_PATH_SEGMENTS: readonly string[] = [
  'lib/external',
  'public/static',
  'static/vendor',
];

/** Files that look like minified / bundled / generated / vendored output. */
export const SKIP_FILE_PATTERNS: readonly RegExp[] = [
  /\.min\.(js|ts|css|mjs|cjs)$/i,
  /\.bundle\.(js|ts|mjs|cjs)$/i,
  /\.generated\.(ts|js|mjs|cjs)$/i,
  /(^|\/)vendor[^/]*\.(js|ts|mjs|cjs)$/i,
  /(^|\/)prisma\/migrations\//i,
  /(^|\/)public\//i,
  /\.d\.ts$/i, // type declarations
  /\.map$/i, // source maps
];

export type ScopeMode = 'app' | 'all';

export interface ShouldScanOpts {
  scope: ScopeMode;
  cwd: string;
  /** POSIX-relative path from cwd. Must use `/`, not OS-specific separator. */
  relPath: string;
}

export type SkipReason =
  | 'always-skip-dir'
  | 'third-party-dir'
  | 'third-party-segment'
  | 'minified'
  | 'd-ts'
  | 'source-map'
  | 'vendored-file'
  | 'generated'
  | 'bundle'
  | 'prisma-migration'
  | 'public-asset'
  | 'library-internal';

export interface ShouldScanResult {
  scan: boolean;
  reason?: SkipReason;
}

/** Normalise to POSIX. */
function toPosix(p: string): string {
  return p.split('\\').join('/');
}

/**
 * Decision for a single directory name during walk. Cheap O(1) lookup —
 * callers use this BEFORE descending into the directory to avoid wasted
 * readdir calls.
 *
 * NOTE: in 'all' mode we still respect ALWAYS_SKIP_DIRS (node_modules etc.)
 * because those are environment cruft, not "third-party code we might want
 * to opt into scanning".
 */
export function shouldScanDir(dirName: string, scope: ScopeMode): boolean {
  if (ALWAYS_SKIP_DIRS.has(dirName)) return false;
  if (scope === 'all') return true;
  if (THIRD_PARTY_DIRS.has(dirName)) return false;
  return true;
}

/**
 * Match a relative POSIX path against SKIP_FILE_PATTERNS / segment list.
 * Returns the first matching reason, or null.
 */
function matchFilePattern(relPosix: string): SkipReason | null {
  if (/\.d\.ts$/i.test(relPosix)) return 'd-ts';
  if (/\.map$/i.test(relPosix)) return 'source-map';
  if (/\.min\.(js|ts|css|mjs|cjs)$/i.test(relPosix)) return 'minified';
  if (/\.bundle\.(js|ts|mjs|cjs)$/i.test(relPosix)) return 'bundle';
  if (/\.generated\.(ts|js|mjs|cjs)$/i.test(relPosix)) return 'generated';
  if (/(^|\/)prisma\/migrations\//i.test(relPosix)) return 'prisma-migration';
  if (/(^|\/)public\//i.test(relPosix)) return 'public-asset';
  if (/(^|\/)vendor[^/]*\.(js|ts|mjs|cjs)$/i.test(relPosix)) return 'vendored-file';
  return null;
}

/**
 * Should this file be scanned given the configured scope?
 *
 * In 'all' mode, only ALWAYS_SKIP_DIRS in the path eliminate it. In 'app'
 * mode we additionally reject:
 *   - any path segment in THIRD_PARTY_DIRS
 *   - any path matching THIRD_PARTY_PATH_SEGMENTS
 *   - any file matching SKIP_FILE_PATTERNS
 *
 * `looksLikeLibraryFile` is NOT called here — it requires the file content,
 * so callers invoke it separately after reading the file (and only in 'app'
 * scope).
 */
export function shouldScanFile(opts: ShouldScanOpts): ShouldScanResult {
  const rel = toPosix(opts.relPath);
  const segments = rel.split('/').filter((s) => s.length > 0);

  // ALWAYS_SKIP_DIRS check applies regardless of scope.
  for (const seg of segments) {
    if (ALWAYS_SKIP_DIRS.has(seg)) {
      return { scan: false, reason: 'always-skip-dir' };
    }
  }

  if (opts.scope === 'all') {
    return { scan: true };
  }

  // app scope — extra layers
  for (const seg of segments) {
    if (THIRD_PARTY_DIRS.has(seg)) {
      return { scan: false, reason: 'third-party-dir' };
    }
  }
  for (const seg of THIRD_PARTY_PATH_SEGMENTS) {
    if (rel.includes(seg + '/') || rel === seg || rel.startsWith(seg + '/')) {
      return { scan: false, reason: 'third-party-segment' };
    }
  }
  const fileReason = matchFilePattern(rel);
  if (fileReason) {
    return { scan: false, reason: fileReason };
  }
  return { scan: true };
}

/**
 * Soft heuristic: does this file LOOK like library internals rather than
 * application logic?
 *
 * Triggers (intentionally conservative — false positives here mean missed
 * scans, so we only fire when multiple signals line up):
 *
 *   (1) File has a long license / copyright header (>=15 lines starting with
 *       '*' or '//' that include 'copyright', 'licensed', 'mit', 'apache',
 *       'gnu', etc.) AND no obvious handler patterns (express route, default
 *       export of a function taking req/res, etc.).
 *
 *   (2) File contains ONLY `module.exports = ...` re-exports (and `require`
 *       calls) — no top-level function bodies, no async handlers, no fetch
 *       calls. Looks like a barrel.
 *
 *   (3) Path is under `src/lib/`, `lib/utils/`, `lib/internal/` AND the file
 *       has no imports from project-domain modules (heuristic: no relative
 *       `./` or `../` imports that resolve outside the lib dir).
 *
 *   (4) File contains 'use strict'; declared multiple times (legacy
 *       transpiled CommonJS bundles).
 *
 * Returns true if ANY high-confidence trigger fires. Callers (in 'app' scope)
 * should skip the file when true.
 */
export function looksLikeLibraryFile(content: string, relPath: string): boolean {
  const rel = toPosix(relPath);

  // Quick reject: very short files can't be reliably classified.
  if (content.length < 200) return false;

  const lines = content.split(/\r?\n/);
  const head = lines.slice(0, 60).join('\n');
  const headLower = head.toLowerCase();

  // Trigger (4): multiple 'use strict' declarations → CJS bundle.
  const useStrictCount = (content.match(/['"]use strict['"];?/g) ?? []).length;
  if (useStrictCount >= 3) return true;

  // Trigger (1): heavy license/copyright header.
  let headerCommentLines = 0;
  for (const line of lines) {
    const t = line.trim();
    if (t.length === 0) {
      // allow one blank line within header but break on second
      if (headerCommentLines > 0) {
        headerCommentLines++;
        if (headerCommentLines > 60) break;
        continue;
      }
      continue;
    }
    if (
      t.startsWith('/*') ||
      t.startsWith('*') ||
      t.startsWith('*/') ||
      t.startsWith('//')
    ) {
      headerCommentLines++;
      continue;
    }
    break;
  }
  const licenseMarkers =
    /copyright|licensed under|mit license|apache license|gnu|bsd license|all rights reserved|spdx-license-identifier/i;
  if (headerCommentLines >= 15 && licenseMarkers.test(headLower)) {
    // Need to also confirm: no handler-ish patterns in rest of file.
    const hasHandlerSignal =
      /\b(req|request)\b\s*[,:)]/.test(content) ||
      /\b(res|response|next)\b\s*[,:)]/.test(content) ||
      /\bapp\.(get|post|put|delete|patch)\(/i.test(content) ||
      /\brouter\.(get|post|put|delete|patch)\(/i.test(content) ||
      /\bexport\s+(default\s+)?async\s+function\s+(GET|POST|PUT|DELETE|PATCH)\b/.test(content);
    if (!hasHandlerSignal) return true;
  }

  // Trigger (2): barrel re-export file (only `module.exports = require(...)`
  // or `exports.X = require(...)` shapes).
  const codeLines = lines.filter((l) => {
    const t = l.trim();
    if (t.length === 0) return false;
    if (t.startsWith('//') || t.startsWith('/*') || t.startsWith('*')) return false;
    return true;
  });
  if (codeLines.length > 0 && codeLines.length <= 60) {
    const useStrictRe = /^['"]use strict['"];?\s*$/;
    const barrelRe = /^(module\.exports|exports\.|var\s+\w+\s*=\s*require|const\s+\w+\s*=\s*require|let\s+\w+\s*=\s*require|export\s+\*\s+from|export\s+\{[^}]*\}\s+from)\b/;
    const allBarrel = codeLines.every((l) => {
      const t = l.trim();
      return useStrictRe.test(t) || barrelRe.test(t);
    });
    if (allBarrel) return true;
  }

  // Trigger (3): under src/lib/ or lib/utils/ AND no domain-y patterns.
  const libPathRe = /(^|\/)(lib\/(utils|internal|external|polyfills?)|src\/lib\/(utils|internal))(\/|$)/i;
  if (libPathRe.test(rel)) {
    const hasDomainSignal =
      /\b(req|res|request|response|next|ctx)\b\s*[,:)]/.test(content) ||
      /\bfetch\(|\baxios\.|prisma\.|db\.|knex\(/i.test(content) ||
      /process\.env\.[A-Z_]/.test(content);
    if (!hasDomainSignal) {
      // Confirm absence of any imports of project-domain looking modules.
      // i.e. all imports are external (no `./` or `../`) OR no imports at all.
      const importRe = /^\s*(?:import\b[^'"`]*from\s+['"`]([^'"`]+)['"`]|(?:const|let|var)\s+[\w{}\s,:*]+\s*=\s*require\(['"`]([^'"`]+)['"`]\))/gm;
      let hasRelativeImport = false;
      let m: RegExpExecArray | null;
      while ((m = importRe.exec(content)) !== null) {
        const spec = m[1] ?? m[2];
        if (spec && (spec.startsWith('./') || spec.startsWith('../'))) {
          hasRelativeImport = true;
          break;
        }
      }
      if (!hasRelativeImport) return true;
    }
  }

  // Trigger (5) bonus: huge file with mostly minified-looking content (long
  // lines, few line breaks). Catches unminified-but-machine-generated bundles.
  if (lines.length > 50 && content.length / lines.length > 400) {
    return true;
  }

  return false;
}
