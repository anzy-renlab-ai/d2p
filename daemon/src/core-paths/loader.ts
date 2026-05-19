/**
 * loadCorePaths — read project core-paths configuration.
 *
 * Reads <projectRoot>/.d2p/core-paths.yaml which supports a top-level array:
 *
 *   - lib/db/**
 *   - lib/auth/**
 *   - Dockerfile
 *
 * If the file is missing, returns { globs: [], source: 'none' }.
 * If the file exists but is malformed, returns { globs: [], source: 'none' }.
 *
 * Inference (inferCorePaths) is a separate exported fn. Auto-inference is
 * default-off; callers must opt in explicitly.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

export interface CorePathsResult {
  globs: string[];
  source: 'user' | 'inferred' | 'none';
}

const CORE_PATHS_FILE = '.d2p/core-paths.yaml';

export function loadCorePaths(projectRoot: string): CorePathsResult {
  const filePath = path.join(projectRoot, CORE_PATHS_FILE);

  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch {
    return { globs: [], source: 'none' };
  }

  try {
    const parsed: unknown = parseYaml(raw);
    if (Array.isArray(parsed)) {
      const globs = parsed.filter((item): item is string => typeof item === 'string');
      return { globs, source: 'user' };
    }
    // Handle object with a 'globs' key as a convenience
    if (parsed && typeof parsed === 'object' && 'globs' in parsed) {
      const obj = parsed as { globs: unknown };
      if (Array.isArray(obj.globs)) {
        const globs = obj.globs.filter((item): item is string => typeof item === 'string');
        return { globs, source: 'user' };
      }
    }
    return { globs: [], source: 'none' };
  } catch {
    return { globs: [], source: 'none' };
  }
}

/**
 * inferCorePaths — heuristic: find files most commonly imported across the
 * project. Shell-out git ls-files + grep.
 *
 * This is intentionally default-OFF. Callers must call this explicitly;
 * loadCorePaths never auto-runs it.
 *
 * Returns inferred globs (may be empty on error).
 */
export async function inferCorePaths(projectRoot: string): Promise<CorePathsResult> {
  const { spawnSync } = await import('node:child_process');

  // git ls-files gives us all tracked files
  const lsResult = spawnSync('git', ['ls-files'], { cwd: projectRoot, encoding: 'utf8' });
  if (lsResult.status !== 0) return { globs: [], source: 'none' };

  const files = lsResult.stdout.split('\n').filter(Boolean);

  // Count how many times each file is imported by grep-ing for import lines
  // This is a best-effort heuristic; errors return empty.
  try {
    const counts = new Map<string, number>();

    for (const file of files) {
      // Skip non-source files
      if (!/\.(ts|tsx|js|jsx|mjs|cjs|py|rb|go|rs)$/.test(file)) continue;

      const grepResult = spawnSync(
        'git',
        ['grep', '-l', `from ['"].*${file.replace(/\.[^.]+$/, '')}`, '--', '*.ts', '*.tsx', '*.js'],
        { cwd: projectRoot, encoding: 'utf8' },
      );

      const matches = (grepResult.stdout || '').split('\n').filter(Boolean).length;
      if (matches > 0) counts.set(file, matches);
    }

    // Top 10 most imported files
    const topFiles = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([f]) => f);

    return { globs: topFiles, source: 'inferred' };
  } catch {
    return { globs: [], source: 'none' };
  }
}
