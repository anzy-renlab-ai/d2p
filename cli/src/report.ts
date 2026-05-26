/**
 * Stdout report rendering.
 * 6 sections: header, preset list (with shadow warnings), findings (grouped by
 * severity then preset), summary, apply summary (if --apply), exit line.
 *
 * Surface: §"Stdout report" + §"Summary section".
 */
import type { LoadedPreset, VerdictedFinding } from './stubs.js';
import type { ApplyCounters } from './evidence-bundle.js';

interface Colors {
  red: (s: string) => string;
  yellow: (s: string) => string;
  dim: (s: string) => string;
  bold: (s: string) => string;
  reset: string;
}

function makeColors(useColor: boolean): Colors {
  if (!useColor) {
    return {
      red: (s) => s,
      yellow: (s) => s,
      dim: (s) => s,
      bold: (s) => s,
      reset: '',
    };
  }
  return {
    red: (s) => `[31m${s}[0m`,
    yellow: (s) => `[33m${s}[0m`,
    dim: (s) => `[2m${s}[0m`,
    bold: (s) => `[1m${s}[0m`,
    reset: '[0m',
  };
}

export interface ReportInput {
  cwd: string;
  presets: LoadedPreset[];
  shadowedPresets: Array<{
    presetId: string;
    winningSource: 'plugin' | 'project' | 'builtin';
    shadowedSources: ('plugin' | 'project' | 'builtin')[];
  }>;
  findings: VerdictedFinding[];
  workerFamily: string;
  failOnThreshold: 'p1' | 'p2' | 'p3' | 'none';
  apply: ApplyCounters | null;
  exitCode: number;
  useColor: boolean;
}

export function renderReport(input: ReportInput): string {
  const c = makeColors(input.useColor);
  const lines: string[] = [];

  // 1. Header
  lines.push(c.bold(`zerou audit ${input.cwd}`));
  lines.push('');

  // 2. Preset list
  if (input.presets.length === 0) {
    lines.push(c.dim('  (no presets matched)'));
  } else {
    lines.push(`Presets (${input.presets.length}):`);
    for (const p of input.presets) {
      lines.push(`  - ${p.manifest.id} (${p.source})`);
    }
  }
  for (const sw of input.shadowedPresets) {
    lines.push(
      c.yellow(
        `warn: preset ${sw.presetId} overridden by ${sw.winningSource} (shadowed: ${sw.shadowedSources.join(', ')})`,
      ),
    );
  }
  lines.push('');

  // 3. Findings (grouped by severity then preset)
  const total = input.findings.length;
  if (total === 0) {
    lines.push(c.dim('No findings.'));
  } else {
    const order: Array<'P1' | 'P2' | 'P3'> = ['P1', 'P2', 'P3'];
    for (const sev of order) {
      const sevFindings = input.findings.filter((f) => f.severity === sev);
      if (sevFindings.length === 0) continue;
      const label =
        sev === 'P1' ? c.red(`[${sev}]`) : sev === 'P2' ? c.yellow(`[${sev}]`) : c.dim(`[${sev}]`);
      lines.push(`${label} ${sevFindings.length} findings`);
      // Group by preset
      const byPreset = new Map<string, VerdictedFinding[]>();
      for (const f of sevFindings) {
        const arr = byPreset.get(f.presetId) ?? [];
        arr.push(f);
        byPreset.set(f.presetId, arr);
      }
      for (const [presetId, fs] of byPreset) {
        const preset = input.presets.find((p) => p.manifest.id === presetId);
        // Remediation guidance: render manifest.body verbatim
        if (preset?.manifest.body) {
          lines.push(c.dim('  Remediation guidance:'));
          for (const ln of preset.manifest.body.split(/\r?\n/)) {
            lines.push('    ' + ln);
          }
        }
        for (const f of fs) {
          const verdictTag =
            f.verdict === 'confirmed'
              ? c.red('confirmed')
              : f.verdict === 'false-positive'
                ? c.dim('false-positive')
                : f.verdict === 'needs-context'
                  ? c.yellow('needs-context')
                  : c.dim('critic-unavailable');
          lines.push(`  - ${f.file}:${f.line} [${verdictTag}] ${f.message}`);
          lines.push(`      evidence: ${f.evidence}`);
        }
      }
    }
  }
  lines.push('');

  // 4. Summary section (Q11 micro - pinned regex)
  const counts = {
    confirmed: input.findings.filter((f) => f.verdict === 'confirmed').length,
    falsePositive: input.findings.filter((f) => f.verdict === 'false-positive').length,
    needsContext: input.findings.filter((f) => f.verdict === 'needs-context').length,
    criticUnavailable: input.findings.filter((f) => f.verdict === 'critic-unavailable').length,
  };
  lines.push(
    `Of ${total} findings: ${counts.confirmed} confirmed / ${counts.falsePositive} false-positive / ${counts.needsContext} needs-context / ${counts.criticUnavailable} critic-unavailable`,
  );
  if (counts.criticUnavailable > 0) {
    lines.push(
      `configure a second engine (different family from ${input.workerFamily}) to verdict the remaining ${counts.criticUnavailable}.`,
    );
  }

  // 5. Apply summary
  if (input.apply) {
    lines.push('');
    lines.push(
      `Apply: ${input.apply.templateApplied} template, ${input.apply.llmVerifiedApplied} llm-verified, ${input.apply.llmUnverifiedSkipped} skipped-unverified, ${input.apply.skipNoProposal} skipped-no-proposal`,
    );
  }

  // 6. Exit line
  lines.push('');
  lines.push(c.dim(`exit ${input.exitCode}`));

  return lines.join('\n') + '\n';
}
