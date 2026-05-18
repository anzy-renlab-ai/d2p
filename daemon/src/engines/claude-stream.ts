import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { buildMcpConfigFile } from './claude-mcp-cfg.js';
import { buildHookSettingsFile } from './claude-hooks.js';

// Long-lived Claude Code launcher for multi-turn implementer / reviewer runs.
//
// Single-turn `--print` mode lives in claude-cli.ts and stays the default.
// This launcher is the path the multi-turn driver (Batch 4) takes for complex
// gaps: `claude --output-format stream-json --input-format stream-json
// --verbose --permission-mode bypassPermissions --mcp-config <tmp>
// --strict-mcp-config --settings <tmp-hooks> --include-hook-events
// [--resume <id>]`.
//
// API:
//   const handle = launchStreamRun({ cwd, prompt, runId, role, ... }, opts);
//   handle.writeNextTurn('follow-up prompt');
//   ...
//   opts.onTurnDone({ source, turnIndex, sessionId, lastAssistantText, ... })
//     fires once per turn, primarily from the Stop hook payload (echoed back
//     via `hook_response.stdout`) and fallback from cc's `result` event.
//
// Ported from Cairn's claude-stream-launcher.cjs (refer to that file's plan
// notes for hooks-protocol rationale + dedupe semantics).

export type TurnDoneSource = 'hook' | 'result';

export interface TurnDonePayload {
  source: TurnDoneSource;
  turnIndex: number;
  sessionId: string | null;
  lastAssistantText: string | null;
  transcriptPath: string | null;
  stopHookActive: boolean;
  raw: unknown;
}

export interface StreamEvent {
  type?: string;
  subtype?: string;
  hook_event?: string;
  session_id?: string;
  stdout?: string;
  is_error?: boolean;
  message?: { role?: string; content?: unknown[] };
  [k: string]: unknown;
}

export interface LaunchStreamInput {
  cwd: string;
  prompt: string;
  runId: string;
  /** implementer / reviewer / etc — paired with runId for cc-session resume. */
  role: string;
  /** When set, argv carries `--resume <sessionId>` and cc rehydrates the
   *  prior context instead of starting fresh. */
  resumeSessionId?: string | null;
  env?: NodeJS.ProcessEnv;
}

export interface LaunchStreamOpts {
  /** override ~/.d2p root, used by tests */
  d2pHome?: string;
  /** path to the claude executable; defaults to whichClaude() */
  claudeBin?: string;
  /** override os.tmpdir() for the mcp + settings temp files */
  tmpDir?: string;
  /** ms with no NDJSON event before we kill the child. Default 10 min. */
  idleTimeoutMs?: number;
  /** fires once per cc turn — primary signal for the multi-turn driver. */
  onTurnDone?: (p: TurnDonePayload) => void;
  /** fires for every parsed NDJSON event (after our own hook handling). */
  onEvent?: (e: StreamEvent) => void;
  /** fires for human-readable assistant text only. */
  onAssistantText?: (s: string) => void;
}

export interface StreamHandle {
  runId: string;
  child: ChildProcess;
  /** Append a follow-up user turn to the running cc session. Bumps turn
   *  index and re-opens the Stop-hook dedupe gate so the next Stop fires
   *  exactly once. Returns false if stdin is gone. */
  writeNextTurn: (prompt: string) => boolean;
  /** Final cc session_id captured from hook / result event. null until cc
   *  first emits it. */
  getSessionId: () => string | null;
  /** Latest event count + last-event timestamp (for liveness checks). */
  getStats: () => { eventCount: number; lastEventAt: number | null };
}

const DEFAULT_IDLE_TIMEOUT_MS = 10 * 60 * 1000;

function newRunIdPrefix(): string {
  return 'd2p-stream-' + crypto.randomBytes(5).toString('hex');
}

export function whichClaude(): string | null {
  const exts = process.platform === 'win32' ? ['.cmd', '.exe', '.bat'] : [''];
  const sep = process.platform === 'win32' ? ';' : ':';
  for (const dir of (process.env.PATH ?? '').split(sep)) {
    if (!dir) continue;
    for (const ext of exts) {
      const p = path.join(dir, 'claude' + ext);
      try {
        if (fs.statSync(p).isFile()) return p;
      } catch {
        /* nope */
      }
    }
  }
  return null;
}

/** stream-json user-turn envelope cc expects. */
export function makeUserTurnEnvelope(prompt: string): string {
  return (
    JSON.stringify({
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: String(prompt) }] },
    }) + '\n'
  );
}

