import path from 'node:path';
import type { AbsPath } from '../types.js';

export class NotAbsoluteError extends Error {
  constructor(p: string) {
    super(`path is not absolute: ${p}`);
    this.name = 'NotAbsoluteError';
  }
}

/** Validate + normalize, brand as AbsPath. */
export function asAbsPath(p: string): AbsPath {
  if (!path.isAbsolute(p)) throw new NotAbsoluteError(p);
  if (p.includes('\0')) throw new Error(`path contains null byte: ${p}`);
  const normalized = path.normalize(p);
  return normalized as AbsPath;
}

/** Best-effort: try to brand, return null on failure. */
export function tryAbsPath(p: string): AbsPath | null {
  try {
    return asAbsPath(p);
  } catch {
    return null;
  }
}

/** Lifts the AbsPath brand back to plain string. */
export function pathString(p: AbsPath): string {
  return p as unknown as string;
}

/** Containment: is `child` inside `parent` (no .. escape)? */
export function isInside(parent: string, child: string): boolean {
  const rel = path.relative(path.normalize(parent), path.normalize(child));
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** Compute worktree path for a fix slug. */
export function computeWorktreePath(repoPath: string, slug: string): string {
  const parent = path.dirname(repoPath);
  const base = path.basename(repoPath);
  return path.join(parent, '.d2p-worktrees', `${base}-fix-${slug}`);
}
