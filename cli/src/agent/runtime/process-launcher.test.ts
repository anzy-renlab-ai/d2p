/**
 * Tests for process-launcher.
 *
 * Strategy: spawn a real Node child (tiny http server fixture). Each test
 * uses an ephemeral port + has an afterEach kill hatch so no zombie leaks.
 */
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { launchRuntime } from './process-launcher.js';
import type { DetectedRuntime, RuntimeProcess } from './types.js';
import { getFreePort } from './__fixtures__/get-port.js';
import {
  __resetMetaLoggersForTests,
  __resetLiveLoggersForTests,
  __resetRotationGateForTests,
} from '../../log-types.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_OK = path.join(here, '__fixtures__', 'node-server-ok');
const FIXTURE_CRASH = path.join(here, '__fixtures__', 'node-crash');

let leakedProcs: RuntimeProcess[] = [];

beforeEach(() => {
  __resetMetaLoggersForTests();
  __resetLiveLoggersForTests();
  __resetRotationGateForTests();
  leakedProcs = [];
});
afterEach(async () => {
  // Kill any process the test forgot to clean up.
  for (const p of leakedProcs) {
    try {
      await p.kill();
    } catch {
      /* ignore */
    }
  }
  __resetMetaLoggersForTests();
  __resetLiveLoggersForTests();
  __resetRotationGateForTests();
});

function detectedFor(port: number, cwd: string): DetectedRuntime {
  return {
    strategy: 'node-script',
    command: 'node',
    args: [path.join(cwd, 'server.js')],
    expectedPort: port,
    readyTimeoutMs: 8000,
    envVars: { PORT: String(port) },
  };
}

describe('launchRuntime', () => {
  it('launches a node server and resolves once port is ready', async () => {
    const port = await getFreePort();
    const detected = detectedFor(port, FIXTURE_OK);
    const proc = await launchRuntime(detected, {
      cwd: FIXTURE_OK,
      pollIntervalMs: 100,
    });
    leakedProcs.push(proc);
    expect(proc.pid).toBeGreaterThan(0);
    expect(proc.port).toBe(port);
    expect(proc.baseUrl).toBe(`http://localhost:${port}`);
    // Verify it's actually serving.
    const res = await fetch(`${proc.baseUrl}/healthz`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, name: 'fixture' });
    await proc.kill();
  });

  it('rejects when the child crashes before ready', async () => {
    const port = await getFreePort();
    const detected = detectedFor(port, FIXTURE_CRASH);
    detected.readyTimeoutMs = 5000;
    await expect(
      launchRuntime(detected, { cwd: FIXTURE_CRASH, pollIntervalMs: 100 }),
    ).rejects.toThrow(/crashed/);
  });

  it('rejects with timeout when port never opens', async () => {
    // Launch the OK fixture but ask launcher to poll a DIFFERENT port — the
    // server listens on `port` (via PORT env) but launcher polls `wrongPort`,
    // which will never open. The fixture stays alive so we hit the timeout
    // branch (not the crash branch).
    const port = await getFreePort();
    const wrongPort = await getFreePort();
    expect(port).not.toBe(wrongPort);
    const detected: DetectedRuntime = {
      strategy: 'node-script',
      command: 'node',
      args: [path.join(FIXTURE_OK, 'server.js')],
      expectedPort: wrongPort,
      readyTimeoutMs: 1200,
      envVars: { PORT: String(port) },
    };
    await expect(
      launchRuntime(detected, { cwd: FIXTURE_OK, pollIntervalMs: 100 }),
    ).rejects.toThrow(/did not open port/);
  });

  it('kill is idempotent', async () => {
    const port = await getFreePort();
    const detected = detectedFor(port, FIXTURE_OK);
    const proc = await launchRuntime(detected, {
      cwd: FIXTURE_OK,
      pollIntervalMs: 100,
    });
    leakedProcs.push(proc);
    await proc.kill();
    // Second kill should not throw.
    await expect(proc.kill()).resolves.toBeUndefined();
  });
});
