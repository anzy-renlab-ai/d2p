#!/usr/bin/env tsx
/**
 * FEATURE-VALIDATION Gate 3 (real run) — DUCKPLAN §Probes.
 *
 * Probe 1: canonical JSONL line shape
 * Probe 2: parentTrace cross-module inheritance
 *
 * Run via: npx tsx scripts/probe-real-gate3.mjs
 * Output: JSON to stdout for byte-comparison against Gate 1 (haiku) and Gate 2 (subagent).
 */

import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createTrackLogger } from '../daemon/src/log/track-logger.ts';

async function probe1() {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'zerou-probe1-'));
  const trace = '01HAAAAAAAAAAAAAAAAAAAAAAA';
  const logger = createTrackLogger('foo', { logRoot: tmp, trace });
  logger.log('info', 'x.y', { a: 1 });
  await logger.flush();
  const dateDirs = await readdir(path.join(tmp, 'foo'));
  const file = path.join(tmp, 'foo', dateDirs[0], `${trace}.jsonl`);
  const content = await readFile(file, 'utf8');
  const entry = JSON.parse(content.trim());
  // Normalize ts to placeholder for byte-comparison with Gate 1/2 predictions.
  entry.ts = 1748180000000;
  return entry;
}

async function probe2() {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'zerou-probe2-'));
  const cli = createTrackLogger('cli', { logRoot: tmp });
  const critic = createTrackLogger('critic', { logRoot: tmp, parentTrace: cli.trace });
  cli.log('info', 'audit.start', {});
  critic.log('info', 'review.start', {});
  await cli.flush();
  await critic.flush();
  const cliDateDirs = await readdir(path.join(tmp, 'cli'));
  const criticDateDirs = await readdir(path.join(tmp, 'critic'));
  return {
    cliPath: path.join(tmp, 'cli', cliDateDirs[0], `${cli.trace}.jsonl`),
    criticPath: path.join(tmp, 'critic', criticDateDirs[0], `${critic.trace}.jsonl`),
    cliTrace: cli.trace,
    criticTrace: critic.trace,
    cliTraceEqualsCriticTrace: cli.trace === critic.trace,
  };
}

const probe1Out = await probe1();
const probe2Out = await probe2();
// Output sorted-keys JSON so jq -S byte-comparison works.
function sortedJSON(obj) {
  return JSON.stringify(obj, Object.keys(obj).sort());
}
console.log('PROBE1:', sortedJSON(probe1Out));
console.log('PROBE2:', sortedJSON({
  cliTrace: probe2Out.cliTrace,
  criticTrace: probe2Out.criticTrace,
  cliTraceEqualsCriticTrace: probe2Out.cliTraceEqualsCriticTrace,
}));
