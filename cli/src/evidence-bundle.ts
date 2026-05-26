/**
 * EvidenceBundle JSON output for `zerou audit --out`.
 *
 * Surface: docs/details/15-hardener-cli-public-surface.md §"EvidenceBundle JSON output".
 */
import * as fs from 'node:fs';
import * as crypto from 'node:crypto';
import path from 'node:path';
import type {
  LoadedPreset,
  VerdictedFinding,
  EngineConfig,
} from './stubs.js';
import { engineFamily } from './stubs.js';
import type { TrackLogger } from './log-types.js';
import { logBranch, logCatch } from './log/branch.js';

export interface ApplyCounters {
  requested: boolean;
  templateApplied: number;
  llmVerifiedApplied: number;
  llmUnverifiedSkipped: number;
  skipNoProposal: number;
}

export interface EvidenceBundle {
  bundleId: string;
  zerouVersion: string;
  trace_id: string;
  audit: {
    startedAt: string;
    endedAt: string;
    cwd: string;
    repoSha: string | null;
    presets: Array<{
      id: string;
      version: number;
      source: 'plugin' | 'project' | 'builtin';
      resolvedPath: string;
      shadowedBy: ('plugin' | 'project' | 'builtin')[];
    }>;
    engineConfig: {
      worker: {
        kind: string;
        modelId: string;
        releaseDate: string;
        family: string;
      };
      critic: {
        kind: string;
        modelId: string;
        releaseDate: string;
        family: string;
      } | null;
    };
  };
  findings: VerdictedFinding[];
  inputFiles: Array<{ path: string; sha256: string }>;
  summary: {
    counts: {
      confirmed: number;
      falsePositive: number;
      needsContext: number;
      criticUnavailable: number;
    };
    byPreset: Record<string, {
      confirmed: number;
      falsePositive: number;
      needsContext: number;
      criticUnavailable: number;
    }>;
    failOnThreshold: 'p1' | 'p2' | 'p3' | 'none';
    exitCode: number;
  };
  apply?: ApplyCounters;
  version: '1.0';
}

export interface BuildBundleInput {
  startedAt: Date;
  endedAt: Date;
  cwd: string;
  repoSha: string | null;
  presets: LoadedPreset[];
  worker: EngineConfig;
  critic: EngineConfig | null;
  findings: VerdictedFinding[];
  readFiles: Iterable<string>;     // repo-relative POSIX paths
  failOnThreshold: 'p1' | 'p2' | 'p3' | 'none';
  exitCode: number;
  apply: ApplyCounters | null;
  trace: string;
  zerouVersion: string;
  /** Optional logger for decision-branch tracing. */
  logger?: TrackLogger | null;
}

function ulid(): string {
  // 10 chars time + 16 chars random (Crockford base32)
  const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const ms = Date.now();
  let timePart = '';
  let t = ms;
  for (let i = 0; i < 10; i++) {
    timePart = CROCKFORD[t % 32]! + timePart;
    t = Math.floor(t / 32);
  }
  const buf = crypto.randomBytes(10);
  let acc = 0;
  let bits = 0;
  let randPart = '';
  for (let i = 0; i < 10 && randPart.length < 16; i++) {
    acc = (acc << 8) | buf[i]!;
    bits += 8;
    while (bits >= 5 && randPart.length < 16) {
      bits -= 5;
      randPart += CROCKFORD[(acc >>> bits) & 0x1f]!;
    }
  }
  return timePart + randPart;
}

