/**
 * Phase 11 — `zerou review` command.
 *
 * Opens the latest enhance HTML report in the default browser.
 *
 *   zerou review              # cwd, latest run
 *   zerou review <path>       # specific repo
 *   zerou review --latest     # explicit
 *   zerou review --run <ts>   # archived run by timestamp
 *   zerou review --print      # print path only, do not open
 *
 * Authority: D:\lll\d2p\docs\reviews\2026-05-27-presentation-layer.md
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';

export interface ReviewCliOpts {
  argv: string[];
  /** Test seam — override the "open in browser" call. */
  opener?: (filePath: string) => Promise<{ ok: boolean; error?: string }>;
  /** Test seam — capture stdout/stderr instead of writing to process.* */
  writeOut?: (s: string) => void;
  writeErr?: (s: string) => void;
}

export interface ReviewResolved {
  ok: true;
  reportPath: string;
  runId?: string;
}

export interface ReviewMissing {
  ok: false;
  reason: string;
}

export type ReviewResolveResult = ReviewResolved | ReviewMissing;

/**
 * Locate the enhance report to display, given a cwd and CLI args.
 *
 * Resolution order:
 *   --run <ts>  → .zerou/runs/<ts>/enhance-report.html
 *   --latest    → most recent .zerou/runs/<ts>/enhance-report.html
 *   default     → .zerou/enhance-report.html (then fall back to --latest)
 */
export function resolveReportPath(args: {
  cwd: string;
  runId?: string;
  latestOnly?: boolean;
}): ReviewResolveResult {
  const zerouDir = path.join(args.cwd, '.zerou');
  if (!fs.existsSync(zerouDir)) {
    return { ok: false, reason: `.zerou/ not found in ${args.cwd}. Run \`zerou enhance\` first.` };
  }

  if (args.runId) {
    const archived = path.join(zerouDir, 'runs', args.runId, 'enhance-report.html');
    if (!fs.existsSync(archived)) {
      return { ok: false, reason: `archived run not found: ${archived}` };
    }
    return { ok: true, reportPath: archived, runId: args.runId };
  }

  if (!args.latestOnly) {
    const stable = path.join(zerouDir, 'enhance-report.html');
    if (fs.existsSync(stable)) return { ok: true, reportPath: stable };
  }

  const runsDir = path.join(zerouDir, 'runs');
  if (fs.existsSync(runsDir)) {
    const entries = fs.readdirSync(runsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort()
      .reverse();
    for (const ts of entries) {
      const candidate = path.join(runsDir, ts, 'enhance-report.html');
      if (fs.existsSync(candidate)) {
        return { ok: true, reportPath: candidate, runId: ts };
      }
    }
  }

  return {
    ok: false,
    reason: `No enhance-report.html found under ${zerouDir}. Run \`zerou enhance\` first.`,
  };
}

/** Default opener — shells out to the platform's "open file" verb. */
export const defaultOpener = async (filePath: string): Promise<{ ok: boolean; error?: string }> => {
  return new Promise((resolve) => {
    let cmd: string;
    let args: string[];
    if (process.platform === 'win32') {
      // `start` is a cmd builtin, not an exe — use cmd /c.
      // The empty "" after start is the window title (start treats first
      // quoted arg as title, which mangles file paths with spaces).
      cmd = 'cmd';
      args = ['/c', 'start', '""', filePath];
    } else if (process.platform === 'darwin') {
      cmd = 'open';
      args = [filePath];
    } else {
      cmd = 'xdg-open';
      args = [filePath];
    }
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true, shell: false });
    child.on('error', (err) => resolve({ ok: false, error: err.message }));
    child.on('spawn', () => {
      child.unref();
      resolve({ ok: true });
    });
  });
};

export async function runReview(opts: ReviewCliOpts): Promise<number> {
  const writeOut = opts.writeOut ?? ((s: string) => process.stdout.write(s));
  const writeErr = opts.writeErr ?? ((s: string) => process.stderr.write(s));

  const args = opts.argv.slice(3);
  let cwdArg: string | undefined;
  let runId: string | undefined;
  let latestOnly = false;
  let printOnly = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? '';
    if (a === '--run' && i + 1 < args.length) {
      runId = args[++i];
    } else if (a === '--latest') {
      latestOnly = true;
    } else if (a === '--print' || a === '--no-open') {
      printOnly = true;
    } else if (a === '--help' || a === '-h') {
      writeOut(
        'Usage: zerou review [<path>] [--latest|--run <ts>] [--print]\n' +
          '  Opens the latest enhance-report.html in your default browser.\n',
      );
      return 0;
    } else if (!a.startsWith('--') && !cwdArg) {
      cwdArg = a;
    }
  }

  const cwd = path.resolve(cwdArg ?? process.cwd());
  if (!fs.existsSync(cwd)) {
    writeErr(`zerou review: path does not exist: ${cwd}\n`);
    return 2;
  }

  const resolved = resolveReportPath({ cwd, runId, latestOnly });
  if (!resolved.ok) {
    writeErr(`zerou review: ${resolved.reason}\n`);
    return 4;
  }

  writeOut(`📄 ${resolved.reportPath}\n`);
  if (resolved.runId) writeOut(`   run: ${resolved.runId}\n`);

  if (printOnly) return 0;

  const opener = opts.opener ?? defaultOpener;
  const r = await opener(resolved.reportPath);
  if (!r.ok) {
    writeErr(`zerou review: could not open browser: ${r.error ?? 'unknown'}\n`);
    writeErr(`Open this URL manually: file://${resolved.reportPath.replace(/\\/g, '/')}\n`);
    return 5;
  }
  return 0;
}
