import { useMemo, useState } from 'react';
import type { ReviewFinding } from '../types-zerou.js';

const SEVERITY_ORDER: ReviewFinding['severity'][] = ['P1', 'P2', 'P3'];

const SEVERITY_PILL: Record<ReviewFinding['severity'], string> = {
  P1: 'bg-rust/15 text-rust',
  P2: 'bg-coralsoft text-coral',
  P3: 'bg-warmline/60 text-muted',
};

const STATUS_GLYPH: Record<ReviewFinding['status'], { glyph: string; tone: string; label: string }> = {
  patched:   { glyph: '●', tone: 'text-forest', label: 'patched' },
  unpatched: { glyph: '○', tone: 'text-coral',  label: 'unpatched' },
  skipped:   { glyph: '—', tone: 'text-muted',  label: 'skipped' },
  failed:    { glyph: '✗', tone: 'text-rust',   label: 'failed' },
};

export function ZerouFindingsList({ findings }: { findings: ReviewFinding[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const m = new Map<ReviewFinding['severity'], ReviewFinding[]>();
    for (const s of SEVERITY_ORDER) m.set(s, []);
    for (const f of findings) m.get(f.severity)?.push(f);
    return m;
  }, [findings]);

  if (findings.length === 0) {
    return (
      <div className="card p-6 text-sm text-muted italic font-serif" data-testid="zerou-findings-list">
        No findings — clean run.
      </div>
    );
  }

  return (
    <section className="card overflow-hidden" data-testid="zerou-findings-list">
      <div className="card-header flex items-center justify-between">
        <span>Findings</span>
        <span className="text-xs font-sans text-muted">{findings.length}</span>
      </div>
      <div>
        {SEVERITY_ORDER.map((sev) => {
          const rows = grouped.get(sev) ?? [];
          if (rows.length === 0) return null;
          const patched = rows.filter((r) => r.status === 'patched').length;
          return (
            <div key={sev} data-testid={`zerou-findings-group-${sev}`}>
              <div className="px-4 py-1.5 bg-paper text-[10px] uppercase tracking-wider font-medium flex items-center justify-between">
                <span className={`${sev === 'P1' ? 'text-rust' : sev === 'P2' ? 'text-coral' : 'text-muted'}`}>
                  {sev} · {rows.length}
                </span>
                <span className="text-muted/70 font-mono">
                  {patched}/{rows.length} patched
                </span>
              </div>
              <ul className="divide-y divide-warmline">
                {rows.map((f) => {
                  const statusMeta = STATUS_GLYPH[f.status];
                  const isOpen = expanded === f.id;
                  return (
                    <li key={f.id} className="px-4 py-2.5 text-sm">
                      <button
                        type="button"
                        onClick={() => setExpanded(isOpen ? null : f.id)}
                        className="w-full text-left flex items-start gap-2.5 hover:text-coral transition-colors"
                        data-testid={`zerou-finding-row-${f.id}`}
                      >
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-medium flex-shrink-0 ${SEVERITY_PILL[f.severity]}`}
                        >
                          {f.severity}
                        </span>
                        <span
                          className={`flex-shrink-0 text-base leading-tight ${statusMeta.tone}`}
                          aria-label={statusMeta.label}
                        >
                          {statusMeta.glyph}
                        </span>
                        <span className="flex-1 min-w-0">
                          <div className="text-ink truncate">{f.message}</div>
                          <div className="text-[10px] text-muted/70 font-mono mt-0.5 truncate">
                            {f.file}:{f.line} · {f.category} · {f.source}
                          </div>
                        </span>
                      </button>
                      {isOpen && (
                        <div className="mt-2 pl-9 text-xs text-muted space-y-1.5 border-l-2 border-warmline ml-3 pl-3 anim-drift-in">
                          {f.expectedBehavior && (
                            <div>
                              <span className="text-muted/60 uppercase text-[10px] tracking-wider mr-1">expected</span>
                              <span className="text-ink">{f.expectedBehavior}</span>
                            </div>
                          )}
                          {f.actualBehavior && (
                            <div>
                              <span className="text-muted/60 uppercase text-[10px] tracking-wider mr-1">actual</span>
                              <span className="text-coral">{f.actualBehavior}</span>
                            </div>
                          )}
                          {f.snippet && (
                            <pre className="bg-paper border border-warmline rounded-md p-2 mt-1 font-mono text-[11px] text-ink whitespace-pre-wrap break-all">
                              {f.snippet}
                            </pre>
                          )}
                          {f.reason && (
                            <div>
                              <span className="text-muted/60 uppercase text-[10px] tracking-wider mr-1">reason</span>
                              <span className="italic">{f.reason}</span>
                            </div>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}
