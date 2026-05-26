/**
 * file-exists mechanism — checks repo-relative paths for presence/absence.
 *
 * Surface: §"Per-mechanism `detection` config schemas (v0.2)" FileExistsDetection.
 */

import { stat } from 'node:fs/promises';
import path from 'node:path';
import type {
  Finding,
  FileExistsDetection,
  PresetRule,
  PresetManifest,
} from '../types.js';
import { buildFindingId } from '../finding-id.js';
import { PresetError } from '../errors.js';

export async function runFileExists(
  manifest: PresetManifest,
  rule: PresetRule,
  ctx: { cwd: string },
): Promise<Finding[]> {
  const det = rule.detection as unknown as FileExistsDetection;
  if (!Array.isArray(det.paths) || det.paths.length === 0) {
    throw new PresetError(
      'PRESET-E-2',
      `file-exists rule "${rule.ruleId}" missing detection.paths`,
    );
  }
  if (det.expect !== 'present' && det.expect !== 'absent') {
    throw new PresetError(
      'PRESET-E-2',
      `file-exists rule "${rule.ruleId}" invalid detection.expect`,
    );
  }
  const findings: Finding[] = [];
  for (const repoRel of det.paths) {
    const abs = path.join(ctx.cwd, repoRel);
    let exists = false;
    try {
      await stat(abs);
      exists = true;
    } catch {
      exists = false;
    }
    const expected = det.expect === 'present';
    if (exists !== expected) {
      // Emit a Finding. line=0 for whole-file/path findings per surface.
      const evidence = `expected ${det.expect} for path ${repoRel}; actual: ${exists ? 'present' : 'absent'}`;
      const { id, matched_content_normalized } = buildFindingId({
        presetId: manifest.id,
        ruleId: rule.ruleId,
        file: repoRel,
        line: 0,
        evidence,
      });
      findings.push({
        id,
        presetId: manifest.id,
        ruleId: rule.ruleId,
        severity: rule.severity,
        file: repoRel,
        line: 0,
        evidence,
        matched_content_normalized,
        message: rule.label,
        remediationHint: rule.rationale ?? null,
        fixAvailable: rule.fix ? rule.fix.kind : null,
        version: '1.0',
      });
    }
  }
  return findings;
}
