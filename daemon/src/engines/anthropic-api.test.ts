import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { AnthropicApiEngine } from './anthropic-api.js';

interface StubReq {
  method: string;
  path: string;
  bodyJson: unknown;
  headers: http.IncomingHttpHeaders;
}

let server: http.Server | null = null;
let receivedRequests: StubReq[] = [];
let nextResponse: { status: number; body: string } = { status: 200, body: '{}' };

beforeEach(async () => {
  receivedRequests = [];
  await new Promise<void>((resolve) => {
    server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let bodyJson: unknown = null;
        try { bodyJson = JSON.parse(raw); } catch { /* ignore */ }
        receivedRequests.push({
          method: req.method ?? '',
          path: req.url ?? '',
          bodyJson,
          headers: req.headers,
        });
        res.statusCode = nextResponse.status;
        res.setHeader('content-type', 'application/json');
        res.end(nextResponse.body);
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
  const addr = server!.address() as AddressInfo;
  return `http://127.0.0.1:${addr.port}`;
}

function engine() {
  return new AnthropicApiEngine({
    kind: 'anthropic-api',
    baseUrl: baseUrl(),
    apiKey: 'sk-ant-test',
    models: { haiku: 'haiku-m', sonnet: 'sonnet-m', opus: 'opus-m' },
  });
}

describe('AnthropicApiEngine', () => {
  it('POSTs /v1/messages with x-api-key + anthropic-version', async () => {
    nextResponse = {
      status: 200,
      body: JSON.stringify({
        content: [{ type: 'text', text: '{"hello": "world"}' }],
        usage: { input_tokens: 5, output_tokens: 2 },
      }),
    };
    const r = await engine().call({ role: 'behavioral', model: 'sonnet', prompt: 'hi' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.json).toEqual({ hello: 'world' });
      expect(r.usage).toEqual({ inputTokens: 5, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0 });
    }
    expect(receivedRequests).toHaveLength(1);
    const req = receivedRequests[0]!;
    expect(req.path).toBe('/v1/messages');
    expect(req.headers['x-api-key']).toBe('sk-ant-test');
    expect(req.headers['anthropic-version']).toBe('2023-06-01');
    const body = req.bodyJson as { model: string; system: string; messages: unknown[] };
    expect(body.model).toBe('sonnet-m');
    expect(body.system).toBeTypeOf('string');
  });

  it('concatenates multiple text blocks', async () => {
    nextResponse = {
      status: 200,
      body: JSON.stringify({
        content: [
          { type: 'text', text: '{"a":' },
          { type: 'text', text: '1}' },
        ],
        usage: { input_tokens: 0, output_tokens: 0 },
      }),
    };
    const r = await engine().call({ role: 'differ', model: 'sonnet', prompt: 'x' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.json).toEqual({ a: 1 });
  });

  it('handles HTTP 5xx as NON_ZERO_EXIT', async () => {
    nextResponse = { status: 502, body: 'bad gateway' };
    const r = await engine().call({ role: 'differ', model: 'sonnet', prompt: 'x' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('NON_ZERO_EXIT');
  });

  it('authStyle "bearer" sends Authorization header (no x-api-key)', async () => {
    nextResponse = {
      status: 200,
      body: JSON.stringify({
        content: [{ type: 'text', text: '{"ok":true}' }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    };
    const eng = new AnthropicApiEngine({
      kind: 'anthropic-api',
      baseUrl: baseUrl(),
      apiKey: 'bearer-key',
      authStyle: 'bearer',
      models: { haiku: 'h', sonnet: 's', opus: 'o' },
    });
    const r = await eng.call({ role: 'behavioral', model: 'sonnet', prompt: 'x' });
    expect(r.ok).toBe(true);
    const req = receivedRequests[0]!;
    expect(req.headers['authorization']).toBe('Bearer bearer-key');
    expect(req.headers['x-api-key']).toBeUndefined();
    expect(req.headers['anthropic-version']).toBe('2023-06-01');
  });

  it('skipAnthropicVersion: true omits anthropic-version header', async () => {
    nextResponse = {
      status: 200,
      body: JSON.stringify({
        content: [{ type: 'text', text: '{"ok":true}' }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    };
    const eng = new AnthropicApiEngine({
      kind: 'anthropic-api',
      baseUrl: baseUrl(),
      apiKey: 'sk-ant-test',
      skipAnthropicVersion: true,
      models: { haiku: 'h', sonnet: 's', opus: 'o' },
    });
    const r = await eng.call({ role: 'behavioral', model: 'sonnet', prompt: 'x' });
    expect(r.ok).toBe(true);
    const req = receivedRequests[0]!;
    expect(req.headers['anthropic-version']).toBeUndefined();
    expect(req.headers['x-api-key']).toBe('sk-ant-test');
  });

  it('MiniMax recipe: bearer + skipAnthropicVersion + MiniMax model id works', async () => {
    nextResponse = {
      status: 200,
      body: JSON.stringify({
        content: [{ type: 'text', text: '{"greeting":"hi"}' }],
        usage: { input_tokens: 3, output_tokens: 1 },
      }),
    };
    const eng = new AnthropicApiEngine({
      kind: 'anthropic-api',
      baseUrl: baseUrl(), // pretend this is https://api.minimaxi.com/anthropic
      apiKey: 'minimax-key',
      authStyle: 'bearer',
      skipAnthropicVersion: true,
      family: 'minimax',
      models: {
        haiku: 'MiniMax-M2.7-highspeed',
        sonnet: 'MiniMax-M2.7',
        opus: 'MiniMax-M2.7',
      },
    });
    const r = await eng.call({ role: 'behavioral', model: 'sonnet', prompt: 'Hi' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.json).toEqual({ greeting: 'hi' });
    const req = receivedRequests[0]!;
    expect(req.path).toBe('/v1/messages');
    expect(req.headers['authorization']).toBe('Bearer minimax-key');
    expect(req.headers['x-api-key']).toBeUndefined();
    expect(req.headers['anthropic-version']).toBeUndefined();
    const body = req.bodyJson as { model: string };
    expect(body.model).toBe('MiniMax-M2.7');
  });
});
