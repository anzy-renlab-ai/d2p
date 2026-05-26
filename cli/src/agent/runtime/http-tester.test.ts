/**
 * Tests for http-tester.
 *
 * Uses an in-process Node http server (no child spawn) — pure fetch round-trip.
 */
import * as http from 'node:http';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { runHttpTest, matchShape } from './http-tester.js';
import type { HttpTestSpec, RuntimeProcess } from './types.js';
import { getFreePort } from './__fixtures__/get-port.js';
import {
  __resetMetaLoggersForTests,
  __resetLiveLoggersForTests,
  __resetRotationGateForTests,
} from '../../log-types.js';

let server: http.Server;
let port: number;
let baseUrl: string;

beforeAll(async () => {
  port = await getFreePort();
  baseUrl = `http://localhost:${port}`;
  server = http.createServer((req, res) => {
    if (req.url === '/api/login' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        let parsed: any = {};
        try {
          parsed = JSON.parse(body || '{}');
        } catch {
          res.statusCode = 400;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ error: 'bad json' }));
          return;
        }
        if (!parsed.email) {
          res.statusCode = 400;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ error: 'email required' }));
          return;
        }
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ token: 'fake', email: parsed.email }));
      });
      return;
    }
    if (req.url === '/echo-text') {
      res.statusCode = 200;
      res.setHeader('content-type', 'text/plain');
      res.end('hi');
      return;
    }
    if (req.url === '/slow') {
      setTimeout(() => {
        res.statusCode = 200;
        res.end('late');
      }, 3000);
      return;
    }
    res.statusCode = 404;
    res.end('nope');
  });
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

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

function fakeRuntime(): RuntimeProcess {
  return {
    pid: 0,
    port,
    baseUrl,
    startTime: Date.now(),
    kill: async () => {},
  };
}

describe('runHttpTest', () => {
  it('passes when status matches expected (200)', async () => {
    const spec: HttpTestSpec = {
      method: 'POST',
      path: '/api/login',
      body: { email: 'a@b.com' },
      expectedStatus: 200,
    };
    const r = await runHttpTest(spec, fakeRuntime());
    expect(r.status).toBe('pass');
    expect(r.actualStatus).toBe(200);
  });

  it('passes when expectedStatus 400 and server returns 400', async () => {
    const spec: HttpTestSpec = {
      method: 'POST',
      path: '/api/login',
      body: {},
      expectedStatus: 400,
    };
    const r = await runHttpTest(spec, fakeRuntime());
    expect(r.status).toBe('pass');
    expect(r.actualStatus).toBe(400);
  });

  it('fails when expectedStatus mismatches actual', async () => {
    const spec: HttpTestSpec = {
      method: 'POST',
      path: '/api/login',
      body: { email: 'x@y.z' },
      expectedStatus: 401,
    };
    const r = await runHttpTest(spec, fakeRuntime());
    expect(r.status).toBe('fail');
    expect(r.verdictReason).toMatch(/200/);
  });

  it('passes body-shape assertion (contains semantics)', async () => {
    const spec: HttpTestSpec = {
      method: 'POST',
      path: '/api/login',
      body: { email: 'x@y.z' },
      expectedStatus: 200,
      expectedBodyShape: { token: 'fake' },
    };
    const r = await runHttpTest(spec, fakeRuntime());
    expect(r.status).toBe('pass');
  });

  it('fails body-shape when value mismatches', async () => {
    const spec: HttpTestSpec = {
      method: 'POST',
      path: '/api/login',
      body: { email: 'x@y.z' },
      expectedStatus: 200,
      expectedBodyShape: { token: 'WRONG' },
    };
    const r = await runHttpTest(spec, fakeRuntime());
    expect(r.status).toBe('fail');
    expect(r.verdictReason).toMatch(/body/);
  });

  it('returns inconclusive when request times out', async () => {
    const spec: HttpTestSpec = {
      method: 'GET',
      path: '/slow',
      expectedStatus: 200,
    };
    const r = await runHttpTest(spec, fakeRuntime(), undefined, { timeoutMs: 200 });
    expect(r.status).toBe('inconclusive');
    expect(r.verdictReason).toMatch(/http request failed/);
  });

  it('returns inconclusive when host unreachable', async () => {
    const spec: HttpTestSpec = {
      method: 'GET',
      path: '/whatever',
    };
    const unreachable: RuntimeProcess = {
      pid: 0,
      port: 1,
      baseUrl: 'http://127.0.0.1:1',
      startTime: Date.now(),
      kill: async () => {},
    };
    const r = await runHttpTest(spec, unreachable, undefined, { timeoutMs: 1000 });
    expect(r.status).toBe('inconclusive');
  });

  it('treats no assertions as pass', async () => {
    const spec: HttpTestSpec = {
      method: 'GET',
      path: '/echo-text',
    };
    const r = await runHttpTest(spec, fakeRuntime());
    expect(r.status).toBe('pass');
    expect(r.actualBody).toBe('hi');
  });
});

describe('matchShape', () => {
  it('exact primitive match', () => {
    expect(matchShape(5, 5, '$').ok).toBe(true);
    expect(matchShape('a', 'a', '$').ok).toBe(true);
    expect(matchShape(true, true, '$').ok).toBe(true);
  });

  it('mismatched primitive', () => {
    expect(matchShape(5, 6, '$').ok).toBe(false);
  });

  it('object contains (extra keys in actual ok)', () => {
    const r = matchShape({ a: 1, b: 2, c: 3 }, { a: 1, c: 3 }, '$');
    expect(r.ok).toBe(true);
  });

  it('missing key in actual', () => {
    const r = matchShape({ a: 1 }, { a: 1, b: 2 }, '$');
    expect(r.ok).toBe(false);
    expect(r.path).toBe('$.b');
  });

  it('nested object match', () => {
    const r = matchShape({ user: { id: 1, name: 'x' } }, { user: { id: 1 } }, '$');
    expect(r.ok).toBe(true);
  });

  it('array length check', () => {
    expect(matchShape([1, 2, 3], [1, 2], '$').ok).toBe(true);
    expect(matchShape([1], [1, 2], '$').ok).toBe(false);
  });
});
