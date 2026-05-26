/**
 * Protocol-2 Preset Framework — finding-id helper.
 *
 * Surface: §"Finding ID contract"
 *   matched_content_normalized = evidence.replace(/\s+/g, '').toLowerCase()
 *   shortHash = sha1(`${file}:${line}:${ruleId}:${matched_content_normalized}`).hex().slice(0,8)
 *   id = `${presetId}.${shortHash}`
 */

import { createHash } from 'node:crypto';

export interface BuildFindingIdInput {
  presetId: string;
  ruleId: string;
  file: string;
  line: number;
  evidence: string;
}

export interface BuildFindingIdResult {
  id: string;
  matched_content_normalized: string;
}

export function buildFindingId(input: BuildFindingIdInput): BuildFindingIdResult {
  const matched = input.evidence.replace(/\s+/g, '').toLowerCase();
  const hashSrc = `${input.file}:${input.line}:${input.ruleId}:${matched}`;
  const shortHash = createHash('sha1').update(hashSrc).digest('hex').slice(0, 8);
  return {
    id: `${input.presetId}.${shortHash}`,
    matched_content_normalized: matched,
  };
}
