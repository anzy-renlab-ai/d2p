// Track P2 traceability acceptance dogfood (per dispatch-notes #13).
//
// Loads the secrets-leak preset, runs it against a fixture repo containing
// a hardcoded Stripe key, prints the resulting findings.

import { loadPreset } from '../daemon/src/preset/protocol2/loader.ts';
import { runPreset } from '../daemon/src/preset/protocol2/runner.ts';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const fixtureDir = process.argv[2] ?? '/tmp/zerou-p2-dogfood';

async function main() {
  const preset = await loadPreset('secrets-leak', {
    builtinDir: path.join(repoRoot, 'presets'),
  });
  const findings = await runPreset(preset.manifest, { cwd: fixtureDir, repoSha: null });
  process.stdout.write(JSON.stringify(findings, null, 2) + '\n');
}

await main();
