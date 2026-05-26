#!/usr/bin/env node
/**
 * Track P1 traceability dogfood (per phase-3-dispatch.md #13).
 *
 * Runs reviewBatch with a deterministic mock critic, writes real jsonl to a
 * temp logRoot, then verifies via jq-able output that the canonical Q3
 * question is answerable from the disk-resident log:
 *
 *   Q3 — Which engine handled which finding?
 *        (critic.review.start carries findingId + crossFamily;
 *         critic.review.success carries findingId + criticFamily)
 *
 * Run:
 *   node scripts/smoke-p1-reviewer-traceability.mjs
 *
 * On success: prints `P1_TRACEABILITY_VERIFIED` + jq-style outputs, exits 0.
 * On failure: prints SMOKE-FAIL + reason, exits 1.
 *
 * IMPORTANT: uses os.tmpdir() (per dispatch-notes #7 — never hardcode /tmp/).
 */

import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { reviewBatch } from '../daemon/src/protocol/cross-engine-reviewer/review.ts';
import { pickCriticEngine } from '../daemon/src/protocol/cross-engine-reviewer/router.ts';

function fail(msg) {
  console.error('SMOKE-FAIL:', msg);
  process.exit(1);
}

class TraceMockEngine {
  constructor() {
    this.calls = 0;
  }
  async call(_prompt) {
    this.calls += 1;
    return JSON.stringify({ verdict: 'confirmed', reasoning: `mock ${this.calls}` });
  }
  lastCallCostUsd() {
    return 0;
  }
  getMeta() {
    return { kind: 'codex-cli', modelId: 'gpt-5-mini', releaseDate: '2025-08-15' };
  }
}

function mockFinding(i) {
  return {
    id: `secrets-leak.${String(i).padStart(8, '0')}`,
    presetId: 'secrets-leak',
    ruleId: 'hardcoded-stripe-key',
    severity: 'P1',
    file: 'src/billing.ts',
    line: 10 + i,
    evidence: `const KEY_${i} = "sk_live_FAKE"`,
    matched_content_normalized: `constkey_${i}="sk_live_fake"`,
    message: 'Hardcoded stripe live secret detected.',
    remediationHint: 'Move to env var.',
    fixAvailable: 'llm-only',
    version: '1.0',
  };
}

async function main() {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'zerou-p1-trace-'));
  // Force logger writes into our tmp dir by chdir'ing — the log module's
  // default logRoot is `${cwd}/.zerou/logs`.
  process.chdir(tmp);

  // Cross-family policy (claude-cli worker, codex-cli critic).
  const worker = { kind: 'claude-cli' };
  const pool = [{ kind: 'codex-cli' }];
  const policy = pickCriticEngine(worker, pool);
  // Patch criticEngine to our mock.
  policy.criticEngine = new TraceMockEngine();

  const findings = [mockFinding(1), mockFinding(2), mockFinding(3)];
  const results = await reviewBatch(findings, { cwd: tmp, repoSha: null }, policy);

  if (results.length !== 3) fail(`expected 3 results, got ${results.length}`);

  // Wait a beat to allow async write to flush. Then read back the jsonl file.
  await new Promise((r) => setTimeout(r, 200));

  const logsRoot = path.join(tmp, '.zerou', 'logs', 'critic');
  let dateDirs;
  try {
    dateDirs = await readdir(logsRoot);
  } catch (err) {
    fail(`cannot read ${logsRoot}: ${err.message}`);
  }
  if (dateDirs.length === 0) fail(`no date subdirs under ${logsRoot}`);
  const dateDir = path.join(logsRoot, dateDirs[0]);
  const files = await readdir(dateDir);
  if (files.length === 0) fail(`no jsonl files in ${dateDir}`);

  // Collate every entry from every file.
  const allEntries = [];
  for (const f of files) {
    const text = await readFile(path.join(dateDir, f), 'utf8');
    for (const line of text.trim().split('\n')) {
      if (!line) continue;
      allEntries.push(JSON.parse(line));
    }
  }

  // Q3: which engine handled which finding?
  // Filter to critic.review.start entries.
  const reviewStarts = allEntries.filter((e) => e.event === 'critic.review.start');
  const reviewSuccesses = allEntries.filter((e) => e.event === 'critic.review.success');

  console.log('=== Q3: Which engine handled which finding? ===');
  console.log('jq command: jq -c \'select(.event=="critic.review.start") | {findingId, crossFamily}\'');
  for (const e of reviewStarts) {
    console.log(JSON.stringify({ findingId: e.findingId, crossFamily: e.crossFamily }));
  }
  console.log();
  console.log('jq command: jq -c \'select(.event=="critic.review.success") | {findingId, criticFamily, verdict}\'');
  for (const e of reviewSuccesses) {
    console.log(
      JSON.stringify({
        findingId: e.findingId,
        criticFamily: e.criticFamily,
        verdict: e.verdict,
      }),
    );
  }

  // Sanity check: each finding has a start entry with crossFamily:true.
  if (reviewStarts.length !== 3) fail(`expected 3 review.start, got ${reviewStarts.length}`);
  if (!reviewStarts.every((e) => e.crossFamily === true))
    fail('not all review.start entries have crossFamily:true');
  if (reviewSuccesses.length !== 3)
    fail(`expected 3 review.success, got ${reviewSuccesses.length}`);
  if (!reviewSuccesses.every((e) => e.criticFamily === 'openai'))
    fail('not all review.success entries report criticFamily=openai');

  // Trace shared across entries
  const traces = new Set(allEntries.map((e) => e.trace));
  if (traces.size !== 1) fail(`expected 1 trace id, got ${traces.size}`);

  console.log();
  console.log('=== Trace shared across all critic.* entries ===');
  console.log(`trace: ${[...traces][0]}`);
  console.log();
  console.log('P1_TRACEABILITY_VERIFIED');
}

main().catch((err) => fail(err.stack ?? err.message ?? String(err)));
