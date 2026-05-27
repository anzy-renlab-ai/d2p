/**
 * Tests for agent/auth-fixtures (Phase 11.3).
 *
 * Templates are strings: assert they parse as valid TypeScript at a surface
 * level (well-formed brackets, expected exports present, vi.mock calls
 * point at the right specifier).
 */
import { describe, it, expect } from 'vitest';
import {
  SUPABASE_SSR_FIXTURE,
  NEXTAUTH_FIXTURE,
  fixtureFor,
  fixtureRelImport,
  fixtureFileName,
} from './auth-fixtures.js';

describe('SUPABASE_SSR_FIXTURE', () => {
  it('exports mockAuthenticatedUser, mockAnonymous, resetAuth', () => {
    expect(SUPABASE_SSR_FIXTURE).toMatch(/export function mockAuthenticatedUser\b/);
    expect(SUPABASE_SSR_FIXTURE).toMatch(/export function mockAnonymous\b/);
    expect(SUPABASE_SSR_FIXTURE).toMatch(/export function resetAuth\b/);
  });

  it('vi.mock targets @/lib/auth/server with getServerUser export', () => {
    expect(SUPABASE_SSR_FIXTURE).toMatch(/vi\.mock\(['"]@\/lib\/auth\/server['"]/);
    expect(SUPABASE_SSR_FIXTURE).toMatch(/getServerUser:/);
  });

  it('Promise-wrapped user return shape (matches supabase contract)', () => {
    expect(SUPABASE_SSR_FIXTURE).toMatch(/Promise\.resolve\(mockState\.user\)/);
  });

  it('has balanced braces and parens', () => {
    expect(countCh(SUPABASE_SSR_FIXTURE, '{')).toBe(countCh(SUPABASE_SSR_FIXTURE, '}'));
    expect(countCh(SUPABASE_SSR_FIXTURE, '(')).toBe(countCh(SUPABASE_SSR_FIXTURE, ')'));
  });
});

describe('NEXTAUTH_FIXTURE', () => {
  it('exports mockAuthenticatedUser, mockAnonymous, resetAuth', () => {
    expect(NEXTAUTH_FIXTURE).toMatch(/export function mockAuthenticatedUser\b/);
    expect(NEXTAUTH_FIXTURE).toMatch(/export function mockAnonymous\b/);
    expect(NEXTAUTH_FIXTURE).toMatch(/export function resetAuth\b/);
  });

  it('vi.mock targets next-auth with getServerSession', () => {
    expect(NEXTAUTH_FIXTURE).toMatch(/vi\.mock\(['"]next-auth['"]/);
    expect(NEXTAUTH_FIXTURE).toMatch(/getServerSession:/);
  });

  it('mocks the session shape (not bare user)', () => {
    expect(NEXTAUTH_FIXTURE).toMatch(/mockState\.session/);
    expect(NEXTAUTH_FIXTURE).toMatch(/MockSession/);
  });

  it('has balanced braces and parens', () => {
    expect(countCh(NEXTAUTH_FIXTURE, '{')).toBe(countCh(NEXTAUTH_FIXTURE, '}'));
    expect(countCh(NEXTAUTH_FIXTURE, '(')).toBe(countCh(NEXTAUTH_FIXTURE, ')'));
  });
});

describe('fixtureFor', () => {
  it('returns supabase template for supabase-ssr', () => {
    expect(fixtureFor('supabase-ssr')).toBe(SUPABASE_SSR_FIXTURE);
  });
  it('returns nextauth template for nextauth', () => {
    expect(fixtureFor('nextauth')).toBe(NEXTAUTH_FIXTURE);
  });
  it('returns null for none', () => {
    expect(fixtureFor('none')).toBeNull();
  });
});

describe('fixtureRelImport + fixtureFileName', () => {
  it('rel import uses ./fixtures/ prefix and matches kind', () => {
    expect(fixtureRelImport('supabase-ssr')).toBe('./fixtures/auth-supabase-ssr');
    expect(fixtureRelImport('nextauth')).toBe('./fixtures/auth-nextauth');
  });
  it('file name uses auth-<kind>.ts', () => {
    expect(fixtureFileName('supabase-ssr')).toBe('auth-supabase-ssr.ts');
    expect(fixtureFileName('nextauth')).toBe('auth-nextauth.ts');
  });
});

function countCh(s: string, ch: string): number {
  let n = 0;
  for (const c of s) if (c === ch) n++;
  return n;
}
