/**
 * Tests for Phase 10.5 — production-grade bootstrap/middleware templates.
 *
 * The templates are *string* exports — user-facing code that the executor
 * writes to the user's project. These tests assert structural correctness
 * (parses, exports the expected surface, contains required best-practice
 * features) without actually executing the emitted user code.
 *
 * Coverage:
 *   1. BOOTSTRAP_TEMPLATE imports pino
 *   2. BOOTSTRAP_TEMPLATE exports logger / getLogger / childLogger / correlationStore
 *   3. BOOTSTRAP_TEMPLATE has ≥3 redact paths and uses pino.stdSerializers
 *   4. BOOTSTRAP_TEMPLATE uses AsyncLocalStorage
 *   5. MIDDLEWARE_TEMPLATE_NEXT wraps handler in correlationStore.run
 *   6. MIDDLEWARE_TEMPLATE_NEXT generates correlation ID + echoes header
 *   7. MIDDLEWARE_TEMPLATE_EXPRESS exports loggingMiddleware with res.on('finish')
 *   8. EDGE_BOOTSTRAP_TEMPLATE does NOT import pino but has same public surface
 *   9. Meta: every template parses as valid TypeScript via ts.createSourceFile
 *  10. All templates expose the same public symbols (logger, getLogger,
 *      childLogger, correlationStore) — portability check
 */
import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import {
  BOOTSTRAP_TEMPLATE,
  MIDDLEWARE_TEMPLATE_NEXT,
  MIDDLEWARE_TEMPLATE_EXPRESS,
  EDGE_BOOTSTRAP_TEMPLATE,
} from './bootstrap-templates.js';

function parseTs(source: string, filename: string): ts.SourceFile {
  return ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.ES2022,
    /* setParentNodes */ true,
    ts.ScriptKind.TS,
  );
}

/**
 * Walk the source file and report any diagnostic-bearing nodes the parser
 * flagged. `parseDiagnostics` is the canonical list for syntactic errors.
 */
function syntaxErrors(sf: ts.SourceFile): readonly ts.DiagnosticWithLocation[] {
  // `parseDiagnostics` is internal-ish but stable across TS 5.x and is the
  // only way to read syntax-only diagnostics without a full Program.
  return (sf as unknown as { parseDiagnostics: readonly ts.DiagnosticWithLocation[] })
    .parseDiagnostics;
}

