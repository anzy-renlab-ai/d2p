/**
 * Repo prep for `zerou audit`:
 * - B-1-1: auto `git init` when fixture has no .git
 * - B-1-2: log existing-git with HEAD sha
 * - B-1-3: refuse --apply on dirty working tree (A-E-5)
 * - B-1-4: --allow-dirty suppresses the refusal
 */
import * as fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { TrackLogger } from './log-types.js';

export class RepoError extends Error {
  readonly errorCode: 'A-E-1' | 'A-E-5';
  constructor(errorCode: 'A-E-1' | 'A-E-5', message: string) {
    super(message);
    this.errorCode = errorCode;
  }
}

export interface RepoInfo {
  cwd: string;
  head: string | null;
  autoInited: boolean;
}

export interface PrepareRepoOptions {
  cwd: string;
  apply: boolean;
  allowDirty: boolean;
  logger: TrackLogger;
}

export function prepareRepo(opts: PrepareRepoOptions): RepoInfo {
  const abs = path.resolve(opts.cwd);
  if (!fs.existsSync(abs)) {
    opts.logger.log('error', 'cli.path.missing', { path: abs });
    throw new RepoError('A-E-1', `<path> does not exist: ${abs}`);
  }
  const stat = fs.statSync(abs);
  if (!stat.isDirectory()) {
    opts.logger.log('error', 'cli.path.missing', { path: abs });
    throw new RepoError('A-E-1', `<path> is not a directory: ${abs}`);
  }

  const gitDir = path.join(abs, '.git');
  let autoInited = false;
  let head: string | null = null;
  if (!fs.existsSync(gitDir)) {
    runGit(abs, ['init', '-q']);
    // Make sure there's at least one commit so HEAD is queryable for tools
    // that expect repoSha. We don't add files — just an empty initial commit.
    try {
      // Configure local user only (avoid global config side effects).
      runGit(abs, ['config', 'user.email', 'zerou@local']);
      runGit(abs, ['config', 'user.name', 'zerou']);
      runGit(abs, ['commit', '--allow-empty', '-q', '-m', 'zerou: initial']);
    } catch {
      // best-effort; HEAD may remain unborn
    }
    autoInited = true;
    opts.logger.log('info', 'cli.repo.auto-init', { cwd: abs });
  } else {
    try {
      head = runGit(abs, ['rev-parse', 'HEAD']).trim();
    } catch {
      head = null;
    }
    opts.logger.log('info', 'cli.repo.existing-git', { cwd: abs, head });
  }

  if (opts.apply && !opts.allowDirty && !autoInited) {
    const dirty = isWorkingTreeDirty(abs);
    if (dirty) {
      opts.logger.log('error', 'cli.repo.dirty', { cwd: abs });
      throw new RepoError(
        'A-E-5',
        `working tree at ${abs} has uncommitted changes; commit/stash or pass --allow-dirty.`,
      );
    }
  }
  return { cwd: abs, head, autoInited };
}

function isWorkingTreeDirty(cwd: string): boolean {
  // Exclude .zerou/ — that's where we write our own logs/output during the run.
  const out = runGit(cwd, ['status', '--porcelain', '--', '.', ':!.zerou', ':!.zerou/**']);
  return out.trim().length > 0;
}

function runGit(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
