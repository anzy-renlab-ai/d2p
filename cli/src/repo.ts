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
import { logBranch, logCatch } from './log/branch.js';

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
    logBranch(
      opts.logger,
      'cli.repo.path-decision',
      {
        decision: 'fail-missing',
        path: abs,
        errorCode: 'A-E-1',
      },
      { level: 'info' },
    );
    opts.logger.log('error', 'cli.path.missing', { path: abs });
    throw new RepoError('A-E-1', `<path> does not exist: ${abs}`);
  }
  const stat = fs.statSync(abs);
  if (!stat.isDirectory()) {
    logBranch(
      opts.logger,
      'cli.repo.path-decision',
      {
        decision: 'fail-not-directory',
        path: abs,
        errorCode: 'A-E-1',
      },
      { level: 'info' },
    );
    opts.logger.log('error', 'cli.path.missing', { path: abs });
    throw new RepoError('A-E-1', `<path> is not a directory: ${abs}`);
  }
  logBranch(opts.logger, 'cli.repo.path-decision', {
    decision: 'directory-exists',
    path: abs,
  });

  const gitDir = path.join(abs, '.git');
  let autoInited = false;
  let head: string | null = null;
  if (!fs.existsSync(gitDir)) {
    logBranch(
      opts.logger,
      'cli.repo.git-decision',
      {
        decision: 'auto-init',
        reasoning: 'no .git directory; running `git init`',
        cwd: abs,
      },
      { level: 'info' },
    );
    runGit(abs, ['init', '-q']);
    // Make sure there's at least one commit so HEAD is queryable for tools
    // that expect repoSha. We don't add files — just an empty initial commit.
    try {
      // Configure local user only (avoid global config side effects).
      runGit(abs, ['config', 'user.email', 'zerou@local']);
      runGit(abs, ['config', 'user.name', 'zerou']);
      runGit(abs, ['commit', '--allow-empty', '-q', '-m', 'zerou: initial']);
      logBranch(opts.logger, 'cli.repo.init-commit-decision', {
        decision: 'initial-commit-created',
      });
    } catch (err) {
      // best-effort; HEAD may remain unborn
      logCatch(opts.logger, 'cli.repo.init-commit-decision', err, {
        cwd: abs,
        reasoning: 'best-effort — HEAD may remain unborn',
      });
    }
    autoInited = true;
    opts.logger.log('info', 'cli.repo.auto-init', { cwd: abs });
  } else {
    logBranch(opts.logger, 'cli.repo.git-decision', {
      decision: 'existing-git',
      cwd: abs,
    });
    try {
      head = runGit(abs, ['rev-parse', 'HEAD']).trim();
      logBranch(opts.logger, 'cli.repo.head-decision', {
        decision: 'head-resolved',
        head,
      });
    } catch (err) {
      logCatch(opts.logger, 'cli.repo.head-decision', err, {
        decision: 'head-unresolvable',
        reasoning: 'rev-parse HEAD failed — repo may be unborn',
      });
      head = null;
    }
    opts.logger.log('info', 'cli.repo.existing-git', { cwd: abs, head });
  }

  if (opts.apply && !opts.allowDirty && !autoInited) {
    logBranch(opts.logger, 'cli.repo.dirty-gate-decision', {
      decision: 'check',
      reasoning: '--apply set, --allow-dirty unset, repo pre-existed',
    });
    const dirty = isWorkingTreeDirty(abs);
    if (dirty) {
      logBranch(
        opts.logger,
        'cli.repo.dirty-decision',
        {
          decision: 'fail-dirty',
          errorCode: 'A-E-5',
          cwd: abs,
        },
        { level: 'info' },
      );
      opts.logger.log('error', 'cli.repo.dirty', { cwd: abs });
      throw new RepoError(
        'A-E-5',
        `working tree at ${abs} has uncommitted changes; commit/stash or pass --allow-dirty.`,
      );
    }
    logBranch(opts.logger, 'cli.repo.dirty-decision', {
      decision: 'clean',
    });
  } else {
    logBranch(opts.logger, 'cli.repo.dirty-gate-decision', {
      decision: 'skip',
      reasoning: !opts.apply
        ? 'no --apply'
        : opts.allowDirty
          ? '--allow-dirty'
          : 'just auto-inited',
    });
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
