/**
 * Tests for loadCorePaths.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadCorePaths } from './loader.js';

let tmpDir = '';

function setup(): string {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), 'd2p-cp-test-'));
  return tmpDir;
}

afterEach(() => {
  if (tmpDir) {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
    tmpDir = '';
  }
});

describe('loadCorePaths', () => {
  it('returns source=none when .d2p/core-paths.yaml is missing', () => {
    const root = setup();
    const result = loadCorePaths(root);
    expect(result.source).toBe('none');
    expect(result.globs).toEqual([]);
  });

  it('parses a top-level array yaml file', () => {
    const root = setup();
    mkdirSync(path.join(root, '.d2p'), { recursive: true });
    writeFileSync(
      path.join(root, '.d2p', 'core-paths.yaml'),
      '- lib/db/**\n- lib/auth/**\n- Dockerfile\n',
    );
    const result = loadCorePaths(root);
    expect(result.source).toBe('user');
    expect(result.globs).toEqual(['lib/db/**', 'lib/auth/**', 'Dockerfile']);
  });

  it('returns source=none for malformed yaml', () => {
    const root = setup();
    mkdirSync(path.join(root, '.d2p'), { recursive: true });
    // completely invalid yaml
    writeFileSync(path.join(root, '.d2p', 'core-paths.yaml'), ': : : garbage : [[[');
    const result = loadCorePaths(root);
    expect(result.source).toBe('none');
    expect(result.globs).toEqual([]);
  });

  it('handles empty yaml file gracefully', () => {
    const root = setup();
    mkdirSync(path.join(root, '.d2p'), { recursive: true });
    writeFileSync(path.join(root, '.d2p', 'core-paths.yaml'), '');
    const result = loadCorePaths(root);
    // empty file parses as null → source none
    expect(result.source).toBe('none');
    expect(result.globs).toEqual([]);
  });

  it('handles globs key format', () => {
    const root = setup();
    mkdirSync(path.join(root, '.d2p'), { recursive: true });
    writeFileSync(
      path.join(root, '.d2p', 'core-paths.yaml'),
      'globs:\n  - lib/payments/**\n  - prompts/**\n',
    );
    const result = loadCorePaths(root);
    expect(result.source).toBe('user');
    expect(result.globs).toEqual(['lib/payments/**', 'prompts/**']);
  });
});
