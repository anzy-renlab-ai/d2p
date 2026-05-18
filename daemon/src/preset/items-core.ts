// 32-item core preset checklist — single source of truth for d2p's
// production-readiness gates. Per docs/plans/2026-05-13-track-c-features.md F2.
//
// Each item lives here once; per-project-type preset files inherit by filtering
// against `appliesTo`. Adding an item:
//   1. Add an entry below
//   2. Set `appliesTo` to the project types it applies to (letters W/A/C/L/S/M/D/ML)
//   3. Re-run vitest — the per-type preset schema tests will catch mismatches
//
// Sources cited per item: 12F-* = 12-Factor App; OWASP-A*:2025; SRE = Google SRE
// Launch Checklist; WCAG-* = WCAG 2.2 AA; OpenSSF = OpenSSF Scorecard; base = no
// external source; d2p-native = d2p-specific (the vision-verdict gate).

import type { PresetItem, ProjectType } from '../types.js';

export const PROJECT_TYPE_LETTERS: Record<ProjectType, string> = {
  'saas-web':     'W',
  'api-service':  'A',
  'cli-tool':     'C',
  'library':      'L',
  'static-site':  'S',
  'mobile':       'M',
  'desktop-app':  'D',
  'ml-script':    'ML',
  'unknown':      '*', // unknown sees the union — sentinel handled by loader
};

