/**
 * Lightweight markdown preset loader.
 *
 * Reads every `presets/*.md` from the configured presets directory, parses YAML
 * frontmatter, and returns LoadedPreset[] compatible with the existing
 * HARDCODED_KEY_PRESET shape used by defaultRunPreset.
 *
 * Phase 7 integration: lets agent orchestrator load all 11+ hardening presets
 * authored by Track P-A/B/C at runtime without baking them into source.
 *
 * v1 SCOPE:
 *   - Parses YAML frontmatter manually (no js-yaml dep; presets follow a
 *     narrow, predictable schema)
 *   - Only resolves the fields the CLI's defaultRunPreset actually consumes:
 *     id, version, rules[{id|ruleId, severity, mechanism, pattern, filePattern,
 *     message|label, fix}], body
 *   - llm-judgment / file-exists mechanisms fall through to defaultRunPreset
 *     which ignores them today (mechanism filter line 366 stubs.ts). They
 *     still show in the preset list and contribute to checklist categorisation.
 */
import * as fs from 'node:fs';
import path from 'node:path';
import type { LoadedPreset, PresetRule, PresetManifest } from '../stubs.js';

export interface LoadOptions {
  presetsDir?: string;
}

export function loadMarkdownPresets(opts: LoadOptions = {}): LoadedPreset[] {
  const dir = opts.presetsDir ?? path.resolve(process.cwd(), 'presets');
  if (!fs.existsSync(dir)) return [];

  const out: LoadedPreset[] = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.md')) continue;
    const abs = path.join(dir, name);
    try {
      const text = fs.readFileSync(abs, 'utf8');
      const preset = parsePresetMarkdown(text, abs);
      if (preset) out.push(preset);
    } catch {
      // skip malformed file silently — caller's listPresets log will show count gap
    }
  }
  return out;
}

function parsePresetMarkdown(text: string, absPath: string): LoadedPreset | null {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!m) return null;
  const frontmatter = m[1]!;
  const body = (m[2] ?? '').trim();

  const fm = parseYamlSubset(frontmatter);
  const id = fm.id as string | undefined;
  if (!id) return null;
  const version = typeof fm.version === 'number' ? fm.version : 2;
  const name = (fm.name as string) ?? id;
  const appliesTo = Array.isArray(fm.appliesTo) ? (fm.appliesTo as string[]) : [];

  const rawRules = Array.isArray(fm.rules) ? (fm.rules as Record<string, unknown>[]) : [];
  const rules: PresetRule[] = [];
  for (const r of rawRules) {
    const ruleId = (r.ruleId as string) ?? (r.id as string) ?? '';
    const severity = (r.severity as 'P1' | 'P2' | 'P3') ?? 'P2';
    const mechanism =
      (r.mechanism as 'static-grep' | 'llm-judgment' | undefined) ?? 'static-grep';
    const label = (r.label as string) ?? (r.message as string) ?? ruleId;

    let pattern: string | undefined;
    let filePattern: string | undefined;
    if (r.detection && typeof r.detection === 'object') {
      const d = r.detection as Record<string, unknown>;
      pattern = d.pattern as string | undefined;
      filePattern = d.filePattern as string | undefined;
    }
    const fixDecl = (r.fix as Record<string, unknown>) ?? undefined;
    const fix: PresetRule['fix'] = fixDecl
      ? {
          kind: (fixDecl.kind as 'template' | 'llm-only') ?? 'template',
          command: fixDecl.command as string | undefined,
          template: fixDecl.template as string | undefined,
          find: fixDecl.find as string | undefined,
          replace: fixDecl.replace as string | undefined,
          verifyCommand: fixDecl.verifyCommand as string | undefined,
        }
      : undefined;

    rules.push({
      id: ruleId,
      severity,
      mechanism: mechanism === 'llm-judgment' ? 'llm-judgment' : 'static-grep',
      message: label,
      pattern,
      filePattern,
      fix,
    });
  }

  const manifest: PresetManifest = {
    id,
    version,
    appliesTo,
    rules,
    body,
  };

  return {
    manifest,
    source: 'builtin',
    resolvedPath: absPath,
    shadowedBy: [],
  };
}

/**
 * Tiny YAML subset parser. Handles the exact shape used by ZeroU preset files:
 *   - top-level key: scalar
 *   - top-level key: [array of strings]
 *   - top-level key: list of objects via '- ' indentation
 *   - nested object fields one level deep
 *   - quoted strings (single + double) + bare scalars
 *   - YAML | block scalars for multi-line strings
 *   - YAML > folded scalars NOT supported (treated as bare)
 *
 * This is purposely small — avoids js-yaml dep. If we hit edge cases the
 * presets can adjust their formatting.
 */
function parseYamlSubset(text: string): Record<string, unknown> {
  const lines = text.split(/\r?\n/);
  const root: Record<string, unknown> = {};
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim() || line.trim().startsWith('#')) {
      i++;
      continue;
    }
    const indent = countIndent(line);
    if (indent === 0) {
      const eq = line.indexOf(':');
      if (eq < 0) {
        i++;
        continue;
      }
      const key = line.slice(0, eq).trim();
      const after = line.slice(eq + 1).trim();
      if (after === '') {
        // Could be a nested block (list or object). Peek next non-empty.
        let j = i + 1;
        while (j < lines.length && !lines[j]!.trim()) j++;
        if (j < lines.length && /^\s*-\s/.test(lines[j]!)) {
          const { values, next } = parseList(lines, j);
          root[key] = values;
          i = next;
          continue;
        }
        if (j < lines.length && countIndent(lines[j]!) > 0) {
          const { obj, next } = parseObject(lines, j, countIndent(lines[j]!));
          root[key] = obj;
          i = next;
          continue;
        }
        root[key] = '';
        i = j;
        continue;
      }
      if (after.startsWith('|')) {
        const { value, next } = parseBlockScalar(lines, i);
        root[key] = value;
        i = next;
        continue;
      }
      if (after.startsWith('[') && after.endsWith(']')) {
        root[key] = parseInlineArray(after);
        i++;
        continue;
      }
      root[key] = parseScalar(after);
      i++;
      continue;
    }
    i++;
  }
  return root;
}

