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
}

export async function runTrace(opts: TraceOptions): Promise<number> {
  const writeOut = opts.stdoutWrite ?? ((s: string) => process.stdout.write(s));
  const writeErr = opts.stderrWrite ?? ((s: string) => process.stderr.write(s));

  const logsRoot = path.join(opts.cwd, '.zerou', 'logs');
  if (!fs.existsSync(logsRoot)) {
    writeErr(`error: no .zerou/logs/ under ${opts.cwd}\n`);
    return 1;
  }

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
    writeErr(`error: no log files found under ${logsRoot}\n`);
    return 1;
  }

  let pickedTrace: string;
  if (opts.traceId) {
    pickedTrace = opts.traceId;
  } else if (opts.last) {
    // Most-recent trace across all tracks: trace IDs are ULIDs which sort
    // lexicographically by time component. Pick the max.
    pickedTrace = files
      .map((f) => f.trace)
      .reduce((a, b) => (a > b ? a : b));
  } else {
    writeErr(`error: provide a trace-id or pass --last\n`);
    return 1;
  }

  const matching = files.filter((f) => f.trace === pickedTrace);
  if (matching.length === 0) {
    writeErr(`error: no entries for trace ${pickedTrace}\n`);
    return 1;
  }

  // Read all matching files
  const entries: TraceEntry[] = [];
  for (const f of matching) {
    let text: string;
    try {
      text = fs.readFileSync(f.abs, 'utf8');
    } catch {
      continue;
    }
    for (const line of text.split('\n')) {
      if (line.trim() === '') continue;
      try {
        entries.push(JSON.parse(line) as TraceEntry);
      } catch {
        // skip malformed
      }
    }
  }

  // Filter
  let filtered = entries;
  if (opts.filter) {
    const re = globToRegex(opts.filter);
    filtered = filtered.filter((e) => re.test(e.event));
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
