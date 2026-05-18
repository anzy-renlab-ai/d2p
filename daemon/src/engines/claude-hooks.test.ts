import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  buildHookCommand,
  buildHookSettingsObject,
  buildHookSettingsFile,
} from './claude-hooks.js';

function freshTmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2p-hooks-test-'));
  return dir;
}

describe('claude-hooks', () => {
  describe('buildHookCommand', () => {
    it('wraps node -e with the path JSON-escaped', () => {
      const cmd = buildHookCommand('C:\\Users\\x\\.d2p\\run-events\\r1\\hook-events.jsonl');
      expect(cmd).toMatch(/^node -e "/);
      expect(cmd).toMatch(/let s='';/);
      expect(cmd).toMatch(/process\.stdin\.on\('data'/);
      // backslashes doubled
      expect(cmd).toMatch(/'C:\\\\Users\\\\x\\\\\.d2p\\\\run-events\\\\r1\\\\hook-events\.jsonl'/);
    });

    it('survives single quote in path by escaping', () => {
      const cmd = buildHookCommand("/tmp/it's/hooks.jsonl");
      expect(cmd).toMatch(/'\/tmp\/it\\'s\/hooks\.jsonl'/);
    });

    it('does not contain double quotes inside the JS body (Windows shell safety)', () => {
      const cmd = buildHookCommand('/tmp/x.jsonl');
      // The OUTER wrapper is node -e "<body>" so any inner " would break cmd.exe.
      const body = cmd.slice('node -e "'.length, -1); // strip wrapper
      expect(body).not.toMatch(/[^\\]"/);
    });
  });

  describe('buildHookSettingsObject', () => {
    it('registers SessionStart and Stop with the same command', () => {
      const obj = buildHookSettingsObject('/tmp/h.jsonl');
      expect(obj.hooks.SessionStart).toHaveLength(1);
      expect(obj.hooks.Stop).toHaveLength(1);
      const ss = obj.hooks.SessionStart[0] as { hooks: { type: string; command: string }[] };
      const st = obj.hooks.Stop[0] as { hooks: { type: string; command: string }[] };
      expect(ss.hooks[0]!.command).toEqual(st.hooks[0]!.command);
      expect(ss.hooks[0]!.type).toBe('command');
    });
  });

  describe('buildHookSettingsFile', () => {
    it('writes valid JSON to a per-run path', () => {
      const tmpDir = freshTmp();
      const d2pHome = freshTmp();
      const r = buildHookSettingsFile({ runId: 'run-A', tmpDir, d2pHome });
      expect(fs.existsSync(r.settingsPath)).toBe(true);
      expect(r.settingsPath).toContain('run-A');
      const parsed = JSON.parse(fs.readFileSync(r.settingsPath, 'utf8'));
      expect(parsed.hooks.SessionStart).toBeDefined();
      expect(parsed.hooks.Stop).toBeDefined();
      // hookEventsPath points into d2pHome/run-events/run-A
      expect(r.hookEventsPath).toContain(d2pHome);
      expect(r.hookEventsPath).toContain('run-A');
      r.cleanup();
      expect(fs.existsSync(r.settingsPath)).toBe(false);
    });

    it('cleanup is idempotent', () => {
      const tmpDir = freshTmp();
      const r = buildHookSettingsFile({ runId: 'run-B', tmpDir });
      r.cleanup();
      r.cleanup(); // must not throw
      expect(fs.existsSync(r.settingsPath)).toBe(false);
    });

    it('throws if runId missing', () => {
      // @ts-expect-error testing runtime validation
      expect(() => buildHookSettingsFile({})).toThrow(/runId/);
    });
  });
});
