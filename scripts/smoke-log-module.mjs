#!/usr/bin/env node
/**
 * Phase 2 §2.2 acceptance: smoke-test the log module end-to-end.
 *
 * Run via:
 *   npx tsx scripts/smoke-log-module.mjs
 * (tsx handles the .ts source import; no build step required.)
 *
 * The script:
 *   1. Creates a tmpdir as logRoot.
 *   2. Constructs a logger (track='smoke').
 *   3. Logs 3 events: smoke.start (root), smoke.work-step (child scope='work'),
 *      smoke.end (root).
 *   4. Flushes (fsync).
 *   5. Reads back the JSONL file; asserts 3 entries with expected events,
 *      shared trace, scope on the child entry.
 *   6. On success: prints `ALL_BEHAVIORS_VERIFIED` to stdout, exit 0.
 *   7. On any failure: prints failure detail to stderr, exit 1.
 *
 * CRITICAL (DUCKPLAN smoke hard constraint): uses `os.tmpdir()` + `path.join`;
 * NEVER hardcodes `/tmp/` (Windows git-bash incident, Phase 1.5).
 */

import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createTrackLogger } from '../daemon/src/log/track-logger.ts';

function fail(msg) {
  console.error('SMOKE-FAIL:', msg);
  process.exit(1);
}

async function main() {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'zerou-smoke-'));
  const logger = createTrackLogger('smoke', { logRoot: tmp });
  logger.log('info', 'smoke.start', { phase: 'phase-2' });
  const child = logger.child('work');
  child.log('info', 'smoke.work-step', { step: 1 });
  logger.log('info', 'smoke.end', { exit: 0 });
  await logger.flush();

  const dateDirs = await readdir(path.join(tmp, 'smoke'));
  if (dateDirs.length !== 1) fail(`expected 1 date dir, got ${dateDirs.length}`);
  const files = await readdir(path.join(tmp, 'smoke', dateDirs[0]));
  if (files.length !== 1) fail(`expected 1 file, got ${files.length}`);
  const file = path.join(tmp, 'smoke', dateDirs[0], files[0]);
  const content = await readFile(file, 'utf8');
  const lines = content.trim().split('\n');
  if (lines.length !== 3) fail(`expected 3 entries, got ${lines.length}`);

  const entries = lines.map((l) => JSON.parse(l));
  const events = entries.map((e) => e.event);
  if (JSON.stringify(events) !== JSON.stringify(['smoke.start', 'smoke.work-step', 'smoke.end'])) {
    fail(`unexpected event order: ${JSON.stringify(events)}`);
  }
  const traces = new Set(entries.map((e) => e.trace));
  if (traces.size !== 1) fail(`expected single trace, got ${traces.size}`);
  if (entries[1].scope !== 'work') fail(`expected scope='work' on entry 1, got ${entries[1].scope}`);
  if ('scope' in entries[0] || 'scope' in entries[2]) fail('root entries must NOT carry scope');
  if (entries[0].phase !== 'phase-2') fail('payload phase preserved');
  if (entries[1].step !== 1) fail('payload step preserved');
  if (entries[2].exit !== 0) fail('payload exit preserved');

  console.log(`smoke OK: ${file} (3 entries, trace=${entries[0].trace})`);
  console.log('ALL_BEHAVIORS_VERIFIED');
}

main().catch((err) => fail(err.stack ?? String(err)));
