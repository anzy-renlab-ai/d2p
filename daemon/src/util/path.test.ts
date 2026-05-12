import { describe, it, expect } from 'vitest';
import { asAbsPath, isInside, computeWorktreePath, NotAbsoluteError } from './path.js';

describe('asAbsPath', () => {
  it('accepts absolute path', () => {
    const isWin = process.platform === 'win32';
    const p = isWin ? 'C:\\foo' : '/foo';
    expect(asAbsPath(p)).toBe(p);
  });
  it('rejects relative path', () => {
    expect(() => asAbsPath('relative/path')).toThrow(NotAbsoluteError);
  });
  it('rejects null byte', () => {
    const p = process.platform === 'win32' ? 'C:\\f\0oo' : '/f\0oo';
    expect(() => asAbsPath(p)).toThrow();
  });
});

describe('isInside', () => {
  it('returns true for child of parent', () => {
    expect(isInside('/a/b', '/a/b/c')).toBe(true);
  });
  it('returns false for sibling', () => {
    expect(isInside('/a/b', '/a/c')).toBe(false);
  });
  it('returns false for parent itself', () => {
    expect(isInside('/a/b', '/a/b')).toBe(false);
  });
});

describe('computeWorktreePath', () => {
  it('puts worktree in parent dir', () => {
    const p = process.platform === 'win32' ? 'D:\\demos\\my-saas' : '/demos/my-saas';
    const wt = computeWorktreePath(p, 'auth-signup');
    expect(wt).toContain('.d2p-worktrees');
    expect(wt).toContain('my-saas-fix-auth-signup');
  });
});
