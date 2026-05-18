import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import type {
  PresetFrontmatter,
  PresetItem,
  PresetOverrides,
  ProjectType,
  PresetStatusItem,
  GapCategory,
  PresetMechanism,
} from '../types.js';
import { ALL_GAP_CATEGORIES, ALL_PRESET_MECHANISMS } from '../types.js';
import { corePresetItemsForType } from './items-core.js';

const PresetItemSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{1,63}$/, 'id must be lower-kebab'),
  label: z.string().min(1),
  severity: z.enum(['P1', 'P2', 'P3']),
  mechanism: z.enum(ALL_PRESET_MECHANISMS as unknown as [PresetMechanism, ...PresetMechanism[]]),
  source: z.string().min(1),
  appliesTo: z.array(z.string().regex(/^[A-Z]{1,3}$/)).min(1),
});

const PresetFrontmatterSchema = z.object({
  type: z.string().min(1),
  name: z.string().min(1),
  version: z.number().int().positive(),
  inherits: z.array(z.string()).optional(),
  high_sensitivity_categories: z
    .array(z.enum(ALL_GAP_CATEGORIES as unknown as [GapCategory, ...GapCategory[]]))
    .optional(),
  items: z.array(PresetItemSchema).optional(),
});

const PresetOverridesSchema = z.object({
  add: z
    .array(
      z.object({
        slug: z.string().regex(/^[a-z][a-z0-9-]{1,63}$/),
        category: z.enum(ALL_GAP_CATEGORIES as unknown as [GapCategory, ...GapCategory[]]),
        description: z.string().min(1),
        severity: z.enum(['P1', 'P2', 'P3']),
      }),
    )
    .default([]),
  remove: z.array(z.string()).default([]),
  skip: z.array(z.string()).default([]),
});

export interface LoadedPreset {
  frontmatter: PresetFrontmatter;
  body: string;
  raw: string;
}

function defaultPresetsDir(): string {
  if (process.env.D2P_PRESETS_DIR) return process.env.D2P_PRESETS_DIR;
  // daemon/dist/preset/loader.js -> repo root presets/
  const here = path.dirname(fileURLToPath(import.meta.url));
  // try ../../../presets first (dist), then ../../presets (src)
  return path.resolve(here, '..', '..', '..', 'presets');
}

export async function listAvailablePresets(presetsDir = defaultPresetsDir()): Promise<string[]> {
  try {
    const files = await readdir(presetsDir);
    return files.filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, ''));
  } catch {
    return [];
  }
}

export async function readPreset(
  type: ProjectType | string,
  presetsDir = defaultPresetsDir(),
): Promise<LoadedPreset> {
  const file = path.join(presetsDir, `${type}.md`);
  const raw = await readFile(file, 'utf8');
  const parsed = matter(raw);
  const fmResult = PresetFrontmatterSchema.safeParse(parsed.data);
  if (!fmResult.success) {
    throw new Error(`invalid preset frontmatter ${type}: ${fmResult.error.message}`);
  }
  const frontmatter = fmResult.data as PresetFrontmatter;
  // Fill items from the core source-of-truth when the preset author hasn't
  // explicitly defined them. Per-type files can override by listing items in
  // frontmatter; otherwise the 32-item core list filtered by appliesTo wins.
  if (!frontmatter.items || frontmatter.items.length === 0) {
    frontmatter.items = corePresetItemsForType(type as ProjectType);
  }
  return { frontmatter, body: parsed.content, raw };
}

/** Items partitioned by mechanism — handy for reviewer-routing decisions. */
export function partitionByMechanism(items: PresetItem[]): {
  mechanical: PresetItem[];   // static-grep | file-exists | test-execution
  reviewer: PresetItem[];     // cross-file-cohesion | llm-judgment
} {
  const mechanical: PresetItem[] = [];
  const reviewer: PresetItem[] = [];
  for (const it of items) {
    if (it.mechanism === 'cross-file-cohesion' || it.mechanism === 'llm-judgment') {
      reviewer.push(it);
    } else {
      mechanical.push(it);
    }
  }
  return { mechanical, reviewer };
}

export async function readOverrides(demoPath: string): Promise<PresetOverrides> {
  const file = path.join(demoPath, '.d2p', 'preset-overrides.yaml');
  try {
    const raw = await readFile(file, 'utf8');
    const parsed = parseYaml(raw);
    const result = PresetOverridesSchema.safeParse(parsed);
    if (!result.success) return { add: [], remove: [], skip: [] };
    return result.data as PresetOverrides;
  } catch {
    return { add: [], remove: [], skip: [] };
  }
}

/** Apply overrides to a list of preset_status items returned by the differ. */
export function applyOverridesToStatus(
  items: PresetStatusItem[],
  overrides: PresetOverrides,
): PresetStatusItem[] {
  return items
    .filter((it) => !overrides.remove.includes(it.item))
    .map((it) =>
      overrides.skip.includes(it.item) ? { ...it, status: 'done' as const, note: 'skipped by user' } : it,
    );
}
