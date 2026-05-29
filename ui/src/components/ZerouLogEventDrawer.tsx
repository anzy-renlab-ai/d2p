import { useMemo } from 'react';
import type { BranchTraceEvent } from '../types-zerou.js';

/**
 * Side drawer that exposes one `branch.evidence` event as raw JSON, plus
 * its hash-chain neighbours. This is the "I can prove it" surface — the
 * user sees the exact line that lives in .zerou/branch-trace.jsonl and the
 * sha256 link to the event before/after.
 */

export interface ZerouLogEventDrawerProps {
  event: BranchTraceEvent;
  /** Optional — previous + next events for the hash-chain context block. */
  prevEvent?: BranchTraceEvent | null;
  nextEvent?: BranchTraceEvent | null;
  onClose: () => void;
}

export function ZerouLogEventDrawer({
  event,
  prevEvent,
  nextEvent,
  onClose,
}: ZerouLogEventDrawerProps) {
  const rawJson = useMemo(() => JSON.stringify(event, null, 2), [event]);
  const oneLineJson = useMemo(() => JSON.stringify(event), [event]);

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // jsdom / blocked clipboard — fall back silently
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex anim-drift-in"
      onClick={onClose}
      data-testid="zerou-log-event-drawer"
    >
      <div className="flex-1 bg-ink/30" />
      <div
        className="bg-paper border-l border-warmline w-[640px] max-w-[92vw] flex flex-col shadow-xl anim-drawer-right"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-5 py-3 border-b border-warmline bg-cream flex-shrink-0">
          <span className="font-mono text-xs text-coral uppercase tracking-wider">
            branch.evidence
          </span>
          <span className="text-xs font-mono text-muted flex-1 truncate" title={event.branch_id}>
            {event.branch_id}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-muted hover:text-ink transition-colors ml-2 px-2 py-1 rounded hover:bg-paper"
            aria-label="close drawer"
            data-testid="zerou-log-event-drawer-close"
          >
            收起 ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4 text-sm">
          <div className="grid grid-cols-2 gap-2 text-xs font-mono">
            <KV label="VERDICT" value={event.verdict} tone={verdictTone(event.verdict)} />
            <KV label="SEQ" value={`#${event.seq}`} />
            <KV label="FUNCTION" value={event['code.function']} mono />
            <KV label="LINE" value={`${event.line_start}..${event.line_end}`} />
            <KV label="TRACE" value={event.trace_id} mono trunc />
            <KV label="SPAN" value={event.span_id ?? '—'} mono trunc />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <div className="text-[10px] uppercase tracking-wider text-muted/70 font-medium">
                Raw event (one line · jsonl)
              </div>
              <button
                type="button"
                onClick={() => copy(oneLineJson)}
                className="text-[10px] text-muted hover:text-coral transition-colors"
                data-testid="zerou-log-event-copy-jsonl"
              >
                copy line
              </button>
            </div>
            <pre
              className="bg-cream border border-warmline rounded p-2.5 text-[10px] font-mono text-ink whitespace-pre-wrap break-all max-h-24 overflow-y-auto"
              data-testid="zerou-log-event-jsonl"
            >
              {oneLineJson}
            </pre>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <div className="text-[10px] uppercase tracking-wider text-muted/70 font-medium">
                Raw event (pretty)
              </div>
              <button
                type="button"
                onClick={() => copy(rawJson)}
                className="text-[10px] text-muted hover:text-coral transition-colors"
                data-testid="zerou-log-event-copy-pretty"
              >
                copy pretty
              </button>
            </div>
            <pre
              className="bg-cream border border-warmline rounded p-3 text-[11px] font-mono text-ink whitespace-pre overflow-x-auto leading-relaxed"
              data-testid="zerou-log-event-pretty"
            >
              {rawJson}
            </pre>
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted/70 font-medium mb-1.5">
              Hash chain
            </div>
            <ul className="space-y-1 text-[10px] font-mono">
              <li className="flex items-start gap-2">
                <span className="text-muted/60 w-12 flex-shrink-0">prev</span>
                <span className="break-all text-muted">
                  {prevEvent ? `#${prevEvent.seq}` : 'genesis'}
                </span>
                <span className="break-all text-muted/60">{event.prev_hash}</span>
              </li>
              <li className="flex items-start gap-2 bg-coralsoft/40 rounded px-1.5 py-1 -mx-1.5">
                <span className="text-coral w-12 flex-shrink-0">this</span>
                <span className="text-coral flex-shrink-0">#{event.seq}</span>
                <span className="break-all text-ink font-medium">{event.hash}</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-muted/60 w-12 flex-shrink-0">next</span>
                <span className="break-all text-muted">
                  {nextEvent ? `#${nextEvent.seq}` : '— end —'}
                </span>
                <span className="break-all text-muted/60">{nextEvent?.prev_hash ?? ''}</span>
              </li>
            </ul>
            <div className="text-[10px] text-muted/70 mt-2 font-mono">
              cat .zerou/branch-trace.jsonl | jq -c 'select(.seq=={event.seq})' — verify
              hash with: sha256(JSON.stringify(&#123;...event, hash:undefined&#125;))
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function verdictTone(v: BranchTraceEvent['verdict']): string {
  switch (v) {
    case 'covered':
    case 'run-only':
      return 'text-forest';
    case 'judge-only':
    case 'spec-only':
      return 'text-coral';
    case 'untested':
      return 'text-rust';
    default:
      return 'text-muted';
  }
}

function KV({
  label,
  value,
  tone,
  mono,
  trunc,
}: {
  label: string;
  value: string;
  tone?: string;
  mono?: boolean;
  trunc?: boolean;
}) {
  return (
    <div className="bg-cream border border-warmline rounded px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-widest text-muted/70 font-sans">{label}</div>
      <div
        className={`${tone ?? 'text-ink'} ${mono ? 'font-mono' : ''} ${
          trunc ? 'truncate' : ''
        } text-[11px]`}
        title={trunc ? value : undefined}
      >
        {value}
      </div>
    </div>
  );
}
