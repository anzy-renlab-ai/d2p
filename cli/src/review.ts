/**
 * Phase 11/12 — `zerou review` command.
 *
 * Two modes:
 *   - Default (Phase 11): opens the latest enhance-report.html in the default
 *     browser.
 *   - `--serve` (Phase 12): boots a local HTTP server that serves the React
 *     review UI from `ui/dist/`, then opens that URL.
 *
 *   zerou review                    # cwd, latest run (HTML file mode)
 *   zerou review <path>             # specific repo
 *   zerou review --latest           # explicit
 *   zerou review --run <ts>         # archived run by timestamp
 *   zerou review --print            # print path only, do not open
 *   zerou review --serve            # start local UI server
 *   zerou review --serve --port N   # bind to a specific port (default 7777)
 *   zerou review --serve --no-open  # don't auto-open browser
 *
 * Authority: D:\lll\d2p\docs\reviews\2026-05-27-presentation-layer.md
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

import { createTrackLogger } from './log-types.js';
import {
  locateUiDist,
  startReviewServer,
  type ReviewServerHandle,
} from './review-server.js';

export interface ReviewCliOpts {
  argv: string[];
  /** Test seam — override the "open in browser" call. */
  opener?: (urlOrPath: string) => Promise<{ ok: boolean; error?: string }>;
  /** Test seam — capture stdout/stderr instead of writing to process.* */
  writeOut?: (s: string) => void;
  writeErr?: (s: string) => void;
  /** Test seam — override server bootstrap (for --serve tests). */
  startServer?: (args: {
    cwd: string;
    uiDistDir: string;
    host?: string;
    port?: number;
  }) => Promise<ReviewServerHandle>;
  /** Test seam — override the on-disk lookup for ui/dist. */
  resolveUiDist?: () => Promise<string | null>;
  /** Test seam — return immediately instead of blocking on SIGINT. */
  waitForExit?: () => Promise<void>;
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
export const defaultOpener = async (urlOrPath: string): Promise<{ ok: boolean; error?: string }> => {
  return new Promise((resolve) => {
    let cmd: string;
    let args: string[];
    if (process.platform === 'win32') {
      // `start` is a cmd builtin, not an exe — use cmd /c.
      // The empty "" after start is the window title (start treats first
      // quoted arg as title, which mangles file paths with spaces).
      cmd = 'cmd';
      args = ['/c', 'start', '""', urlOrPath];
    } else if (process.platform === 'darwin') {
      cmd = 'open';
      args = [urlOrPath];
    } else {
      cmd = 'xdg-open';
      args = [urlOrPath];
    }
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true, shell: false });
    child.on('error', (err) => resolve({ ok: false, error: err.message }));
    child.on('spawn', () => {
      child.unref();
      resolve({ ok: true });
    });
  });
};

interface ParsedArgs {
  cwdArg?: string;
  runId?: string;
  latestOnly: boolean;
  printOnly: boolean;
  serve: boolean;
  port?: number;
  openBrowser: boolean;
  help: boolean;
}

function parseArgs(args: string[]): ParsedArgs {
  const out: ParsedArgs = {
    latestOnly: false,
    printOnly: false,
    serve: false,
    openBrowser: true,
    help: false,
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? '';
    if (a === '--run' && i + 1 < args.length) {
      out.runId = args[++i];
    } else if (a === '--latest') {
      out.latestOnly = true;
    } else if (a === '--print') {
      out.printOnly = true;
    } else if (a === '--serve') {
      out.serve = true;
    } else if (a === '--no-open') {
      out.openBrowser = false;
    } else if (a === '--port' && i + 1 < args.length) {
      const n = Number(args[++i]);
      if (Number.isFinite(n) && n >= 0 && n <= 65535) {
        out.port = n;
      }
    } else if (a === '--help' || a === '-h') {
      out.help = true;
    } else if (!a.startsWith('--') && !out.cwdArg) {
      out.cwdArg = a;
    }
  }
  return out;
}

function helpText(): string {
  return (
    'Usage: zerou review [<path>] [options]\n' +
    '\n' +
    'Default mode: opens enhance-report.html in your default browser.\n' +
    '\n' +
    'Options:\n' +
    '  --latest         Skip stable report; open most-recent archived run\n' +
    '  --run <ts>       Open a specific archived run\n' +
    '  --print          Print path only, do not open\n' +
    '  --serve          Start local UI server (React review dashboard)\n' +
    '  --port <n>       Port for --serve (default 7777; 0 = ephemeral)\n' +
    '  --no-open        Do not auto-open browser (use with --serve)\n' +
    '  -h, --help       Show this help\n'
  );
}

