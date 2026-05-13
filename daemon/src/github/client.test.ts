import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { GitHubClient, parseGitHubRemote } from './client.js';

interface StubReq {
  method: string;
  path: string;
  bodyJson: unknown;
  authHeader: string | undefined;
}

let server: http.Server | null = null;
let received: StubReq[] = [];
let nextRes: { status: number; body: string } = { status: 200, body: '{}' };

beforeEach(async () => {
  received = [];
  await new Promise<void>((resolve) => {
    server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let bodyJson: unknown = null;
        try { bodyJson = JSON.parse(raw); } catch { /* ignore */ }
        received.push({
          method: req.method ?? '',
          path: req.url ?? '',
          bodyJson,
          authHeader: req.headers.authorization,
        });
        res.statusCode = nextRes.status;
        res.setHeader('content-type', 'application/json');
        res.end(nextRes.body);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve());
  });
});

afterEach(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  server = null;
});

function baseUrl(): string {
  const a = server!.address() as AddressInfo;
  return `http://127.0.0.1:${a.port}`;
}

describe('parseGitHubRemote', () => {
  it('parses https URLs', () => {
    expect(parseGitHubRemote('https://github.com/Upp-Ljl/d2p.git')).toEqual({ owner: 'Upp-Ljl', repo: 'd2p' });
    expect(parseGitHubRemote('https://github.com/Upp-Ljl/d2p')).toEqual({ owner: 'Upp-Ljl', repo: 'd2p' });
  });
  it('parses ssh URLs', () => {
    expect(parseGitHubRemote('git@github.com:Upp-Ljl/d2p.git')).toEqual({ owner: 'Upp-Ljl', repo: 'd2p' });
  });
  it('returns null for non-GitHub urls', () => {
    expect(parseGitHubRemote('https://gitlab.com/foo/bar.git')).toBeNull();
    expect(parseGitHubRemote('garbage')).toBeNull();
  });
});

describe('GitHubClient', () => {
  it('openPR POSTs to /repos/:owner/:repo/pulls with token header', async () => {
    nextRes = {
      status: 201,
      body: JSON.stringify({
        number: 7,
        html_url: 'https://github.com/u/r/pull/7',
        url: 'https://api.github.com/repos/u/r/pulls/7',
        state: 'open',
      }),
    };
    const c = new GitHubClient('ghp_test', baseUrl());
    const r = await c.openPR({
      owner: 'u', repo: 'r', title: 't', body: 'b', head: 'fix/x', base: 'main',
    });
    expect('error' in r).toBe(false);
    if (!('error' in r)) {
      expect(r.number).toBe(7);
      expect(r.htmlUrl).toBe('https://github.com/u/r/pull/7');
    }
    expect(received).toHaveLength(1);
    const req = received[0]!;
    expect(req.method).toBe('POST');
    expect(req.path).toBe('/repos/u/r/pulls');
    expect(req.authHeader).toBe('token ghp_test');
    const body = req.bodyJson as { head: string; base: string };
    expect(body.head).toBe('fix/x');
    expect(body.base).toBe('main');
  });

  it('openPR surfaces error on 422 (validation)', async () => {
    nextRes = { status: 422, body: '{"message":"head branch missing"}' };
    const c = new GitHubClient('t', baseUrl());
    const r = await c.openPR({ owner: 'u', repo: 'r', title: 't', body: 'b', head: 'h', base: 'b' });
    expect('error' in r).toBe(true);
    if ('error' in r) expect(r.error).toContain('422');
  });

  it('verifyToken hits /user', async () => {
    nextRes = { status: 200, body: '{"login":"alice"}' };
    const c = new GitHubClient('t', baseUrl());
    const r = await c.verifyToken();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.login).toBe('alice');
    expect(received[0]?.path).toBe('/user');
  });

  it('getRepo returns default branch', async () => {
    nextRes = { status: 200, body: '{"default_branch":"trunk"}' };
    const c = new GitHubClient('t', baseUrl());
    const r = await c.getRepo('u', 'r');
    expect('error' in r).toBe(false);
    if (!('error' in r)) expect(r.defaultBranch).toBe('trunk');
  });
});