describe('BOOTSTRAP_TEMPLATE (Node)', () => {
  it('imports pino', () => {
    expect(BOOTSTRAP_TEMPLATE).toMatch(/import pino from 'pino'/);
  });

  it('exports logger, getLogger, childLogger, correlationStore', () => {
    expect(BOOTSTRAP_TEMPLATE).toMatch(/export const logger\b/);
    expect(BOOTSTRAP_TEMPLATE).toMatch(/export function getLogger\b/);
    expect(BOOTSTRAP_TEMPLATE).toMatch(/export function childLogger\b/);
    expect(BOOTSTRAP_TEMPLATE).toMatch(/export const correlationStore\b/);
  });

  it('uses AsyncLocalStorage from node:async_hooks', () => {
    expect(BOOTSTRAP_TEMPLATE).toMatch(
      /import\s*\{\s*AsyncLocalStorage\s*\}\s*from\s*'node:async_hooks'/,
    );
    expect(BOOTSTRAP_TEMPLATE).toMatch(/new AsyncLocalStorage</);
  });

  it('contains ≥3 redact paths covering common secret shapes', () => {
    const required = ['password', 'token', 'authorization', 'apiKey', 'secret', 'cookie'];
    const present = required.filter((p) => BOOTSTRAP_TEMPLATE.includes(p));
    expect(present.length).toBeGreaterThanOrEqual(3);
    expect(BOOTSTRAP_TEMPLATE).toMatch(/redact:\s*\{/);
    expect(BOOTSTRAP_TEMPLATE).toMatch(/censor:\s*'\[REDACTED\]'/);
  });

  it('wires pino.stdSerializers for req/res/err', () => {
    expect(BOOTSTRAP_TEMPLATE).toMatch(/pino\.stdSerializers\.req/);
    expect(BOOTSTRAP_TEMPLATE).toMatch(/pino\.stdSerializers\.res/);
    expect(BOOTSTRAP_TEMPLATE).toMatch(/pino\.stdSerializers\.err/);
  });

  it('reads level from LOG_LEVEL with info fallback', () => {
    expect(BOOTSTRAP_TEMPLATE).toMatch(
      /level:\s*process\.env\.LOG_LEVEL\s*\?\?\s*'info'/,
    );
  });

  it('uses pino-pretty only in non-production', () => {
    expect(BOOTSTRAP_TEMPLATE).toMatch(
      /process\.env\.NODE_ENV\s*!==\s*'production'/,
    );
    expect(BOOTSTRAP_TEMPLATE).toMatch(/'pino-pretty'/);
  });

  it('getLogger merges current correlation context with bindings', () => {
    expect(BOOTSTRAP_TEMPLATE).toMatch(/correlationStore\.getStore\(\)/);
    expect(BOOTSTRAP_TEMPLATE).toMatch(/logger\.child\(/);
  });
});

describe('MIDDLEWARE_TEMPLATE_NEXT', () => {
  it('wraps the request lifecycle in correlationStore.run', () => {
    expect(MIDDLEWARE_TEMPLATE_NEXT).toMatch(/correlationStore\.run\(/);
  });

  it('detects header or generates a correlation id', () => {
    expect(MIDDLEWARE_TEMPLATE_NEXT).toMatch(/x-correlation-id/);
    expect(MIDDLEWARE_TEMPLATE_NEXT).toMatch(/crypto\.randomUUID\(\)/);
  });

  it('echoes the correlation id on the response header', () => {
    expect(MIDDLEWARE_TEMPLATE_NEXT).toMatch(
      /res\.headers\.set\('x-correlation-id'/,
    );
  });

  it('logs request.start and request.end with durationMs', () => {
    expect(MIDDLEWARE_TEMPLATE_NEXT).toMatch(/'request\.start'/);
    expect(MIDDLEWARE_TEMPLATE_NEXT).toMatch(/'request\.end'/);
    expect(MIDDLEWARE_TEMPLATE_NEXT).toMatch(/durationMs/);
  });

  it('imports from the bootstrap module', () => {
    expect(MIDDLEWARE_TEMPLATE_NEXT).toMatch(
      /import\s*\{[^}]*correlationStore[^}]*\}\s*from\s*'\.\/src\/logger'/,
    );
  });
});

describe('MIDDLEWARE_TEMPLATE_EXPRESS', () => {
  it('exports loggingMiddleware with (req, res, next) signature', () => {
    expect(MIDDLEWARE_TEMPLATE_EXPRESS).toMatch(
      /export function loggingMiddleware\(/,
    );
    expect(MIDDLEWARE_TEMPLATE_EXPRESS).toMatch(/NextFunction/);
  });

  it('wraps next() in correlationStore.run', () => {
    expect(MIDDLEWARE_TEMPLATE_EXPRESS).toMatch(/correlationStore\.run\(/);
    expect(MIDDLEWARE_TEMPLATE_EXPRESS).toMatch(/next\(\);?/);
  });

  it('hooks res.on(finish) to log request.end with duration + status', () => {
    expect(MIDDLEWARE_TEMPLATE_EXPRESS).toMatch(/res\.on\('finish'/);
    expect(MIDDLEWARE_TEMPLATE_EXPRESS).toMatch(/durationMs/);
    expect(MIDDLEWARE_TEMPLATE_EXPRESS).toMatch(/statusCode/);
  });

  it('echoes correlation id header on response', () => {
    expect(MIDDLEWARE_TEMPLATE_EXPRESS).toMatch(
      /res\.setHeader\('x-correlation-id'/,
    );
  });
});

describe('EDGE_BOOTSTRAP_TEMPLATE', () => {
  it('does NOT import pino (incompatible with Edge runtime)', () => {
    expect(EDGE_BOOTSTRAP_TEMPLATE).not.toMatch(/from\s*'pino'/);
    expect(EDGE_BOOTSTRAP_TEMPLATE).not.toMatch(/import\s+pino/);
  });

  it('does NOT import node:async_hooks (no worker_threads on Edge)', () => {
    // The comment mentions node:async_hooks as the reason why pino is unusable;
    // what we forbid is an actual import statement targeting it.
    expect(EDGE_BOOTSTRAP_TEMPLATE).not.toMatch(/from\s*'node:async_hooks'/);
    expect(EDGE_BOOTSTRAP_TEMPLATE).not.toMatch(
      /import\s*\{[^}]*AsyncLocalStorage[^}]*\}/,
    );
  });

  it('exports the same public surface as the Node bootstrap', () => {
    expect(EDGE_BOOTSTRAP_TEMPLATE).toMatch(/export const logger\b/);
    expect(EDGE_BOOTSTRAP_TEMPLATE).toMatch(/export function getLogger\b/);
    expect(EDGE_BOOTSTRAP_TEMPLATE).toMatch(/export function childLogger\b/);
    expect(EDGE_BOOTSTRAP_TEMPLATE).toMatch(/export const correlationStore\b/);
  });

  it('emits structured JSON via console', () => {
    expect(EDGE_BOOTSTRAP_TEMPLATE).toMatch(/JSON\.stringify\(/);
    expect(EDGE_BOOTSTRAP_TEMPLATE).toMatch(/console\.log\(/);
  });

  it('provides a noop correlationStore.run that still invokes the callback', () => {
    expect(EDGE_BOOTSTRAP_TEMPLATE).toMatch(/run<T>\(/);
    expect(EDGE_BOOTSTRAP_TEMPLATE).toMatch(/return fn\(\);?/);
  });
});

describe('cross-template portability + parseability', () => {
  const templates = [
    ['BOOTSTRAP_TEMPLATE', BOOTSTRAP_TEMPLATE, 'logger.ts'],
    ['MIDDLEWARE_TEMPLATE_NEXT', MIDDLEWARE_TEMPLATE_NEXT, 'middleware.ts'],
    ['MIDDLEWARE_TEMPLATE_EXPRESS', MIDDLEWARE_TEMPLATE_EXPRESS, 'logging.ts'],
    ['EDGE_BOOTSTRAP_TEMPLATE', EDGE_BOOTSTRAP_TEMPLATE, 'logger.edge.ts'],
  ] as const;

  it.each(templates)('%s parses with zero syntax errors', (_name, source, filename) => {
    const sf = parseTs(source, filename);
    const errs = syntaxErrors(sf);
    if (errs.length > 0) {
      // surface the first diagnostic so a regression is debuggable.
      const first = errs[0]!;
      const msg = ts.flattenDiagnosticMessageText(first.messageText, '\n');
      throw new Error(`${_name} syntax error at pos ${first.start}: ${msg}`);
    }
    expect(errs.length).toBe(0);
  });

  it('both bootstraps expose identical public symbol names', () => {
    const required = ['logger', 'getLogger', 'childLogger', 'correlationStore'];
    for (const sym of required) {
      expect(BOOTSTRAP_TEMPLATE).toContain(sym);
      expect(EDGE_BOOTSTRAP_TEMPLATE).toContain(sym);
    }
  });

  it('both middleware templates reference correlationStore + getLogger from bootstrap', () => {
    for (const mw of [MIDDLEWARE_TEMPLATE_NEXT, MIDDLEWARE_TEMPLATE_EXPRESS]) {
      expect(mw).toMatch(/correlationStore/);
      expect(mw).toMatch(/getLogger/);
    }
  });
});
