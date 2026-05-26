/**
 * static-grep mechanism — scan files matching filePattern for regex.
 *
 * Surface: §"Per-mechanism `detection` config schemas (v0.2)" StaticGrepDetection.
 */

import { readFile, stat, readdir } from 'node:fs/promises';
import path from 'node:path';
import type {
  Finding,
  PresetRule,
  StaticGrepDetection,
  PresetManifest,
} from '../types.js';
import { buildFindingId } from '../finding-id.js';
import { PresetError } from '../errors.js';

// Default exclusion list per surface §"RunContext.fileFilter" + AU-8 resolution.
const DEFAULT_EXCLUDE_DIRS = new Set([
  '.git',
  'node_modules',
  '.zerou',
  'dist',
  'build',
  '.next',
  '.turbo',
  '.nuxt',
  'coverage',
  '__pycache__',
]);

const EVIDENCE_MAX_BYTES = 2048;
const EVIDENCE_TRUNCATE_AT = 2045; // 2048 - len('...')

function truncateEvidence(s: string): string {
  // Use byte-length (utf-8). For ASCII (the common case) length === bytes.
  const buf = Buffer.from(s, 'utf8');
  if (buf.length <= EVIDENCE_MAX_BYTES) return s;
  const head = buf.subarray(0, EVIDENCE_TRUNCATE_AT).toString('utf8');
  return head + '...';
}

export interface RunContextLite {
  cwd: string;
  fileFilter?: (path: string) => boolean;
}

function isDefaultExcluded(repoRel: string): boolean {
  const parts = repoRel.split(/[\\/]/);
  for (const part of parts) {
    if (DEFAULT_EXCLUDE_DIRS.has(part)) return true;
  }
  return false;
}

async function walkFiles(root: string, includeFilter: (abs: string, repoRel: string) => boolean): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      const abs = path.join(dir, name);
      let isDir = false;
      let isFile = false;
      try {
        const st = await stat(abs);
        isDir = st.isDirectory();
        isFile = st.isFile();
      } catch {
        continue;
      }
      const repoRel = path.relative(root, abs).split(path.sep).join('/');
      if (isDir) {
        // Default exclusion is a "include all except these dirs" filter — apply
        // before recursing.
        if (DEFAULT_EXCLUDE_DIRS.has(name)) continue;
        await walk(abs);
      } else if (isFile) {
        if (includeFilter(abs, repoRel)) out.push(abs);
      }
    }
  }
  await walk(root);
  return out;
}

// Glob → regex (small subset: **, *, ?, char class, brace groups). Sufficient
// for filePattern values like 'src/**/*.{ts,tsx,js,jsx}'.
//
// Semantics matching standard glob:
//   - `**/` matches zero or more path components (so `src/**/*.ts` matches both
//     `src/a.ts` and `src/sub/a.ts`).
//   - `*` matches any chars except `/`.
//   - `?` matches a single char except `/`.
function globToRegex(glob: string): RegExp {
  // Step 1: replace brace groups with placeholders so the glob-tokenizer
  // doesn't re-interpret the inserted '?' / '|' / '(' as glob meta.
  const placeholders: string[] = [];
  const withPh = glob.replace(/\{([^}]+)\}/g, (_m, inner: string) => {
    const parts = inner.split(',').map((p) => p.trim().replace(/[.+^$()|[\]\\]/g, (ch) => '\\' + ch));
    const replacement = '(?:' + parts.join('|') + ')';
    const idx = placeholders.length;
    placeholders.push(replacement);
    return `\x00P${idx}\x00`;
  });

  let out = '^';
  for (let i = 0; i < withPh.length; i++) {
    const c = withPh[i]!;
    if (c === '\x00') {
      // Pull placeholder index
      const end = withPh.indexOf('\x00', i + 1);
      const tag = withPh.slice(i + 1, end); // 'P<n>'
      const idx = parseInt(tag.slice(1), 10);
      out += placeholders[idx]!;
      i = end;
    } else if (c === '*' && withPh[i + 1] === '*') {
      if (withPh[i + 2] === '/') {
        out += '(?:.*/)?';
        i += 2;
      } else {
        out += '.*';
        i += 1;
      }
    } else if (c === '*') {
      out += '[^/]*';
    } else if (c === '?') {
      out += '[^/]';
    } else if ('.+^$()|[]\\'.includes(c)) {
      out += '\\' + c;
    } else {
      out += c;
    }
  }
  out += '$';
  return new RegExp(out);
}

export async function runStaticGrep(
  manifest: PresetManifest,
  rule: PresetRule,
  ctx: RunContextLite,
): Promise<Finding[]> {
  const detection = rule.detection as unknown as StaticGrepDetection;
  if (typeof detection.pattern !== 'string') {
    throw new PresetError(
      'PRESET-E-2',
      `static-grep rule "${rule.ruleId}" missing detection.pattern`,
    );
  }
  let regex: RegExp;
  try {
    // The flags must include 'g' (or 'gm') to find ALL matches per file. We
    // honor caller flags but ensure 'g' is present.
    const userFlags = typeof detection.flags === 'string' ? detection.flags : '';
    const flags = userFlags.includes('g') ? userFlags : userFlags + 'g';
    regex = new RegExp(detection.pattern, flags);
  } catch (err) {
    // Defense in depth: loader should already have caught this as PRESET-E-6.
    throw new PresetError(
      'PRESET-E-6',
      `runtime regex compile failure for rule "${rule.ruleId}": ${(err as Error).message}`,
    );
  }

  const filePatternRe =
    typeof detection.filePattern === 'string' ? globToRegex(detection.filePattern) : null;

  const customFilter = ctx.fileFilter;

  const includeFilter = (_abs: string, repoRel: string): boolean => {
    if (customFilter) {
      return customFilter(repoRel);
    }
    if (isDefaultExcluded(repoRel)) return false;
    if (filePatternRe && !filePatternRe.test(repoRel)) return false;
    return true;
  };

  const files = await walkFiles(ctx.cwd, includeFilter);

  const findings: Finding[] = [];
  for (const abs of files) {
    let content: string;
    try {
      content = await readFile(abs, 'utf8');
    } catch {
      continue;
    }
    // Reset regex.lastIndex (matters when 'g' flag set)
    regex.lastIndex = 0;
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      // Test each line independently (line-level grep semantics)
      const lineRegex = new RegExp(regex.source, regex.flags.replace('g', '')); // single-match test
      const match = lineRegex.exec(line);
      if (!match) continue;
      const repoRel = path.relative(ctx.cwd, abs).split(path.sep).join('/');
      const evidenceRaw = line;
      const evidence = truncateEvidence(evidenceRaw);
      const lineNum = i + 1;
      const { id, matched_content_normalized } = buildFindingId({
        presetId: manifest.id,
        ruleId: rule.ruleId,
        file: repoRel,
        line: lineNum,
        evidence,
      });
      findings.push({
        id,
        presetId: manifest.id,
        ruleId: rule.ruleId,
        severity: rule.severity,
        file: repoRel,
        line: lineNum,
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
