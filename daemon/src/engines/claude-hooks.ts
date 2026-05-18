import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// Per-spawn `--settings <file>` builder for Claude Code's hook system.
// Based on Cairn's claude-settings-config.cjs design — same Windows-safe
// inline `node -e` payload technique, simplified to d2p directory layout.
//
// We register SessionStart + Stop hooks. The Stop hook fires when cc finishes
// a turn; its payload (transcript_path / last_assistant_message / session_id /
// stop_hook_active) is the turn-done signal the multi-turn driver subscribes
// to in Batch 4.
//
// Dual-channel: each hook (a) appends the raw payload to a per-run jsonl
// audit file on disk, (b) echoes the payload back on stdout so cc captures
// it inside the `hook_response.stdout` NDJSON event the launcher parses.
// Disk path survives cc crash mid-flush; NDJSON path is the low-latency feed.

export interface BuildHookSettingsInput {
  runId: string;
  /** override ~/.d2p ; defaults to os.homedir() + '/.d2p' */
  d2pHome?: string;
  /** override os.tmpdir() — used by tests */
  tmpDir?: string;
}

export interface BuildHookSettingsResult {
  settingsPath: string;
  hookEventsPath: string;
  cleanup: () => void;
}

/** Path the hook command appends each payload to. */
function hookEventsFile(runId: string, d2pHome?: string): string {
  const base = d2pHome ?? path.join(os.homedir(), '.d2p');
  return path.join(base, 'run-events', runId, 'hook-events.jsonl');
}

/** Build the `node -e` shell command the hook executes. Windows-safe: outer
 *  shell argument is double-quoted, so the JS source uses single-quoted
 *  string literals and double-escaped backslashes for the path. */
export function buildHookCommand(hookEventsPath: string): string {
  const escapedPath =
    "'" + hookEventsPath.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
  return [
    `node -e "`,
    `let s='';`,
    `process.stdin.on('data',d=>s+=d);`,
    `process.stdin.on('end',()=>{`,
    `try{require('fs').mkdirSync(require('path').dirname(${escapedPath}),{recursive:true})}catch(_e){}`,
    `try{require('fs').appendFileSync(${escapedPath},s+'\\n')}catch(_e){}`,
    `try{process.stdout.write(s)}catch(_e){}`,
    `});`,
    `"`,
  ].join('');
}

/** Build the settings.json object the hook config writes to disk. */
export function buildHookSettingsObject(hookEventsPath: string): {
  hooks: { SessionStart: unknown[]; Stop: unknown[] };
} {
  const cmd = buildHookCommand(hookEventsPath);
  return {
    hooks: {
      SessionStart: [{ hooks: [{ type: 'command', command: cmd }] }],
      Stop: [{ hooks: [{ type: 'command', command: cmd }] }],
    },
  };
}

export function buildHookSettingsFile(input: BuildHookSettingsInput): BuildHookSettingsResult {
  if (!input.runId) throw new Error('runId required');
  const tmpDir = input.tmpDir ?? os.tmpdir();
  const settingsPath = path.join(tmpDir, `d2p-claude-settings-${input.runId}.json`);
  const hookEventsPath = hookEventsFile(input.runId, input.d2pHome);

  fs.writeFileSync(
    settingsPath,
    JSON.stringify(buildHookSettingsObject(hookEventsPath), null, 2),
    'utf8',
  );

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    try {
      fs.unlinkSync(settingsPath);
    } catch {
      /* already gone */
    }
  };

  return { settingsPath, hookEventsPath, cleanup };
}
