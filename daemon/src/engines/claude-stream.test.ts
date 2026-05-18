import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  extractAssistantText,
  makeUserTurnEnvelope,
  launchStreamRun,
  __test__,
  type TurnDonePayload,
  type StreamEvent,
} from './claude-stream.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fakeClaudePath = path.resolve(here, '../../../fixtures/fake-claude-stream.mjs');

function freshTmp(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('claude-stream — pure helpers', () => {
  describe('makeUserTurnEnvelope', () => {
    it('emits a single-line JSON user-turn envelope ending in \\n', () => {
      const s = makeUserTurnEnvelope('hi');
      expect(s.endsWith('\n')).toBe(true);
      const parsed = JSON.parse(s.trim());
      expect(parsed.type).toBe('user');
      expect(parsed.message.role).toBe('user');
      expect(parsed.message.content[0].type).toBe('text');
      expect(parsed.message.content[0].text).toBe('hi');
    });
  });

  describe('extractAssistantText', () => {
    it('returns empty for non-assistant events', () => {
      expect(extractAssistantText({ type: 'result' } as StreamEvent)).toBe('');
      expect(extractAssistantText({ type: 'system' } as StreamEvent)).toBe('');
    });

    it('concatenates text blocks', () => {
      const ev: StreamEvent = {
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'text', text: 'hello ' }, { type: 'text', text: 'world' }] },
      };
      expect(extractAssistantText(ev)).toBe('hello \nworld\n');
    });

    it('summarizes tool_use blocks', () => {
      const ev: StreamEvent = {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'tool_use', name: 'Read', input: { path: 'x.ts' } }],
        },
      };
      const out = extractAssistantText(ev);
      expect(out).toContain('[tool_use: Read]');
      expect(out).toContain('{"path":"x.ts"}');
    });
  });

  describe('makeNdjsonParser', () => {
    it('splits buffered chunks on newlines and parses JSON', () => {
      const events: StreamEvent[] = [];
      const p = __test__.makeNdjsonParser({ onEvent: (e) => events.push(e) });
      p.feed(Buffer.from('{"type":"system","subtype":"hook_started"}\n{"type":"as'));
      p.feed(Buffer.from('sistant","message":{"role":"assistant","content":[]}}\n'));
      expect(events).toHaveLength(2);
      expect(events[0]!.type).toBe('system');
      expect(events[1]!.type).toBe('assistant');
    });

    it('ignores blank lines', () => {
      const events: StreamEvent[] = [];
      const p = __test__.makeNdjsonParser({ onEvent: (e) => events.push(e) });
      p.feed(Buffer.from('\n\n{"type":"ok"}\n\n'));
      expect(events).toEqual([{ type: 'ok' }]);
    });

    it('reports malformed JSON via onError without breaking', () => {
      const events: StreamEvent[] = [];
      const errors: string[] = [];
      const p = __test__.makeNdjsonParser({
        onEvent: (e) => events.push(e),
        onError: (err) => errors.push(err.message),
      });
      p.feed(Buffer.from('not-json\n{"type":"ok"}\n'));
      expect(errors).toHaveLength(1);
      expect(events).toEqual([{ type: 'ok' }]);
    });
  });
});

const HAS_FAKE = fs.existsSync(fakeClaudePath);

describe.skipIf(!HAS_FAKE)('claude-stream — fake-cc integration', () => {
  it('parses hook + result events and fires onTurnDone once', async () => {
    const tmpDir = freshTmp('d2p-stream-int-');
    const cwd = freshTmp('d2p-stream-cwd-');
    const d2pHome = freshTmp('d2p-stream-home-');

    const turnsFired: TurnDonePayload[] = [];
    const handle = launchStreamRun(
      {
        cwd,
        prompt: 'hi cc',
        runId: 'r-int-1',
        role: 'implementer',
      },
      {
        claudeBin: fakeClaudePath,
        tmpDir,
        d2pHome,
        idleTimeoutMs: 5000,
        onTurnDone: (p) => turnsFired.push(p),
      },
    );

    await new Promise<void>((resolve) => handle.child.once('exit', () => resolve()));

    expect(turnsFired).toHaveLength(1);
    expect(turnsFired[0]!.source).toBe('hook');
    expect(turnsFired[0]!.sessionId).toBe('fake-session-abc');
    expect(handle.getSessionId()).toBe('fake-session-abc');
    expect(handle.getStats().eventCount).toBeGreaterThan(0);
  });
});
