/**
 * `zerou trace [trace-id]` — read & sort .zerou/logs/*<date>/<trace>.jsonl.
 *
 * Simplified Phase 1 implementation:
 *   --last      pick the most-recent trace (across all tracks)
 *   --filter <pattern>  glob over event name
 *
 * Output: one line per entry, sorted by ts:
 *   {iso-ts} [{track}/{scope}] {event} {payload-json}
 */
import * as fs from 'node:fs';
import path from 'node:path';
import type { TrackLogger } from './log-types.js';
import { logBranch, logCatch } from './log/branch.js';

interface TraceEntry {
  ts: number;
  level: string;
  track: string;
  trace: string;
  scope?: string;
  event: string;
  // arbitrary keys
  [k: string]: unknown;
}

export interface TraceOptions {
  cwd: string;
  traceId?: string;
  last?: boolean;
  filter?: string;
  stdoutWrite?: (s: string) => void;
  stderrWrite?: (s: string) => void;
  /** Optional logger for decision-branch tracing. */
  logger?: TrackLogger | null;
}

export async function runTrace(opts: TraceOptions): Promise<number> {
  const writeOut = opts.stdoutWrite ?? ((s: string) => process.stdout.write(s));
  const writeErr = opts.stderrWrite ?? ((s: string) => process.stderr.write(s));
  const log = opts.logger;

  const logsRoot = path.join(opts.cwd, '.zerou', 'logs');
  if (!fs.existsSync(logsRoot)) {
    logBranch(
      log,
      'cli.trace.logs-root-decision',
      {
        decision: 'fail-missing',
        logsRoot,
      },
      { level: 'info' },
    );
    writeErr(`error: no .zerou/logs/ under ${opts.cwd}\n`);
    return 1;
  }
  logBranch(log, 'cli.trace.logs-root-decision', {
    decision: 'exists',
    logsRoot,
  });

  // Walk: <logsRoot>/<track>/<date>/<trace>.jsonl
  const tracks = listDir(logsRoot);
  // collect per (trace, file)
  const files: Array<{ track: string; date: string; trace: string; abs: string }> = [];
  for (const track of tracks) {
    const dates = listDir(path.join(logsRoot, track));
    for (const date of dates) {
      const dateDir = path.join(logsRoot, track, date);
      const entries = listDir(dateDir);
      for (const name of entries) {
        if (!name.endsWith('.jsonl')) continue;
        const trace = name.slice(0, -'.jsonl'.length);
        files.push({ track, date, trace, abs: path.join(dateDir, name) });
      }
    }
  }

  if (files.length === 0) {
    logBranch(
      log,
      'cli.trace.files-decision',
      {
        decision: 'fail-empty',
        logsRoot,
      },
      { level: 'info' },
    );
    writeErr(`error: no log files found under ${logsRoot}\n`);
    return 1;
  }
  logBranch(log, 'cli.trace.files-decision', {
    decision: 'found',
    fileCount: files.length,
  });

  let pickedTrace: string;
  if (opts.traceId) {
    pickedTrace = opts.traceId;
    logBranch(log, 'cli.trace.pick-decision', {
      decision: 'explicit-trace-id',
      pickedTrace,
    });
  } else if (opts.last) {
    // Most-recent trace across all tracks: trace IDs are ULIDs which sort
    // lexicographically by time component. Pick the max.
    pickedTrace = files
      .map((f) => f.trace)
      .reduce((a, b) => (a > b ? a : b));
    logBranch(log, 'cli.trace.pick-decision', {
      decision: 'last-by-ulid',
      pickedTrace,
    });
  } else {
    logBranch(
      log,
      'cli.trace.pick-decision',
      {
        decision: 'fail-no-selector',
        reasoning: 'neither trace-id nor --last supplied',
      },
      { level: 'info' },
    );
    writeErr(`error: provide a trace-id or pass --last\n`);
    return 1;
  }

  const matching = files.filter((f) => f.trace === pickedTrace);
  if (matching.length === 0) {
    logBranch(
      log,
      'cli.trace.match-decision',
      {
        decision: 'fail-no-entries',
        pickedTrace,
      },
      { level: 'info' },
    );
    writeErr(`error: no entries for trace ${pickedTrace}\n`);
    return 1;
  }
  logBranch(log, 'cli.trace.match-decision', {
    decision: 'matched',
    pickedTrace,
    matchedFiles: matching.length,
  });

  // Read all matching files
  const entries: TraceEntry[] = [];
  for (const f of matching) {
    let text: string;
    try {
      text = fs.readFileSync(f.abs, 'utf8');
    } catch (err) {
      logCatch(log, 'cli.trace.read-decision', err, {
        file: f.abs,
      });
      continue;
    }
    for (const line of text.split('\n')) {
      if (line.trim() === '') continue;
      try {
        entries.push(JSON.parse(line) as TraceEntry);
      } catch (err) {
        // skip malformed
        logCatch(log, 'cli.trace.parse-decision', err, {
          file: f.abs,
        });
      }
    }
  }

  // Filter
  let filtered = entries;
  if (opts.filter) {
    const re = globToRegex(opts.filter);
    const before = filtered.length;
    filtered = filtered.filter((e) => re.test(e.event));
    logBranch(log, 'cli.trace.filter-decision', {
      decision: 'applied',
      pattern: opts.filter,
      kept: filtered.length,
      dropped: before - filtered.length,
    });
  } else {
    logBranch(log, 'cli.trace.filter-decision', {
      decision: 'skip',
      reasoning: 'no --filter supplied',
    });
  }

  // Sort by ts
  filtered.sort((a, b) => a.ts - b.ts);

  // Format each: {iso-ts} [{track}/{scope}] {event} {payload}
  for (const e of filtered) {
    const iso = new Date(e.ts).toISOString();
    const scope = e.scope ? `/${e.scope}` : '';
    const tag = `[${e.track}${scope}]`;
    const { ts, level, track, trace, scope: _s, event, ...rest } = e;
    void ts; void level; void track; void trace; void _s;
    const payload = Object.keys(rest).length > 0 ? ' ' + JSON.stringify(rest) : '';
    writeOut(`${iso} ${tag} ${event}${payload}\n`);
  }
  return 0;
}

function listDir(p: string): string[] {
  try {
    return fs.readdirSync(p);
  } catch {
    return [];
  }
}

function globToRegex(glob: string): RegExp {
  // simple: * → .*, ? → ., escape rest
  let r = '';
  for (const ch of glob) {
    if (ch === '*') r += '.*';
    else if (ch === '?') r += '.';
    else if ('.+^$()|[]{}\\'.includes(ch)) r += '\\' + ch;
    else r += ch;
  }
  return new RegExp('^' + r + '$');
}
