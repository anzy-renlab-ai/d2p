/**
 * Tests for checkChangedFiles + matchGlob + globToRegex.
 */

import { describe, it, expect } from 'vitest';
import { checkChangedFiles, matchGlob, globToRegex } from './checker.js';

describe('globToRegex', () => {
  it('converts ** to match any path', () => {
    const re = globToRegex('lib/db/**');
    expect(re.test('lib/db/schema.ts')).toBe(true);
    expect(re.test('lib/db/nested/deep.ts')).toBe(true);
    expect(re.test('lib/auth/index.ts')).toBe(false);
  });

  it('converts * to match within a segment', () => {
    const re = globToRegex('src/*.ts');
    expect(re.test('src/foo.ts')).toBe(true);
    expect(re.test('src/bar.tsx')).toBe(false);
    expect(re.test('src/nested/foo.ts')).toBe(false);
  });

  it('matches literal paths exactly', () => {
    const re = globToRegex('Dockerfile');
    expect(re.test('Dockerfile')).toBe(true);
    expect(re.test('docker/Dockerfile')).toBe(false);
  });

  it('handles .d2p/core-paths.yaml style path', () => {
    const re = globToRegex('.github/workflows/**');
    expect(re.test('.github/workflows/ci.yml')).toBe(true);
    expect(re.test('.github/other/foo.yml')).toBe(false);
  });
});

describe('matchGlob', () => {
  it('matches forward-slash paths', () => {
    expect(matchGlob('lib/db/**', 'lib/db/schema.ts')).toBe(true);
    expect(matchGlob('lib/db/**', 'lib/auth/index.ts')).toBe(false);
  });

  it('normalizes backslashes on input', () => {
    expect(matchGlob('lib/db/**', 'lib\\db\\schema.ts')).toBe(true);
  });

  it('matches package.json exactly', () => {
    expect(matchGlob('package.json', 'package.json')).toBe(true);
    expect(matchGlob('package.json', 'nested/package.json')).toBe(false);
  });
});

describe('checkChangedFiles', () => {
  it('returns empty hits when no globs', () => {
    const result = checkChangedFiles(['src/foo.ts', 'lib/db/x.ts'], []);
    expect(result.hits).toEqual([]);
    expect(result.matchedGlob).toEqual({});
  });

  it('returns empty hits when no paths match', () => {
    const result = checkChangedFiles(['src/foo.ts', 'src/bar.ts'], ['lib/db/**']);
    expect(result.hits).toEqual([]);
  });

  it('returns hits for matching paths', () => {
    const paths = ['src/feature.ts', 'lib/db/schema.ts', 'lib/auth/index.ts'];
    const result = checkChangedFiles(paths, ['lib/db/**', 'lib/auth/**']);
    expect(result.hits.sort()).toEqual(['lib/auth/index.ts', 'lib/db/schema.ts']);
    expect(result.matchedGlob['lib/db/schema.ts']).toBe('lib/db/**');
    expect(result.matchedGlob['lib/auth/index.ts']).toBe('lib/auth/**');
  });

  it('first glob wins for a path matching multiple globs', () => {
    const paths = ['lib/db/schema.ts'];
    const result = checkChangedFiles(paths, ['lib/**', 'lib/db/**']);
    expect(result.matchedGlob['lib/db/schema.ts']).toBe('lib/**');
  });

  it('handles empty path list', () => {
    const result = checkChangedFiles([], ['lib/db/**']);
    expect(result.hits).toEqual([]);
  });
});
