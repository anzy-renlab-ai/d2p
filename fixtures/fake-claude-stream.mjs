#!/usr/bin/env node
// Fake `claude --output-format stream-json --input-format stream-json` for
// claude-stream.test.ts integration coverage. Emits the same NDJSON shape
// the real binary does on a single-turn run: system hook events + an
// assistant text event + a result event, then exits 0.
//
// The launcher passes through --settings / --mcp-config / --include-hook-events
// / --resume / --permission-mode etc; we ignore those — we just need to emit
// a believable event stream.

import { stdin, stdout } from 'node:process';

function write(obj) {
  stdout.write(JSON.stringify(obj) + '\n');
}

// Read the initial user-turn envelope. We don't echo back anything from it —
// the launcher's contract is "stdin can stay open" and we exit before any
// follow-up turn would come.
let buf = '';
stdin.on('data', (chunk) => {
  buf += chunk;
});
stdin.on('end', () => {
  // never called in normal launcher flow (stdin stays open) — but lets
  // node-test harnesses pipe and close.
});

// Simulate cc startup → SessionStart hook fires.
setTimeout(() => {
  write({
    type: 'system',
    subtype: 'hook_started',
    hook_event: 'SessionStart',
    session_id: 'fake-session-abc',
  });
  write({
    type: 'system',
    subtype: 'hook_response',
    hook_event: 'SessionStart',
    session_id: 'fake-session-abc',
    stdout: JSON.stringify({
      transcript_path: '/tmp/fake-transcript.jsonl',
      session_id: 'fake-session-abc',
    }),
    stderr: '',
    exit_code: 0,
  });
}, 50);

// Assistant produces some text.
setTimeout(() => {
  write({
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: 'fake response: turn complete' }],
    },
    session_id: 'fake-session-abc',
  });
}, 120);

// Stop hook fires — turn done. stop_hook_active = false → real turn-done.
setTimeout(() => {
  const stopPayload = {
    session_id: 'fake-session-abc',
    transcript_path: '/tmp/fake-transcript.jsonl',
    last_assistant_message: 'fake response: turn complete',
    stop_hook_active: false,
  };
  write({
    type: 'system',
    subtype: 'hook_started',
    hook_event: 'Stop',
    session_id: 'fake-session-abc',
  });
  write({
    type: 'system',
    subtype: 'hook_response',
    hook_event: 'Stop',
    session_id: 'fake-session-abc',
    stdout: JSON.stringify(stopPayload),
    stderr: '',
    exit_code: 0,
  });
}, 200);

// Final result event.
setTimeout(() => {
  write({
    type: 'result',
    subtype: 'success',
    session_id: 'fake-session-abc',
    is_error: false,
  });
  // exit cleanly
  setTimeout(() => process.exit(0), 30);
}, 280);