/** Extract assistant text + tool-use one-liners from an `assistant` event. */
export function extractAssistantText(ev: StreamEvent): string {
  if (!ev || ev.type !== 'assistant') return '';
  const msg = ev.message;
  if (!msg || !Array.isArray(msg.content)) return '';
  const parts: string[] = [];
  for (const block of msg.content) {
    if (!block || typeof block !== 'object') continue;
    const b = block as { type?: string; text?: string; name?: string; input?: unknown };
    if (b.type === 'text' && typeof b.text === 'string') parts.push(b.text);
    else if (b.type === 'tool_use') {
      const name = String(b.name ?? '?');
      const preview = b.input ? JSON.stringify(b.input).slice(0, 120) : '';
      parts.push(`[tool_use: ${name}] ${preview}`);
    }
  }
  return parts.length > 0 ? parts.join('\n') + '\n' : '';
}

/** Append-only NDJSON line parser fed by stdout 'data' events. Handles
 *  partial lines across chunk boundaries. Bad lines are reported via
 *  onError but do not stop the stream. */
function makeNdjsonParser(args: {
  onEvent: (ev: StreamEvent) => void;
  onError?: (err: Error, raw: string) => void;
}): { feed: (chunk: Buffer) => void; flush: () => void } {
  let buf = '';
  return {
    feed(chunk: Buffer) {
      buf += chunk.toString('utf8');
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          args.onEvent(JSON.parse(trimmed) as StreamEvent);
        } catch (e) {
          args.onError?.(e as Error, trimmed);
        }
      }
    },
    flush() {
      const trimmed = buf.trim();
      buf = '';
      if (!trimmed) return;
      try {
        args.onEvent(JSON.parse(trimmed) as StreamEvent);
      } catch (e) {
        args.onError?.(e as Error, trimmed);
      }
    },
  };
}

export class StreamSpawnError extends Error {
  constructor(public reason: string, public detail?: string) {
    super(reason + (detail ? ': ' + detail : ''));
    this.name = 'StreamSpawnError';
  }
}

