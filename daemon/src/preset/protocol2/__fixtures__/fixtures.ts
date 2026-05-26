/**
 * Test fixture helpers — write preset markdown to the right place per layer.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export type Layer = 'plugin' | 'project' | 'builtin';

export function mkPreset(root: string, layer: Layer, id: string, manifest: string): string {
  let file: string;
  if (layer === 'plugin') {
    const dir = path.join(root, 'node_modules', `@zerou-preset-${id}`);
    mkdirSync(dir, { recursive: true });
    file = path.join(dir, 'preset.md');
  } else if (layer === 'project') {
    const dir = path.join(root, '.zerou', 'presets');
    mkdirSync(dir, { recursive: true });
    file = path.join(dir, `${id}.md`);
  } else {
    const dir = path.join(root, '__builtin__');
    mkdirSync(dir, { recursive: true });
    file = path.join(dir, `${id}.md`);
  }
  writeFileSync(file, manifest, 'utf8');
  return file;
}

// ── Manifest builders ────────────────────────────────────────────────────────

export function MIN_PRESET(args: { id: string; name?: string; pattern?: string }): string {
  const name = args.name ?? args.id;
  const pattern = args.pattern ?? 'TODO';
  return `---
id: ${args.id}
version: 2
name: ${name}
rules:
  - ruleId: only-rule
    label: matches "${pattern}"
    severity: P3
    mechanism: static-grep
    source: fixture
    detection:
      pattern: '${pattern}'
---

body text
`;
}

export function UNKNOWN_KEY_PRESET(id = 'cli-tool'): string {
  return `---
id: ${id}
version: 2
name: ${id}
weirdField: true
rules:
  - ruleId: r
    label: x
    severity: P3
    mechanism: static-grep
    source: fixture
    detection:
      pattern: 'TODO'
---

body
`;
}

export function MISSING_NAME_PRESET(id = 'cli-tool'): string {
  return `---
id: ${id}
version: 2
rules:
  - ruleId: r
    label: x
    severity: P3
    mechanism: static-grep
    source: fixture
    detection:
      pattern: 'TODO'
---

body
`;
}

export function BAD_VERSION_PRESET(id = 'cli-tool'): string {
  return `---
id: ${id}
version: "two"
name: ${id}
rules:
  - ruleId: r
    label: x
    severity: P3
    mechanism: static-grep
    source: fixture
    detection:
      pattern: 'TODO'
---

body
`;
}

export function ZERO_RULES_PRESET(id = 'cli-tool'): string {
  return `---
id: ${id}
version: 2
name: ${id}
rules: []
---

body
`;
}

export function DUP_RULE_ID_PRESET(id = 'cli-tool'): string {
  return `---
id: ${id}
version: 2
name: ${id}
rules:
  - ruleId: r
    label: a
    severity: P3
    mechanism: static-grep
    source: fixture
    detection:
      pattern: 'A'
  - ruleId: r
    label: b
    severity: P3
    mechanism: static-grep
    source: fixture
    detection:
      pattern: 'B'
---

body
`;
}

export function LLM_NO_POLICY_PRESET(id = 'cli-tool'): string {
  return `---
id: ${id}
version: 2
name: ${id}
rules:
  - ruleId: r
    label: l
    severity: P3
    mechanism: llm-judgment
    source: fixture
    detection:
      prompt: "is this risky? {{file}} {{line}} {{evidence}}"
---

body
`;
}

export function BAD_REGEX_PRESET(id = 'cli-tool'): string {
  return `---
id: ${id}
version: 2
name: ${id}
rules:
  - ruleId: r
    label: l
    severity: P3
    mechanism: static-grep
    source: fixture
    detection:
      pattern: '(unterminated'
---

body
`;
}

export function PRESET_NAMED(name: string, id: string): string {
  return MIN_PRESET({ id, name });
}

export function PRESET_WITH_LLM_RULE(args: {
  id: string;
  criticEnforce: boolean;
  maxTokens?: number;
}): string {
  const maxTokens = args.maxTokens ? `\n      maxTokens: ${args.maxTokens}` : '';
  return `---
id: ${args.id}
version: 2
name: ${args.id}
rules:
  - ruleId: r
    label: judge
    severity: P3
    mechanism: llm-judgment
    source: fixture
    detection:
      prompt: "judge {{file}}"
    llmPolicy:
      criticEnforce: ${args.criticEnforce}${maxTokens}
---

body
`;
}