export async function runReview(opts: ReviewCliOpts): Promise<number> {
  const writeOut = opts.writeOut ?? ((s: string) => process.stdout.write(s));
  const writeErr = opts.writeErr ?? ((s: string) => process.stderr.write(s));

  const parsed = parseArgs(opts.argv.slice(3));

  if (parsed.help) {
    writeOut(helpText());
    return 0;
  }

  const cwd = path.resolve(parsed.cwdArg ?? process.cwd());
  if (!fs.existsSync(cwd)) {
    writeErr(`zerou review: path does not exist: ${cwd}\n`);
    return 2;
  }

  if (parsed.serve) {
    return await runReviewServe({
      cwd,
      port: parsed.port,
      openBrowser: parsed.openBrowser,
      writeOut,
      writeErr,
      opener: opts.opener ?? defaultOpener,
      startServer: opts.startServer,
      resolveUiDist: opts.resolveUiDist,
      waitForExit: opts.waitForExit,
    });
  }

  // ── File-open mode (Phase 11 behavior) ─────────────────────────────────
  const resolved = resolveReportPath({
    cwd,
    runId: parsed.runId,
    latestOnly: parsed.latestOnly,
  });
  if (!resolved.ok) {
    writeErr(`zerou review: ${resolved.reason}\n`);
    return 4;
  }

  writeOut(`📄 ${resolved.reportPath}\n`);
  if (resolved.runId) writeOut(`   run: ${resolved.runId}\n`);

  if (parsed.printOnly) return 0;

  const opener = opts.opener ?? defaultOpener;
  const r = await opener(resolved.reportPath);
  if (!r.ok) {
    writeErr(`zerou review: could not open browser: ${r.error ?? 'unknown'}\n`);
    writeErr(`Open this URL manually: file://${resolved.reportPath.replace(/\\/g, '/')}\n`);
    return 5;
  }
  return 0;
}

interface ServeArgs {
  cwd: string;
  port?: number;
  openBrowser: boolean;
  writeOut: (s: string) => void;
  writeErr: (s: string) => void;
  opener: (urlOrPath: string) => Promise<{ ok: boolean; error?: string }>;
  startServer?: ReviewCliOpts['startServer'];
  resolveUiDist?: () => Promise<string | null>;
  waitForExit?: () => Promise<void>;
}

async function runReviewServe(args: ServeArgs): Promise<number> {
  // 1. Locate ui/dist.
  let uiDistDir: string | null;
  if (args.resolveUiDist) {
    uiDistDir = await args.resolveUiDist();
  } else {
    // Resolve relative to *this file* (cli/dist/review.js once built; or
    // src/review.ts at dev time via tsx). Walk up to find ui/dist.
    let here: string;
    try {
      here = path.dirname(fileURLToPath(import.meta.url));
    } catch {
      // Fallback when import.meta is unavailable (e.g. some test runners).
      here = process.cwd();
    }
    uiDistDir = await locateUiDist(here);
  }

  if (!uiDistDir) {
    args.writeErr(
      'zerou review: ui/dist missing. run `pnpm -C ui build` first.\n',
    );
    return 4;
  }

  // 2. Start server.
  const logger = createTrackLogger('cli', { silent: true });
  let handle: ReviewServerHandle;
  try {
    if (args.startServer) {
      handle = await args.startServer({
        cwd: args.cwd,
        uiDistDir,
        port: args.port,
      });
    } else {
      handle = await startReviewServer({
        cwd: args.cwd,
        uiDistDir,
        port: args.port,
        logger,
      });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    args.writeErr(`zerou review: could not start server: ${msg}\n`);
    return 6;
  }

  args.writeOut(`🌐 ZeroU review UI: ${handle.url}\n`);
  args.writeOut(`   serving ui/dist from: ${uiDistDir}\n`);
  args.writeOut(`   project: ${args.cwd}\n`);
  args.writeOut('   Press Ctrl-C to stop.\n');

  // 3. Open browser.
  if (args.openBrowser) {
    const r = await args.opener(handle.url);
    if (!r.ok) {
      args.writeErr(
        `zerou review: could not open browser: ${r.error ?? 'unknown'}\n`,
      );
      args.writeErr(`Open this URL manually: ${handle.url}\n`);
    }
  }

  // 4. Wait until Ctrl-C (or test seam resolves).
  if (args.waitForExit) {
    await args.waitForExit();
  } else {
    await waitForSigint();
  }

  await handle.close();
  args.writeOut('zerou review: server stopped.\n');
  return 0;
}

function waitForSigint(): Promise<void> {
  return new Promise<void>((resolve) => {
    const handler = (): void => {
      process.off('SIGINT', handler);
      process.off('SIGTERM', handler);
      resolve();
    };
    process.on('SIGINT', handler);
    process.on('SIGTERM', handler);
  });
}
