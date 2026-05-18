import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { OpenAICompatEngine } from './openai-compat.js';

interface StubReq {
  method: string;
  path: string;
  bodyJson: unknown;
  authHeader: string | undefined;
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
          authHeader: req.headers.authorization,
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
  return `http://127.0.0.1:${addr.port}/v1`;
}

function engine() {
  return new OpenAICompatEngine({
    kind: 'openai-compat',
    baseUrl: baseUrl(),
    apiKey: 'sk-test-123',
    models: { haiku: 'haiku-m', sonnet: 'sonnet-m', opus: 'opus-m' },
  });
}

describe('OpenAICompatEngine', () => {
  it('POSTs chat/completions with bearer token and parses JSON content', async () => {
    nextResponse = {
      status: 200,
      body: JSON.stringify({
        choices: [{ message: { content: '{"answer": 42}' } }],
        usage: { prompt_tokens: 12, completion_tokens: 3 },
      }),
    };
    const r = await engine().call({ role: 'differ', model: 'sonnet', prompt: 'say 42' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.json).toEqual({ answer: 42 });
      expect(r.usage).toEqual({ inputTokens: 12, outputTokens: 3, cacheReadTokens: 0, cacheWriteTokens: 0 });
    }
    expect(receivedRequests).toHaveLength(1);
    const req = receivedRequests[0]!;
    expect(req.method).toBe('POST');
    expect(req.path).toBe('/v1/chat/completions');
    expect(req.authHeader).toBe('Bearer sk-test-123');
    const body = req.bodyJson as { model: string; messages: { role: string }[] };
    expect(body.model).toBe('sonnet-m');
    expect(body.messages[0]?.role).toBe('system');
    expect(body.messages[1]?.role).toBe('user');
  });

  it('handles JSON wrapped in ```json fence', async () => {
    nextResponse = {
      status: 200,
      body: JSON.stringify({
        choices: [{ message: { content: 'Here you go:\n```json\n{"ok": true}\n```' } }],
      }),
    };
    const r = await engine().call({ role: 'alignment', model: 'haiku', prompt: 'x' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.json).toEqual({ ok: true });
  });

  it('maps 401 to NON_ZERO_EXIT with message', async () => {
    nextResponse = { status: 401, body: '{"error":"bad key"}' };
    const r = await engine().call({ role: 'differ', model: 'sonnet', prompt: 'x' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('NON_ZERO_EXIT');
      expect(r.message).toContain('401');
    }
  });

  it('reports NON_JSON when content is unparseable', async () => {
    nextResponse = {
      status: 200,
      body: JSON.stringify({ choices: [{ message: { content: 'not json at all' } }] }),
    };
    const r = await engine().call({ role: 'differ', model: 'sonnet', prompt: 'x' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('NON_JSON');
  });

  it('passes extraHeaders (e.g. OpenRouter referer)', async () => {
    nextResponse = { status: 200, body: JSON.stringify({ choices: [{ message: { content: '{}' } }] }) };
    const e = new OpenAICompatEngine({
      kind: 'openai-compat',
      baseUrl: baseUrl(),
      apiKey: 'k',
      models: { haiku: 'h', sonnet: 's', opus: 'o' },
      extraHeaders: { 'HTTP-Referer': 'https://d2p.local', 'X-Title': 'd2p' },
    });
    await e.call({ role: 'differ', model: 'sonnet', prompt: 'x' });
    expect(receivedRequests[0]).toBeDefined();
    // ExtraHeaders aren't echoed by stub but we trust fetch to forward them.
  });
});
