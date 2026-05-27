/**
 * Phase 10.6 — multi-arg console rewrite policy.
 *
 * Background: pino's logger uses the OPPOSITE argument order from `console`.
 *   - console:  msg first, then objects     `console.error("msg", err)`
 *   - pino:     object first, then msg      `logger.error({ err }, "msg")`
 *
 * Therefore a 1:1 substitution of `console.X(arg1, arg2, ...)` into
 * `logger.X(arg1, arg2, ...)` produces type errors (pino treats arg1 as the
 * binding object) and silently loses data.
 *
 * Conservative policy (this file pins it down):
 *
 *   - 0 args                                      → rewrite
 *   - 1 arg of ANY kind (string / number / bool / → rewrite
 *     template / object / array / call expr)
 *   - 2+ args                                     → SKIP (untouched +
 *                                                   decision logged)
 *
 * This regressed in real dogfood on agent-game-platform (LoginForm.tsx:102,
 * src/cli.ts and several sites). The pseudo-test at the bottom of the file
 * pins down the LoginForm site verbatim.
 */
import { describe, it, expect } from 'vitest';

import { __internal } from './log-executor.js';

const { transformConsoleCalls } = __internal;

function run(src: string) {
  // The transform expects a masked view of the source. We use the real
  // masker so tests exercise the same code path as production.
  const mask = __internal.maskNonCodeRegions(src);
  expect(mask.uncertain).toBe(false);
  return transformConsoleCalls(src, 'logger', mask.masked);
}

