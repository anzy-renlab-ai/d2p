/**
 * Test helpers for cli tests. Use os.tmpdir() everywhere (per dispatch-note #7).
 */
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createTrackLogger, captureLogsFor, type LogEntry } from '../log-types.js';
import type { LoadedPreset } from '../stubs.js';

export interface TmpRepoOpts {
  git?: boolean;
  files?: Record<string, string>;
}

export interface TmpRepo {
  cwd: string;
  cleanup: () => Promise<void>;
  /** Read all jsonl log files under .zerou/logs and return as Map<track/trace, entries[]>. */
  readLogs: () => Map<string, LogEntry[]>;
}

export async function tmpRepo(opts: TmpRepoOpts = {}): Promise<TmpRepo> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'zerou-cli-'));
  const files = opts.files ?? { 'a.ts': 'export const X = 1;\n' };
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await fsp.writeFile(abs, content);
  }
  if (opts.git !== false) {
    execFileSync('git', ['init', '-q'], { cwd: dir });
    execFileSync('git', ['config', 'user.email', 'test@local'], { cwd: dir });
    execFileSync('git', ['config', 'user.name', 'test'], { cwd: dir });
    execFileSync('git', ['add', '-A'], { cwd: dir });
    execFileSync('git', ['commit', '-q', '-m', 'initial'], { cwd: dir });
  }
  return {
    cwd: dir,
    cleanup: async () => {
      await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
    },
    readLogs: () => readLogsUnder(dir),
  };
}

export async function dirtyRepo(): Promise<TmpRepo> {
  const r = await tmpRepo({ git: true });
  await fsp.writeFile(path.join(r.cwd, 'dirty.ts'), 'export const D = 1;\n');
  return r;
}

export function readLogsUnder(cwd: string): Map<string, LogEntry[]> {
  const out = new Map<string, LogEntry[]>();
  const logsRoot = path.join(cwd, '.zerou', 'logs');
  if (!fs.existsSync(logsRoot)) return out;
  for (const track of fs.readdirSync(logsRoot)) {
    const trackDir = path.join(logsRoot, track);
    if (!fs.statSync(trackDir).isDirectory()) continue;
    for (const date of fs.readdirSync(trackDir)) {
      const dateDir = path.join(trackDir, date);
      if (!fs.statSync(dateDir).isDirectory()) continue;
      for (const file of fs.readdirSync(dateDir)) {
        if (!file.endsWith('.jsonl')) continue;
        const trace = file.slice(0, -6);
        const key = `${track}/${trace}`;
        const text = fs.readFileSync(path.join(dateDir, file), 'utf8');
        const lines: LogEntry[] = [];
        for (const ln of text.split('\n')) {
          if (ln.trim() === '') continue;
          try {
            lines.push(JSON.parse(ln));
          } catch {}
        }
        const existing = out.get(key) ?? [];
        out.set(key, existing.concat(lines));
      }
    }
  }
  return out;
}

export function writeConfig(
  _cwdHint: string,
  cfg: Record<string, unknown>,
  filename = 'config.json',
): string {
  // Write to a fresh tmpdir so the repo under audit stays clean.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zerou-cfg-'));
  const p = path.join(dir, filename);
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2));
  if (process.platform !== 'win32') {
    fs.chmodSync(p, 0o600);
  }
  return p;
}

export const validConfigData = {
  worker: {
    kind: 'claude-cli',
    modelId: 'claude-haiku-4-5-20251001',
    releaseDate: '2026-05-01',
  },
  criticPool: [
    {
      kind: 'codex-cli',
      modelId: 'gpt-5-2026-05-01',
      releaseDate: '2026-05-01',
    },
  ],
};

export const singleEngineConfigData = {
  worker: {
    kind: 'claude-cli',
    modelId: 'claude-haiku-4-5-20251001',
    releaseDate: '2026-05-01',
  },
};

/** Mock LoadedPreset that emits one P1 finding on any file with `secret` in it. */
export function mockPreset(opts: {
  id?: string;
  severity?: 'P1' | 'P2' | 'P3';
  pattern?: string;
  fix?: 'template' | 'llm-only' | 'none';
  body?: string;
  source?: 'plugin' | 'project' | 'builtin';
  shadowedBy?: ('plugin' | 'project' | 'builtin')[];
  verifyCommand?: string;
} = {}): LoadedPreset {
  const id = opts.id ?? 'mock-preset';
  return {
    manifest: {
      id,
      version: 1,
      rules: [
        {
          id: id + '.rule',
          severity: opts.severity ?? 'P1',
          mechanism: 'static-grep',
          pattern: opts.pattern ?? 'SECRET_TOKEN',
          filePattern: '**/*.{ts,js}',
          message: 'mock-rule matched',
          ...(opts.fix === 'none' ? {} : {
            fix: {
              kind: opts.fix ?? 'template',
              find: opts.pattern ?? 'SECRET_TOKEN',
              replace: 'process.env.SECRET!',
              verifyCommand: opts.verifyCommand ?? 'true',
            },
          }),
        },
      ],
      body: opts.body ?? 'mock remediation guidance',
    },
    source: opts.source ?? 'builtin',
    resolvedPath: '<mock>',
    shadowedBy: opts.shadowedBy ?? [],
  };
}

export { createTrackLogger, captureLogsFor };