export function buildBundle(input: BuildBundleInput): EvidenceBundle {
  const log = input.logger;
  // counts
  const counts = { confirmed: 0, falsePositive: 0, needsContext: 0, criticUnavailable: 0 };
  const byPreset: Record<string, typeof counts> = {};
  for (const f of input.findings) {
    const slot = byPreset[f.presetId] ?? { confirmed: 0, falsePositive: 0, needsContext: 0, criticUnavailable: 0 };
    byPreset[f.presetId] = slot;
    switch (f.verdict) {
      case 'confirmed':
        logBranch(log, 'cli.bundle.verdict-bucket-decision', {
          decision: 'confirmed',
          findingId: f.id,
        });
        counts.confirmed++;
        slot.confirmed++;
        break;
      case 'false-positive':
        logBranch(log, 'cli.bundle.verdict-bucket-decision', {
          decision: 'false-positive',
          findingId: f.id,
        });
        counts.falsePositive++;
        slot.falsePositive++;
        break;
      case 'needs-context':
        logBranch(log, 'cli.bundle.verdict-bucket-decision', {
          decision: 'needs-context',
          findingId: f.id,
        });
        counts.needsContext++;
        slot.needsContext++;
        break;
      case 'critic-unavailable':
        logBranch(log, 'cli.bundle.verdict-bucket-decision', {
          decision: 'critic-unavailable',
          findingId: f.id,
        });
        counts.criticUnavailable++;
        slot.criticUnavailable++;
        break;
    }
  }

  // inputFiles (sha256 of each)
  const inputFiles: Array<{ path: string; sha256: string }> = [];
  const seen = new Set<string>();
  for (const rel of input.readFiles) {
    if (seen.has(rel)) {
      logBranch(log, 'cli.bundle.file-dedupe-decision', {
        decision: 'skip-duplicate',
        file: rel,
      });
      continue;
    }
    seen.add(rel);
    const abs = path.join(input.cwd, rel);
    let sha = '';
    try {
      const data = fs.readFileSync(abs);
      sha = crypto.createHash('sha256').update(data).digest('hex');
    } catch (err) {
      logCatch(log, 'cli.bundle.file-hash-decision', err, {
        file: rel,
        reasoning: 'falling back to empty sha',
      });
      sha = '';
    }
    inputFiles.push({ path: rel, sha256: sha });
  }
  inputFiles.sort((a, b) => a.path.localeCompare(b.path));

  const bundle: EvidenceBundle = {
    bundleId: ulid(),
    zerouVersion: input.zerouVersion,
    trace_id: input.trace,
    audit: {
      startedAt: input.startedAt.toISOString(),
      endedAt: input.endedAt.toISOString(),
      cwd: input.cwd,
      repoSha: input.repoSha,
      presets: input.presets.map((p) => ({
        id: p.manifest.id,
        version: p.manifest.version ?? 1,
        source: p.source,
        resolvedPath: p.resolvedPath,
        shadowedBy: p.shadowedBy,
      })),
      engineConfig: {
        worker: {
          kind: input.worker.kind,
          modelId: input.worker.modelId,
          releaseDate: input.worker.releaseDate,
          family: engineFamily(input.worker),
        },
        critic: input.critic
          ? {
              kind: input.critic.kind,
              modelId: input.critic.modelId,
              releaseDate: input.critic.releaseDate,
              family: engineFamily(input.critic),
            }
          : null,
      },
    },
    findings: input.findings,
    inputFiles,
    summary: {
      counts,
      byPreset,
      failOnThreshold: input.failOnThreshold,
      exitCode: input.exitCode,
    },
    version: '1.0',
  };
  if (input.apply) {
    logBranch(log, 'cli.bundle.apply-include-decision', {
      decision: 'include',
      requested: input.apply.requested,
      templateApplied: input.apply.templateApplied,
    });
    bundle.apply = input.apply;
  } else {
    logBranch(log, 'cli.bundle.apply-include-decision', {
      decision: 'omit',
      reasoning: '--apply not used',
    });
  }
  return bundle;
}

export interface WriteBundleResult {
  ok: boolean;
  bytes: number;
  error?: string;
}

export function writeBundle(
  bundlePath: string,
  bundle: EvidenceBundle,
  logger: TrackLogger,
): WriteBundleResult {
  const text = JSON.stringify(bundle, null, 2);
  try {
    fs.mkdirSync(path.dirname(bundlePath), { recursive: true });
    fs.writeFileSync(bundlePath, text);
    const bytes = Buffer.byteLength(text);
    logBranch(
      logger,
      'cli.bundle.persist-decision',
      {
        decision: 'success',
        path: bundlePath,
        bytes,
      },
      { level: 'info' },
    );
    logger.log('info', 'cli.bundle.write-success', { path: bundlePath, bytes });
    return { ok: true, bytes };
  } catch (e) {
    const msg = (e as Error).message;
    logCatch(logger, 'cli.bundle.persist-decision', e, {
      decision: 'fail',
      path: bundlePath,
    });
    logger.log('error', 'cli.bundle.write-failed', { path: bundlePath, error: msg });
    return { ok: false, bytes: 0, error: msg };
  }
}