function parseList(
  lines: string[],
  start: number,
): { values: Record<string, unknown>[] | string[]; next: number } {
  const items: Record<string, unknown>[] = [];
  const stringItems: string[] = [];
  let i = start;
  let baseIndent = countIndent(lines[start]!);
  let usingObjects = false;

  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      i++;
      continue;
    }
    const indent = countIndent(line);
    if (indent < baseIndent) break;
    if (indent > baseIndent && items.length === 0 && stringItems.length === 0) {
      baseIndent = indent;
    }
    if (!/^\s*-\s/.test(line)) {
      // Continuation of previous object's field
      if (items.length > 0) {
        const last = items[items.length - 1]!;
        const eq = line.indexOf(':');
        if (eq >= 0) {
          const key = line.slice(0, eq).trim();
          const after = line.slice(eq + 1).trim();
          if (after === '') {
            // nested object — look ahead
            let j = i + 1;
            while (j < lines.length && !lines[j]!.trim()) j++;
            if (j < lines.length && countIndent(lines[j]!) > indent) {
              const { obj, next } = parseObject(lines, j, countIndent(lines[j]!));
              last[key] = obj;
              i = next;
              continue;
            }
            last[key] = '';
          } else if (after.startsWith('|')) {
            const { value, next } = parseBlockScalar(lines, i);
            last[key] = value;
            i = next;
            continue;
          } else if (after.startsWith('[') && after.endsWith(']')) {
            last[key] = parseInlineArray(after);
          } else {
            last[key] = parseScalar(after);
          }
          i++;
          continue;
        }
      }
      i++;
      continue;
    }

    const dashContent = line.replace(/^\s*-\s*/, '');
    if (dashContent.includes(':') && !dashContent.startsWith('"') && !dashContent.startsWith("'")) {
      usingObjects = true;
      const obj: Record<string, unknown> = {};
      const firstEq = dashContent.indexOf(':');
      const fkey = dashContent.slice(0, firstEq).trim();
      const fafter = dashContent.slice(firstEq + 1).trim();
      if (fafter === '') {
        // nested
      } else if (fafter.startsWith('|')) {
        const { value, next } = parseBlockScalar(lines, i);
        obj[fkey] = value;
        i = next;
        items.push(obj);
        continue;
      } else if (fafter.startsWith('[') && fafter.endsWith(']')) {
        obj[fkey] = parseInlineArray(fafter);
      } else {
        obj[fkey] = parseScalar(fafter);
      }
      items.push(obj);
      i++;
      continue;
    }
    stringItems.push(parseScalar(dashContent) as string);
    i++;
  }
  return { values: usingObjects ? items : stringItems, next: i };
}

function parseObject(
  lines: string[],
  start: number,
  baseIndent: number,
): { obj: Record<string, unknown>; next: number } {
  const obj: Record<string, unknown> = {};
  let i = start;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      i++;
      continue;
    }
    const indent = countIndent(line);
    if (indent < baseIndent) break;
    const eq = line.indexOf(':');
    if (eq < 0) {
      i++;
      continue;
    }
    const key = line.slice(0, eq).trim();
    const after = line.slice(eq + 1).trim();
    if (after.startsWith('|')) {
      const { value, next } = parseBlockScalar(lines, i);
      obj[key] = value;
      i = next;
      continue;
    }
    if (after.startsWith('[') && after.endsWith(']')) {
      obj[key] = parseInlineArray(after);
      i++;
      continue;
    }
    if (after === '') {
      // nested
      let j = i + 1;
      while (j < lines.length && !lines[j]!.trim()) j++;
      if (j < lines.length && countIndent(lines[j]!) > indent) {
        const { obj: nested, next } = parseObject(lines, j, countIndent(lines[j]!));
        obj[key] = nested;
        i = next;
        continue;
      }
      obj[key] = '';
      i++;
      continue;
    }
    obj[key] = parseScalar(after);
    i++;
  }
  return { obj, next: i };
}

function parseBlockScalar(lines: string[], start: number): { value: string; next: number } {
  let i = start + 1;
  const baseIndent = (() => {
    while (i < lines.length && !lines[i]!.trim()) i++;
    return i < lines.length ? countIndent(lines[i]!) : 0;
  })();
  const out: string[] = [];
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === '') {
      out.push('');
      i++;
      continue;
    }
    if (countIndent(line) < baseIndent) break;
    out.push(line.slice(baseIndent));
    i++;
  }
  return { value: out.join('\n').trim(), next: i };
}

function parseInlineArray(s: string): string[] {
  const inner = s.slice(1, -1).trim();
  if (!inner) return [];
  return inner.split(',').map((x) => parseScalar(x.trim()) as string);
}

function parseScalar(s: string): unknown {
  if (s === '') return '';
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    return s.slice(1, -1);
  }
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null') return null;
  if (/^-?\d+$/.test(s)) return Number(s);
  if (/^-?\d+\.\d+$/.test(s)) return Number(s);
  return s;
}

function countIndent(line: string): number {
  let n = 0;
  for (const ch of line) {
    if (ch === ' ') n++;
    else if (ch === '\t') n += 2;
    else break;
  }
  return n;
}
