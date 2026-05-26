// Track P2 traceability acceptance dogfood.
//
// Loads preset, runs against fixture, writes all log events to disk in JSONL
// format. Caller can use `jq` against the log file to answer Q1 / Q3 of the
// dispatch-notes #13 traceability matrix.
//
// Q1: how was a finding discovered? -> preset.run.rule.finding events list
//     findingId + file + line + ruleId. Q3 about engines is Track P1.

import { loadPreset } from '../daemon/src/preset/protocol2/loader.ts';
import { runPreset } from '../daemon/src/preset/protocol2/runner.ts';
import { createTrackLogger } from '../daemon/src/log/track-logger.ts';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmSync, mkdirSync } from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const fixtureDir = process.argv[2] ?? path.join(repoRoot, 'tmp-dogfood');
const logRoot = path.join(repoRoot, '.zerou', 'logs-traceability');

// Clean prior run for determinism
rmSync(logRoot, { recursive: true, force: true });
mkdirSync(logRoot, { recursive: true });

async function main() {
  const logger = createTrackLogger('preset', {
    logRoot,
    minLevel: 'debug',
  });

  const preset = await loadPreset('secrets-leak', {
    builtinDir: path.join(repoRoot, 'presets'),
    logger,
  });
  const findings = await runPreset(
    preset.manifest,
    { cwd: fixtureDir, repoSha: null },
    { logger },
  );
  await logger.flush();

  process.stdout.write(`logRoot: ${logRoot}\n`);
  process.stdout.write(`trace:   ${logger.trace}\n`);
  process.stdout.write(`findings_count: ${findings.length}\n`);
  for (const f of findings) {
    process.stdout.write(
      `  finding: id=${f.id} ruleId=${f.ruleId} file=${f.file} line=${f.line} severity=${f.severity}\n`,
    );
  }
}

await main();
