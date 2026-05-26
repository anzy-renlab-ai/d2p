/**
 * Tests for runtime-detector.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { detectRuntime } from './runtime-detector.js';
import {
  createTrackLogger,
  captureLogsFor,
  __resetMetaLoggersForTests,
  __resetLiveLoggersForTests,
  __resetRotationGateForTests,
} from '../../log-types.js';

beforeEach(() => {
  __resetMetaLoggersForTests();
  __resetLiveLoggersForTests();
  __resetRotationGateForTests();
});
afterEach(() => {
  __resetMetaLoggersForTests();
  __resetLiveLoggersForTests();
  __resetRotationGateForTests();
});

interface Tmp {
  dir: string;
  cleanup: () => void;
}
function mkTmpWith(pkg: unknown): Tmp {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-detect-'));
  if (pkg !== null) {
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg, null, 2), 'utf8');
  }
  return {
    dir,
    cleanup: () => {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    },
  };
}

describe('detectRuntime', () => {
  it('detects next-dev when scripts.dev runs next', async () => {
    const { dir, cleanup } = mkTmpWith({ scripts: { dev: 'next dev' } });
    try {
      const r = await detectRuntime(dir);
      expect(r).not.toBeNull();
      expect(r!.strategy).toBe('next-dev');
      expect(r!.expectedPort).toBe(3000);
      expect(r!.command).toBe('npm');
      expect(r!.args).toEqual(['run', 'dev']);
    } finally {
      cleanup();
    }
  });

  it('detects vite-dev when scripts.dev runs vite', async () => {
    const { dir, cleanup } = mkTmpWith({ scripts: { dev: 'vite' } });
    try {
      const r = await detectRuntime(dir);
      expect(r).not.toBeNull();
      expect(r!.strategy).toBe('vite-dev');
      expect(r!.expectedPort).toBe(5173);
    } finally {
      cleanup();
    }
  });

  it('detects node-script when scripts.dev runs node', async () => {
    const { dir, cleanup } = mkTmpWith({ scripts: { dev: 'node server.js' } });
    try {
      const r = await detectRuntime(dir);
      expect(r).not.toBeNull();
      expect(r!.strategy).toBe('node-script');
      expect(r!.expectedPort).toBe(3000);
    } finally {
      cleanup();
    }
  });

  it('detects node-script via tsx', async () => {
    const { dir, cleanup } = mkTmpWith({ scripts: { dev: 'tsx server.ts' } });
    try {
      const r = await detectRuntime(dir);
      expect(r).not.toBeNull();
      expect(r!.strategy).toBe('node-script');
    } finally {
      cleanup();
    }
  });

  it('extracts PORT from node script', async () => {
    const { dir, cleanup } = mkTmpWith({ scripts: { dev: 'PORT=4567 node server.js' } });
    try {
      const r = await detectRuntime(dir);
      expect(r!.strategy).toBe('node-script');
      expect(r!.expectedPort).toBe(4567);
    } finally {
      cleanup();
    }
  });

  it('extracts --port flag', async () => {
    const { dir, cleanup } = mkTmpWith({ scripts: { dev: 'node server.js --port 8080' } });
    try {
      const r = await detectRuntime(dir);
      expect(r!.strategy).toBe('node-script');
      expect(r!.expectedPort).toBe(8080);
    } finally {
      cleanup();
    }
  });

  it('falls back to next-start when only start is defined', async () => {
    const { dir, cleanup } = mkTmpWith({ scripts: { start: 'next start' } });
    try {
      const r = await detectRuntime(dir);
      expect(r!.strategy).toBe('next-start');
    } finally {
      cleanup();
    }
  });

  it('returns null when no package.json', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-detect-empty-'));
    try {
      const r = await detectRuntime(dir);
      expect(r).toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns null when scripts have no recognised runtime', async () => {
    const { dir, cleanup } = mkTmpWith({ scripts: { build: 'webpack' } });
    try {
      const r = await detectRuntime(dir);
      expect(r).toBeNull();
    } finally {
      cleanup();
    }
  });

  it('emits agent.runtime.detect.* events to logger', async () => {
    const { dir, cleanup } = mkTmpWith({ scripts: { dev: 'next dev' } });
    try {
      const logger = createTrackLogger('agent', { minLevel: 'debug' });
      const { entries } = await captureLogsFor({ track: 'agent' }, async () => {
        await detectRuntime(dir, logger);
        await logger.flush();
      });
      const events = entries.map((e) => e.event);
      expect(events).toContain('agent.runtime.detect.start');
      expect(events).toContain('agent.runtime.detect.package-json-found');
      expect(events).toContain('agent.runtime.detect.strategy-decision');
      expect(events).toContain('agent.runtime.detect.complete');
    } finally {
      cleanup();
    }
  });
});