describe('transformConsoleCalls / Phase 10.6 multi-arg policy', () => {
  // ── 0 args ────────────────────────────────────────────────────────────────

  it('1. rewrites console.log() (0 args) → logger.info()', () => {
    const r = run('console.log()');
    expect(r.content).toBe('logger.info()');
    expect(r.count).toBe(1);
    expect(r.multiArgSkipCount).toBe(0);
  });

  // ── 1 arg, primitives ─────────────────────────────────────────────────────

  it('2. rewrites console.log("hello") (1 string arg)', () => {
    const r = run('console.log("hello")');
    expect(r.content).toBe('logger.info("hello")');
    expect(r.count).toBe(1);
    expect(r.multiArgSkipCount).toBe(0);
  });

  it('3. rewrites console.log(42) (1 number arg)', () => {
    const r = run('console.log(42)');
    expect(r.content).toBe('logger.info(42)');
    expect(r.count).toBe(1);
    expect(r.multiArgSkipCount).toBe(0);
  });

  it('3b. rewrites console.log(true) (1 boolean arg)', () => {
    const r = run('console.log(true)');
    expect(r.content).toBe('logger.info(true)');
    expect(r.count).toBe(1);
    expect(r.multiArgSkipCount).toBe(0);
  });

  // ── 1 arg, object/array ───────────────────────────────────────────────────

  it('4. rewrites console.log({ user: "x" }) (1 object arg)', () => {
    const r = run('console.log({ user: "x" })');
    expect(r.content).toBe('logger.info({ user: "x" })');
    expect(r.count).toBe(1);
    expect(r.multiArgSkipCount).toBe(0);
  });

  it('4b. rewrites console.log([1, 2, 3]) (1 array arg with commas inside)', () => {
    const r = run('console.log([1, 2, 3])');
    expect(r.content).toBe('logger.info([1, 2, 3])');
    expect(r.count).toBe(1);
    expect(r.multiArgSkipCount).toBe(0);
  });

  // ── 1 arg, template literal ───────────────────────────────────────────────

  it('5. rewrites console.log(`hello ${name}`) (1 template arg)', () => {
    const src = 'console.log(`hello ${name}`)';
    const r = run(src);
    expect(r.content).toBe('logger.info(`hello ${name}`)');
    expect(r.count).toBe(1);
    expect(r.multiArgSkipCount).toBe(0);
  });

  // ── 2+ args, must be SKIPPED ──────────────────────────────────────────────

  it('6. LEAVES console.error("update failed:", error) untouched (2 args)', () => {
    const src = 'console.error("update failed:", error)';
    const r = run(src);
    expect(r.content).toBe(src);
    expect(r.count).toBe(0);
    expect(r.multiArgSkipCount).toBe(1);
  });

  it('7. LEAVES console.warn("retrying", attempt, err) untouched (3 args)', () => {
    const src = 'console.warn("retrying", attempt, err)';
    const r = run(src);
    expect(r.content).toBe(src);
    expect(r.count).toBe(0);
    expect(r.multiArgSkipCount).toBe(1);
  });

  // ── Nested call: 1 outer arg, regardless of inner commas ──────────────────

  it('8. rewrites console.log(makeMsg(a, b)) — outer call is 1 arg', () => {
    const src = 'console.log(makeMsg(a, b))';
    const r = run(src);
    expect(r.content).toBe('logger.info(makeMsg(a, b))');
    expect(r.count).toBe(1);
    expect(r.multiArgSkipCount).toBe(0);
  });

  // ── Object literal with commas inside: 1 outer arg ────────────────────────

  it('9. rewrites console.log({ a: 1, b: 2 }) — object literal is 1 arg', () => {
    const src = 'console.log({ a: 1, b: 2 })';
    const r = run(src);
    expect(r.content).toBe('logger.info({ a: 1, b: 2 })');
    expect(r.count).toBe(1);
    expect(r.multiArgSkipCount).toBe(0);
  });

  // ── Multiple calls in one source, judged independently ────────────────────

  it('10. judges each call independently in mixed file', () => {
    const src = [
      'console.log("a");',
      'console.error("b:", err);',
      'console.warn();',
      'console.debug(x, y, z);',
      'console.info({ k: 1, v: 2 });',
    ].join('\n');
    const r = run(src);
    const expected = [
      'logger.info("a");',
      'console.error("b:", err);', // skipped (2 args)
      'logger.warn();',
      'console.debug(x, y, z);', // skipped (3 args)
      'logger.info({ k: 1, v: 2 });',
    ].join('\n');
    expect(r.content).toBe(expected);
    expect(r.count).toBe(3);
    expect(r.multiArgSkipCount).toBe(2);
  });

  // ── String literal arg whose contents contain commas ──────────────────────

  it('11. rewrites console.log("a, b, c") — commas inside string do not count', () => {
    const src = 'console.log("a, b, c")';
    const r = run(src);
    expect(r.content).toBe('logger.info("a, b, c")');
    expect(r.count).toBe(1);
    expect(r.multiArgSkipCount).toBe(0);
  });

  // ── Template with embedded call containing commas ─────────────────────────

  it('12. rewrites console.log(`x: ${fn(a, b)}`) — interpolation commas do not count', () => {
    const src = 'console.log(`x: ${fn(a, b)}`)';
    const r = run(src);
    expect(r.content).toBe('logger.info(`x: ${fn(a, b)}`)');
    expect(r.count).toBe(1);
    expect(r.multiArgSkipCount).toBe(0);
  });

  // ── this.console.X / myConsole.X identifier-boundary protection ───────────

  it('13. leaves this.console.log("hi") alone (identifier boundary)', () => {
    const src = 'this.console.log("hi")';
    const r = run(src);
    expect(r.content).toBe(src);
    expect(r.count).toBe(0);
    expect(r.multiArgSkipCount).toBe(0);
  });

  // ── Realistic LoginForm.tsx site (Phase 10.6 root-cause regression) ───────

  it('14. real-world: LoginForm.tsx site is left untouched', () => {
    const before =
      'if (agentsRes.error) console.error("[page] error:", agentsRes.error);';
    const r = run(before);
    expect(r.content).toBe(before);
    expect(r.count).toBe(0);
    expect(r.multiArgSkipCount).toBe(1);
  });

  // ── Method mapping preserved for the rewritable branches ──────────────────

  it('15. method mapping: log→info, info→info, warn→warn, error→error, debug→debug', () => {
    const src = [
      'console.log("a");',
      'console.info("b");',
      'console.warn("c");',
      'console.error("d");',
      'console.debug("e");',
    ].join('\n');
    const r = run(src);
    expect(r.content).toBe(
      [
        'logger.info("a");',
        'logger.info("b");',
        'logger.warn("c");',
        'logger.error("d");',
        'logger.debug("e");',
      ].join('\n'),
    );
    expect(r.count).toBe(5);
    expect(r.multiArgSkipCount).toBe(0);
  });

  // ── Empty parens with whitespace ──────────────────────────────────────────

  it('16. console.log(   ) (0 args with whitespace) → logger.info(   )', () => {
    const r = run('console.log(   )');
    expect(r.content).toBe('logger.info(   )');
    expect(r.count).toBe(1);
    expect(r.multiArgSkipCount).toBe(0);
  });

  // ── Trailing comma is 2-arg shape, skip ───────────────────────────────────

  it('17. console.log("x",) (trailing comma) is treated as 2-arg shape, SKIP', () => {
    // Conservative: a top-level comma means we cannot guarantee the rewrite
    // is safe, so we skip. This is a deliberate over-conservative choice.
    const src = 'console.log("x",)';
    const r = run(src);
    expect(r.content).toBe(src);
    expect(r.count).toBe(0);
    expect(r.multiArgSkipCount).toBe(1);
  });

  // ── Multiline 2-arg call: still skipped ───────────────────────────────────

  it('18. multiline console.error("msg",\\n  err) (2 args across lines) is SKIPPED', () => {
    const src = 'console.error("msg",\n  err)';
    const r = run(src);
    expect(r.content).toBe(src);
    expect(r.count).toBe(0);
    expect(r.multiArgSkipCount).toBe(1);
  });

  // ── Multiline 1-arg call (object literal split across lines): rewritten ──

  it('19. multiline console.log({\\n  a: 1,\\n  b: 2\\n}) — 1 outer arg, REWRITE', () => {
    const src = 'console.log({\n  a: 1,\n  b: 2\n})';
    const r = run(src);
    expect(r.content).toBe('logger.info({\n  a: 1,\n  b: 2\n})');
    expect(r.count).toBe(1);
    expect(r.multiArgSkipCount).toBe(0);
  });
});