export function launchStreamRun(
  input: LaunchStreamInput,
  opts: LaunchStreamOpts = {},
): StreamHandle {
  if (!input.cwd) throw new StreamSpawnError('cwd_required');
  if (!input.prompt || !input.prompt.trim()) throw new StreamSpawnError('prompt_required');
  if (!fs.existsSync(input.cwd)) throw new StreamSpawnError('cwd_not_found', input.cwd);
  if (!input.runId) throw new StreamSpawnError('runId_required');

  const claudeBin = opts.claudeBin ?? whichClaude();
  if (!claudeBin) throw new StreamSpawnError('claude_not_found_in_path');

  const mcp = buildMcpConfigFile({
    runId: input.runId,
    projectRoot: input.cwd,
    tmpDir: opts.tmpDir,
  });
  let hooks: ReturnType<typeof buildHookSettingsFile>;
  try {
    hooks = buildHookSettingsFile({
      runId: input.runId,
      d2pHome: opts.d2pHome,
      tmpDir: opts.tmpDir,
    });
  } catch (e) {
    mcp.cleanup();
    throw new StreamSpawnError('hook_settings_failed', (e as Error).message);
  }

  const argv: string[] = [
    '--output-format', 'stream-json',
    '--input-format', 'stream-json',
    '--verbose',
    '--permission-mode', 'bypassPermissions',
    '--mcp-config', mcp.tempPath,
    '--strict-mcp-config',
    '--settings', hooks.settingsPath,
    '--include-hook-events',
  ];
  if (input.resumeSessionId) {
    if (typeof input.resumeSessionId !== 'string' || !input.resumeSessionId.trim()) {
      mcp.cleanup();
      hooks.cleanup();
      throw new StreamSpawnError('resume_session_id_invalid');
    }
    argv.push('--resume', input.resumeSessionId);
  }

  // Resolve how to invoke the launcher binary:
  //   - .mjs / .cjs / .js (typically a test fake): spawn `node <script> ...`
  //   - .cmd / .bat on Windows: route via cmd.exe so Node quoting is correct
  //   - everything else: spawn directly
  let execCmd = claudeBin;
  let execArgs = argv;
  if (/\.(mjs|cjs|js)$/i.test(claudeBin)) {
    execCmd = process.execPath;
    execArgs = [claudeBin, ...argv];
  } else if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(claudeBin)) {
    execCmd = process.env.ComSpec ?? 'cmd.exe';
    execArgs = ['/d', '/s', '/c', claudeBin, ...argv];
  }

  let child: ChildProcess;
  try {
    child = spawn(execCmd, execArgs, {
      cwd: input.cwd,
      env: input.env ?? process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      shell: false,
    });
  } catch (e) {
    mcp.cleanup();
    hooks.cleanup();
    throw new StreamSpawnError('spawn_threw', (e as Error).message);
  }
  if (child.pid == null) {
    mcp.cleanup();
    hooks.cleanup();
    throw new StreamSpawnError('no_pid');
  }

  // Per-spawn hook + run state.
  const hookState = { turnIndex: 0, firedForTurn: -1 };
  let sessionId: string | null = null;
  let eventCount = 0;
  let lastEventAt: number | null = null;

  const idleMs = opts.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
  let watchdog: NodeJS.Timeout | null = null;
  const bumpWatchdog = () => {
    if (watchdog) clearTimeout(watchdog);
    watchdog = setTimeout(() => {
      try {
        child.kill('SIGTERM');
      } catch {
        /* already gone */
      }
      setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          /* already gone */
        }
      }, 5000).unref();
    }, idleMs);
    watchdog.unref?.();
  };
  bumpWatchdog();

  const handleEvent = (ev: StreamEvent): void => {
    eventCount += 1;
    lastEventAt = Date.now();
    bumpWatchdog();

    // assistant text → caller callback (for UI streaming)
    const text = extractAssistantText(ev);
    if (text && opts.onAssistantText) {
      try {
        opts.onAssistantText(text);
      } catch {
        /* swallow callback errors */
      }
    }

    // Hook events — primary turn-done signal.
    if (ev.type === 'system' && typeof ev.subtype === 'string' && ev.subtype.startsWith('hook_')) {
      if (typeof ev.session_id === 'string' && ev.session_id && !sessionId) {
        sessionId = ev.session_id;
      }
      if (ev.hook_event === 'Stop' && ev.subtype === 'hook_response') {
        let payload: { stop_hook_active?: boolean; session_id?: string; last_assistant_message?: string; transcript_path?: string } | null = null;
        if (typeof ev.stdout === 'string' && ev.stdout.length > 0) {
          try {
            payload = JSON.parse(ev.stdout);
          } catch {
            payload = null;
          }
        }
        const stopHookActive = payload?.stop_hook_active === true;
        if (!stopHookActive && hookState.firedForTurn !== hookState.turnIndex) {
          hookState.firedForTurn = hookState.turnIndex;
          const sid = typeof payload?.session_id === 'string' ? payload.session_id : null;
          if (sid) sessionId = sid;
          const lat = typeof payload?.last_assistant_message === 'string' ? payload.last_assistant_message : null;
          const tp = typeof payload?.transcript_path === 'string' ? payload.transcript_path : null;
          try {
            opts.onTurnDone?.({
              source: 'hook',
              turnIndex: hookState.turnIndex,
              sessionId,
              lastAssistantText: lat,
              transcriptPath: tp,
              stopHookActive: false,
              raw: payload,
            });
          } catch {
            /* swallow callback errors */
          }
        }
      }
    }

    // Result event — Phase-2 sid capture + fallback turn-done when hook
    // didn't fire (older cc version, hook command crashed, etc).
    if (ev.type === 'result') {
      if (typeof ev.session_id === 'string') sessionId = ev.session_id;
      if (hookState.firedForTurn !== hookState.turnIndex) {
        hookState.firedForTurn = hookState.turnIndex;
        try {
          opts.onTurnDone?.({
            source: 'result',
            turnIndex: hookState.turnIndex,
            sessionId,
            lastAssistantText: null,
            transcriptPath: null,
            stopHookActive: false,
            raw: ev,
          });
        } catch {
          /* swallow */
        }
      }
    }

    if (opts.onEvent) {
      try {
        opts.onEvent(ev);
      } catch {
        /* swallow */
      }
    }
  };

  const parser = makeNdjsonParser({ onEvent: handleEvent });
  child.stdout?.on('data', (chunk: Buffer) => parser.feed(chunk));
  child.stdout?.on('end', () => parser.flush());

  // Initial user turn — write but DO NOT end stdin. Stays open for
  // writeNextTurn follow-ups.
  try {
    child.stdin?.write(makeUserTurnEnvelope(input.prompt));
  } catch {
    /* if stdin failed, exit handler will catch and clean up */
  }

  child.on('exit', () => {
    if (watchdog) clearTimeout(watchdog);
    mcp.cleanup();
    hooks.cleanup();
  });
  child.on('error', () => {
    if (watchdog) clearTimeout(watchdog);
    mcp.cleanup();
    hooks.cleanup();
  });

  return {
    runId: input.runId,
    child,
    writeNextTurn(prompt: string): boolean {
      if (!child.stdin || child.killed || child.stdin.destroyed) return false;
      hookState.turnIndex += 1;
      hookState.firedForTurn = hookState.turnIndex - 1;
      try {
        child.stdin.write(makeUserTurnEnvelope(prompt));
        bumpWatchdog();
        return true;
      } catch {
        hookState.turnIndex -= 1;
        hookState.firedForTurn = hookState.turnIndex;
        return false;
      }
    },
    getSessionId() {
      return sessionId;
    },
    getStats() {
      return { eventCount, lastEventAt };
    },
  };
}

// Exposed for tests
export const __test__ = {
  newRunIdPrefix,
  makeNdjsonParser,
};