export const PRESET_CORE_ITEMS: readonly PresetItem[] = [
  { id: 'build-typecheck',         label: 'Typecheck / compile passes clean',          severity: 'P1', mechanism: 'test-execution',      source: 'base',           appliesTo: ['W','A','C','L','S','M','D','ML'] },
  { id: 'build-reproducible',      label: 'Build command exits 0 on clean checkout',   severity: 'P1', mechanism: 'test-execution',      source: '12F-V',          appliesTo: ['W','A','C','L','S','M','D','ML'] },
  { id: 'test-runner-present',     label: 'Test runner configured + at least one test',severity: 'P1', mechanism: 'file-exists',         source: 'base',           appliesTo: ['W','A','C','L','S','M','D','ML'] },
  { id: 'test-happy-path-passes',  label: 'npm test exits 0',                          severity: 'P1', mechanism: 'test-execution',      source: 'base',           appliesTo: ['W','A','C','L','S','M','D','ML'] },
  { id: 'test-edge-cases',         label: 'At least one negative test per public fn',  severity: 'P2', mechanism: 'llm-judgment',        source: 'base',           appliesTo: ['L','A','C','ML'] },
  { id: 'readme-quickstart',       label: 'README has fenced install + run block',     severity: 'P1', mechanism: 'static-grep',         source: 'base',           appliesTo: ['W','A','C','L','S','M','D','ML'] },
  { id: 'license-file',            label: 'LICENSE present + SPDX-recognized',         severity: 'P1', mechanism: 'file-exists',         source: 'OpenSSF',        appliesTo: ['W','A','C','L','S','M','D','ML'] },
  { id: 'env-example',             label: '.env.example covers every env var read',    severity: 'P1', mechanism: 'cross-file-cohesion', source: '12F-III',        appliesTo: ['W','A'] },
  { id: 'no-hardcoded-secrets',    label: 'No hardcoded API keys / passwords',         severity: 'P1', mechanism: 'static-grep',         source: 'OWASP-A02:2025', appliesTo: ['W','A','C','L','S','M','D','ML'] },
  { id: 'lockfile-present',        label: 'Dependency lockfile committed',             severity: 'P1', mechanism: 'file-exists',         source: 'OpenSSF',        appliesTo: ['W','A','C','L','S','M','D','ML'] },
  { id: 'deps-no-high-vuln',       label: 'npm audit / pip-audit · 0 high',            severity: 'P1', mechanism: 'test-execution',      source: 'OWASP-A03:2025', appliesTo: ['W','A','C','L','S','M','D','ML'] },
  { id: 'port-from-env',           label: 'Server reads PORT from env',                severity: 'P1', mechanism: 'static-grep',         source: '12F-VII',        appliesTo: ['W','A'] },
  { id: 'sigterm-handler',         label: 'Graceful shutdown on SIGTERM',              severity: 'P2', mechanism: 'static-grep',         source: '12F-IX',         appliesTo: ['W','A','D'] },
  { id: 'stdout-logging',          label: 'Logs go to stdout (not files)',             severity: 'P2', mechanism: 'static-grep',         source: '12F-XI',         appliesTo: ['W','A','C'] },
  { id: 'health-endpoint',         label: 'GET /health returns 200',                   severity: 'P1', mechanism: 'static-grep',         source: 'SRE',            appliesTo: ['W','A'] },
  { id: 'structured-logs',         label: 'Logs parseable JSON / carry request id',    severity: 'P2', mechanism: 'cross-file-cohesion', source: 'SRE',            appliesTo: ['W','A'] },
  { id: 'error-handler-present',   label: 'Top-level error handler / boundary',        severity: 'P2', mechanism: 'llm-judgment',        source: 'OWASP-A10:2025', appliesTo: ['W','A','D'] },
  { id: 'auth-on-mutating-routes', label: 'Non-GET routes covered by auth',            severity: 'P1', mechanism: 'llm-judgment',        source: 'OWASP-A01:2025', appliesTo: ['W','A'] },
  { id: 'password-hash-strong',    label: 'bcrypt / argon2 / scrypt only',             severity: 'P1', mechanism: 'static-grep',         source: 'OWASP-A04:2025', appliesTo: ['W','A'] },
  { id: 'https-only-prod',         label: 'No http:// in prod · cookies Secure',       severity: 'P1', mechanism: 'static-grep',         source: 'OWASP-A02:2025', appliesTo: ['W','A'] },
  { id: 'rate-limit-public',       label: 'Public routes wrapped in rate-limit',       severity: 'P2', mechanism: 'static-grep',         source: 'base',           appliesTo: ['W','A'] },
  { id: 'sql-parameterized',       label: 'No string-concat into SQL execute',         severity: 'P1', mechanism: 'static-grep',         source: 'OWASP-A05:2025', appliesTo: ['W','A','ML'] },
  { id: 'cors-not-wildcard',       label: 'No Origin:* with credentials',              severity: 'P1', mechanism: 'static-grep',         source: 'OWASP-A02:2025', appliesTo: ['W','A'] },
  { id: 'a11y-axe-clean',          label: 'axe-core · 0 serious violations',           severity: 'P1', mechanism: 'test-execution',      source: 'WebAIM',         appliesTo: ['W','S'] },
  { id: 'viewport-meta',           label: '<meta viewport> present',                   severity: 'P2', mechanism: 'static-grep',         source: 'base',           appliesTo: ['W','S','M'] },
  { id: 'error-boundary',          label: 'Root-level error boundary component',       severity: 'P2', mechanism: 'static-grep',         source: 'base',           appliesTo: ['W','S'] },
  { id: 'ci-pipeline',             label: 'CI runs test + build on PR',                severity: 'P2', mechanism: 'file-exists',         source: 'OpenSSF',        appliesTo: ['W','A','C','L','S','M','D','ML'] },
  { id: 'ci-token-perms',          label: 'workflows set permissions explicitly',      severity: 'P2', mechanism: 'static-grep',         source: 'OpenSSF',        appliesTo: ['W','A','C','L','S','M','D','ML'] },
  { id: 'deploy-config',           label: 'Target deploy config valid',                severity: 'P1', mechanism: 'file-exists',         source: 'Vercel/Fly',     appliesTo: ['W','A','L'] },
  { id: 'package-publishable',     label: 'npm pack / python -m build succeeds',       severity: 'P1', mechanism: 'test-execution',      source: 'npm/PyPI',       appliesTo: ['L'] },
  { id: 'binary-not-committed',    label: 'No *.exe / *.dll outside dist/',            severity: 'P3', mechanism: 'static-grep',         source: 'OpenSSF',        appliesTo: ['W','A','C','L','S','M','D','ML'] },
  { id: 'vision-verdict',          label: 'Product matches user vision',               severity: 'P1', mechanism: 'llm-judgment',        source: 'd2p-native',     appliesTo: ['W','A','C','L','S','M','D','ML'] },
] as const;

/** Filter the core list to items that apply to the given project type. */
export function corePresetItemsForType(type: ProjectType): PresetItem[] {
  if (type === 'unknown') return [...PRESET_CORE_ITEMS];
  const letter = PROJECT_TYPE_LETTERS[type];
  if (!letter || letter === '*') return [...PRESET_CORE_ITEMS];
  return PRESET_CORE_ITEMS.filter((i) => i.appliesTo.includes(letter));
}

export function countItemsByMechanism(items: PresetItem[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const it of items) counts[it.mechanism] = (counts[it.mechanism] ?? 0) + 1;
  return counts;
}
