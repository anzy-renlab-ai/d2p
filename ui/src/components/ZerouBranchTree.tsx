import { useMemo, useState } from 'react';
import type { BranchCoverageReport, BranchNode } from '../types-zerou.js';

type Filter = 'all' | 'self-deceiving' | 'untested' | 'covered';

const VERDICT_GLYPH: Record<BranchNode['verdict'], string> = {
  covered:     '✅',
  'run-only':  '🟢',
  'judge-only':'🟡',
  'spec-only': '⚠',
  untested:    '🔴',
  unknown:     '•',
};

const VERDICT_TONE: Record<BranchNode['verdict'], string> = {
  covered:     'text-forest',
  'run-only':  'text-forest',
  'judge-only':'text-coral',
  'spec-only': 'text-coral',
  untested:    'text-rust',
  unknown:     'text-muted',
};

export function ZerouBranchTree({ report }: { report: BranchCoverageReport | null }) {
  const [filter, setFilter] = useState<Filter>('all');
  const [openFn, setOpenFn] = useState<string | null>(null);

  if (!report) {
    return (
      <div className="card p-6 text-sm text-muted italic font-serif" data-testid="zerou-branch-tree">
        Branch coverage unavailable.
      </div>
    );
  }

  const rows = useMemo(() => {
    if (filter === 'self-deceiving') return report.functions.filter((f) => f.selfDeceivingCount > 0);
    if (filter === 'untested') return report.functions.filter((f) => f.untestedCount > 0);
    if (filter === 'covered') return report.functions.filter((f) => f.coveredCount === f.branchCount);
    return report.functions;
  }, [report.functions, filter]);

  const s = report.summary;

  return (
    <section className="card overflow-hidden" data-testid="zerou-branch-tree">
      <div className="card-header flex items-center justify-between flex-wrap gap-2">
        <span>
          Branch coverage{' '}
          <span className="text-xs font-sans text-muted/70 ml-2">
            {s.functionsAnalyzed} fns · {s.selfDeceivingTotal} self-deceiving · {s.untestedTotal} untested
          </span>
        </span>
        <div className="flex items-center gap-1.5">
          <label className="text-[10px] text-muted/70 uppercase tracking-wider mr-1">Filter</label>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as Filter)}
            className="text-xs bg-cream border border-warmline rounded px-2 py-1"
            data-testid="zerou-branch-filter"
          >
            <option value="all">All ({report.functions.length})</option>
            <option value="self-deceiving">Has self-deceiving ({report.functions.filter((f) => f.selfDeceivingCount > 0).length})</option>
            <option value="untested">Has untested ({report.functions.filter((f) => f.untestedCount > 0).length})</option>
            <option value="covered">Fully covered ({report.functions.filter((f) => f.coveredCount === f.branchCount).length})</option>
          </select>
        </div>
      </div>

      <ul className="divide-y divide-warmline max-h-[480px] overflow-y-auto">
        {rows.length === 0 ? (
          <li className="px-4 py-6 text-sm text-muted italic">No functions match this filter.</li>
        ) : (
          rows.map((fn) => {
            const isOpen = openFn === fn.id;
            const glyph =
              fn.selfDeceivingCount > 0 ? '⚠' :
              fn.untestedCount > 0      ? '🔴' :
              fn.coveredCount === fn.branchCount ? '✅' : '•';
            const tone =
              fn.selfDeceivingCount > 0 ? 'text-coral' :
              fn.untestedCount > 0      ? 'text-rust' :
              fn.coveredCount === fn.branchCount ? 'text-forest' : 'text-muted';
            return (
              <li key={fn.id} className="text-sm">
                <button
                  type="button"
                  onClick={() => setOpenFn(isOpen ? null : fn.id)}
                  className="w-full text-left px-4 py-2.5 flex items-start gap-2.5 hover:bg-paper transition-colors"
                  data-testid={`zerou-branch-fn-${fn.id}`}
                >
                  <span className={`text-base leading-tight ${tone} flex-shrink-0`}>{glyph}</span>
                  <span className="flex-1 min-w-0">
                    <div className="text-ink truncate font-mono text-xs">
                      <span className="text-muted/70">{fn.file}</span>
                      <span className="text-muted/40 mx-1">·</span>
                      <span className="text-ink">{fn.name}</span>
                    </div>
                    <div className="text-[10px] text-muted/70 font-mono mt-0.5 flex gap-3">
                      <span>L{fn.line}</span>
                      <span>
                        branches{' '}
                        <span className="text-forest">{fn.coveredCount}</span>
                        <span className="text-muted/40">/</span>
                        <span>{fn.branchCount}</span>
                      </span>
                      {fn.selfDeceivingCount > 0 && (
                        <span className="text-coral">{fn.selfDeceivingCount} self-deceiving</span>
                      )}
                      {fn.untestedCount > 0 && (
                        <span className="text-rust">{fn.untestedCount} untested</span>
                      )}
                      {fn.associatedSpecs.length > 0 && (
                        <span className="text-muted">{fn.associatedSpecs.length} spec{fn.associatedSpecs.length === 1 ? '' : 's'}</span>
                      )}
                    </div>
                  </span>
                  <span className="text-xs text-muted/60" aria-hidden="true">{isOpen ? '▾' : '›'}</span>
                </button>
                {isOpen && (
                  <div className="bg-paper border-t border-warmline px-6 py-3 anim-drift-in">
                    <pre className="font-mono text-[11px] text-ink whitespace-pre leading-relaxed overflow-x-auto">
                      {renderAsciiTree(fn.root, '')}
                    </pre>
                    {fn.associatedSpecs.length > 0 && (
                      <div className="mt-3 pt-2 border-t border-warmline/60">
                        <div className="text-[10px] uppercase tracking-wider text-muted/70 mb-1">Associated specs</div>
                        <ul className="text-xs space-y-0.5">
                          {fn.associatedSpecs.map((sp) => (
                            <li key={sp.specId} className="font-mono">
                              <span className={`mr-2 ${sp.status === 'pass' ? 'text-forest' : 'text-coral'}`}>
                                {sp.status}
                              </span>
                              <span className="text-ink">{sp.specName}</span>
                              <span className="text-muted/60 ml-2">[{sp.category}]</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })
        )}
      </ul>
    </section>
  );
}

function renderAsciiTree(node: BranchNode, indent: string): string {
  const lines: string[] = [];
  const glyph = VERDICT_GLYPH[node.verdict];
  const badges: string[] = [];
  if (node.ast.present) badges.push('AST');
  if (node.specMatches.length > 0) badges.push(`SPEC×${node.specMatches.length}`);
  if (node.judgeEvidence.length > 0) badges.push(`JUDGE×${node.judgeEvidence.length}`);
  if (node.runtimeCoverage.branchHit !== null) {
    badges.push(`RUN ${node.runtimeCoverage.linesCovered}/${node.runtimeCoverage.linesTotal}`);
  }
  lines.push(
    `${indent}${glyph} ${node.label}  ` +
      `${badges.length > 0 ? `[${badges.join(' · ')}]` : ''}`
  );
  node.children.forEach((c, i) => {
    const last = i === node.children.length - 1;
    const childIndent = `${indent}${last ? '  ' : '│ '}`;
    const head = `${indent}${last ? '└─' : '├─'}`;
    const childTreeFirst = renderAsciiTree(c, '').split('\n');
    childTreeFirst.forEach((line, idx) => {
      if (idx === 0) lines.push(`${head}${line}`);
      else lines.push(`${childIndent}${line}`);
    });
  });
  return lines.join('\n');
}

// Export VERDICT_TONE for any consumer that wants to color summary chips.
// (Currently unused outside this file but keeps shape stable for future
// integrations — e.g. a sibling panel that highlights covered/untested counts.)
export const ZEROU_VERDICT_TONE = VERDICT_TONE;
