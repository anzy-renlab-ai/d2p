import { useEffect, useMemo, useRef, useState } from 'react';
import type { BranchTraceEvent, BranchNode } from '../types-zerou.js';
import { ZerouLogEventDrawer } from './ZerouLogEventDrawer.js';

/**
 * The centerpiece of stage ⑤ — project tree on the left, branch-trace log
 * stream on the right. Each leaf in the tree is a real branch_id from
 * .zerou/branch-trace.jsonl. Each event in the stream is the same
 * branch_id, plus its full proof envelope.
 *
 * Design rules:
 *   - Tree is built from grouping events by `code.file.path` → `code.function`
 *     → branch_id. We do NOT trust the BranchNode children tree for this —
 *     it's the events that are the proof, so the tree is derived from events.
 *   - Click on a tree node = filter the stream to that node's subtree.
 *   - Click on a stream event = open ZerouLogEventDrawer with raw JSON.
 *   - Newly-arrived events whose branch_id matches a leaf flash the leaf
 *     green for ~1.5s (anim-pulse-green).
 */

export type VerdictFilter = 'all' | 'covered' | 'judge-only' | 'untested';

export interface ZerouBranchTreeLogProps {
  events: BranchTraceEvent[];
  /** True when worker C's stream hook is hooked up + receiving events. */
  liveConnected?: boolean;
  /** Optional baseline length — events at index >= this count are "live".
   *  Live events animate when they appear; static events do not. */
  staticEventCount?: number;
}

interface TreeFn {
  fn: string;
  fnLine: number;
  events: BranchTraceEvent[]; // events for this function, in seq order
  worst: BranchTraceEvent['verdict']; // worst leaf verdict (drives glyph)
}

interface TreeFile {
  file: string;
  fns: TreeFn[];
  worst: BranchTraceEvent['verdict'];
}

interface TreeDir {
  name: string; // last segment (e.g. "login")
  fullPath: string; // full posix path so far (e.g. "app/api/login")
  files: TreeFile[];
  subdirs: TreeDir[];
  worst: BranchTraceEvent['verdict'];
}

const VERDICT_RANK: Record<BranchTraceEvent['verdict'], number> = {
  untested: 5,
  unknown: 4,
  'spec-only': 3,
  'judge-only': 2,
  'run-only': 1,
  covered: 0,
};

const VERDICT_GLYPH: Record<BranchTraceEvent['verdict'], string> = {
  covered: '✓',
  'run-only': '✓',
  'judge-only': '⚠',
  'spec-only': '⚠',
  untested: '🔴',
  unknown: '✗',
};

const VERDICT_TONE: Record<BranchTraceEvent['verdict'], string> = {
  covered: 'text-forest',
  'run-only': 'text-forest',
  'judge-only': 'text-coral',
  'spec-only': 'text-coral',
  untested: 'text-rust',
  unknown: 'text-muted',
};

function worstOf(a: BranchTraceEvent['verdict'], b: BranchTraceEvent['verdict']): BranchTraceEvent['verdict'] {
  return VERDICT_RANK[a] >= VERDICT_RANK[b] ? a : b;
}

function buildTree(events: BranchTraceEvent[]): TreeDir {
  // Group events: file → fn → leaves
  const fileMap = new Map<string, Map<string, { fnLine: number; events: BranchTraceEvent[] }>>();
  for (const ev of events) {
    const file = ev['code.file.path'];
    const fn = ev['code.function'];
    let f = fileMap.get(file);
    if (!f) { f = new Map(); fileMap.set(file, f); }
    let g = f.get(fn);
    if (!g) { g = { fnLine: ev['code.line.number'], events: [] }; f.set(fn, g); }
    g.events.push(ev);
  }

  // Build TreeFile[]
  const fileNodes: TreeFile[] = [];
  for (const [file, fns] of fileMap.entries()) {
    const treeFns: TreeFn[] = [];
    let fileWorst: BranchTraceEvent['verdict'] = 'covered';
    for (const [fnName, group] of fns.entries()) {
      let worst: BranchTraceEvent['verdict'] = 'covered';
      for (const ev of group.events) worst = worstOf(worst, ev.verdict);
      fileWorst = worstOf(fileWorst, worst);
      treeFns.push({ fn: fnName, fnLine: group.fnLine, events: group.events, worst });
    }
    treeFns.sort((a, b) => a.fnLine - b.fnLine || a.fn.localeCompare(b.fn));
    fileNodes.push({ file, fns: treeFns, worst: fileWorst });
  }
  fileNodes.sort((a, b) => a.file.localeCompare(b.file));

  // Build directory tree from file paths.
  const root: TreeDir = { name: '', fullPath: '', files: [], subdirs: [], worst: 'covered' };
  for (const fileNode of fileNodes) {
    const segs = fileNode.file.split(/[\\/]/);
    const fileName = segs.pop()!;
    let cursor = root;
    let acc = '';
    for (const seg of segs) {
      acc = acc ? `${acc}/${seg}` : seg;
      let sub = cursor.subdirs.find((s) => s.name === seg);
      if (!sub) {
        sub = { name: seg, fullPath: acc, files: [], subdirs: [], worst: 'covered' };
        cursor.subdirs.push(sub);
      }
      cursor = sub;
    }
    cursor.files.push({ ...fileNode, file: fileName });
    // bubble worst up
    let walk: TreeDir | null = cursor;
    while (walk) {
      walk.worst = worstOf(walk.worst, fileNode.worst);
      walk = null; // root has no parent ref — single-pass bubble done above isn't enough; we'll fix below.
    }
  }

  // Second pass — bubble worst from leaves up properly.
  const bubble = (d: TreeDir): BranchTraceEvent['verdict'] => {
    let w: BranchTraceEvent['verdict'] = 'covered';
    for (const f of d.files) w = worstOf(w, f.worst);
    for (const s of d.subdirs) w = worstOf(w, bubble(s));
    d.worst = w;
    return w;
  };
  bubble(root);

  return root;
}

export function ZerouBranchTreeLog({
  events,
  liveConnected,
  staticEventCount,
}: ZerouBranchTreeLogProps) {
  const [verdictFilter, setVerdictFilter] = useState<VerdictFilter>('all');
  const [search, setSearch] = useState('');
  const [activeBranchIds, setActiveBranchIds] = useState<Set<string> | null>(null);
  const [activeFilterLabel, setActiveFilterLabel] = useState<string>('all');
  const [openPath, setOpenPath] = useState<Set<string>>(new Set(['', 'app', 'app/api']));
  const [drawerSeq, setDrawerSeq] = useState<number | null>(null);

  const tree = useMemo(() => buildTree(events), [events]);

  // Track which branch_ids are "new live" — animate the matching leaf.
  const baseline = staticEventCount ?? events.length;
  const liveBranchIds = useMemo(() => {
    if (baseline >= events.length) return new Set<string>();
    const s = new Set<string>();
    for (let i = baseline; i < events.length; i++) s.add(events[i]!.branch_id);
    return s;
  }, [events, baseline]);

  // Auto-clear the pulse-green class after 1500ms by tracking timestamps.
  const [pulsing, setPulsing] = useState<Set<string>>(new Set());
  const pulseTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    if (liveBranchIds.size === 0) return;
    setPulsing((prev) => {
      const next = new Set(prev);
      for (const id of liveBranchIds) next.add(id);
      return next;
    });
    for (const id of liveBranchIds) {
      const old = pulseTimers.current.get(id);
      if (old) clearTimeout(old);
      const t = setTimeout(() => {
        setPulsing((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        pulseTimers.current.delete(id);
      }, 1500);
      pulseTimers.current.set(id, t);
    }
    // We intentionally read liveBranchIds and re-run only when it changes.
  }, [liveBranchIds]);

  useEffect(() => {
    // Cleanup on unmount.
    return () => {
      for (const t of pulseTimers.current.values()) clearTimeout(t);
      pulseTimers.current.clear();
    };
  }, []);

  // Filtered events for the right-hand stream.
  const filteredEvents = useMemo(() => {
    const q = search.trim().toLowerCase();
    return events.filter((ev) => {
      if (verdictFilter !== 'all') {
        if (verdictFilter === 'covered' && ev.verdict !== 'covered' && ev.verdict !== 'run-only') return false;
        if (verdictFilter === 'judge-only' && ev.verdict !== 'judge-only' && ev.verdict !== 'spec-only') return false;
        if (verdictFilter === 'untested' && ev.verdict !== 'untested') return false;
      }
      if (activeBranchIds && !activeBranchIds.has(ev.branch_id)) return false;
      if (q) {
        const hay = `${ev.branch_id} ${ev['code.function']} ${ev['code.file.path']}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [events, verdictFilter, search, activeBranchIds]);

  const togglePath = (p: string) => {
    setOpenPath((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  };

  const focusOnBranches = (ids: string[], label: string) => {
    setActiveBranchIds(new Set(ids));
    setActiveFilterLabel(label);
  };

  const clearFocus = () => {
    setActiveBranchIds(null);
    setActiveFilterLabel('all');
  };

  const drawerEvent = drawerSeq != null ? events.find((e) => e.seq === drawerSeq) ?? null : null;
  const drawerPrev = drawerEvent ? events.find((e) => e.seq === drawerEvent.seq - 1) ?? null : null;
  const drawerNext = drawerEvent ? events.find((e) => e.seq === drawerEvent.seq + 1) ?? null : null;

  // Stream auto-scrolls to bottom in live mode (when liveConnected).
  const streamRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!liveConnected) return;
    const el = streamRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [filteredEvents.length, liveConnected]);

  return (
    <div
      className="bg-paper border border-warmline rounded-lg overflow-hidden"
      data-testid="zerou-branch-tree-log"
    >
      <div className="flex items-center justify-between px-4 py-2 bg-cream border-b border-warmline gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-xs text-muted">
          {liveConnected ? (
            <>
              <span
                className="inline-block w-2 h-2 rounded-full bg-forest anim-breathe-dot"
                aria-hidden="true"
              />
              <span className="text-forest font-mono">live</span>
            </>
          ) : (
            <>
              <span className="inline-block w-2 h-2 rounded-full bg-muted/40" aria-hidden="true" />
              <span className="font-mono">static</span>
            </>
          )}
          <span className="text-muted/40">·</span>
          <span className="font-mono">{events.length} events</span>
          {activeBranchIds && (
            <>
              <span className="text-muted/40">·</span>
              <span className="text-coral font-mono">filter: {activeFilterLabel}</span>
              <button
                type="button"
                onClick={clearFocus}
                className="text-[10px] text-muted hover:text-coral transition-colors ml-1"
                data-testid="zerou-tree-log-clear-focus"
              >
                ✕ clear
              </button>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="search branch_id / fn / file"
            className="text-xs px-2 py-1 border border-warmline rounded bg-paper text-ink font-mono w-56"
            data-testid="zerou-tree-log-search"
          />
          <VerdictChip label="all" value="all" current={verdictFilter} onChange={setVerdictFilter} />
          <VerdictChip label="✓" value="covered" current={verdictFilter} onChange={setVerdictFilter} />
          <VerdictChip label="⚠" value="judge-only" current={verdictFilter} onChange={setVerdictFilter} />
          <VerdictChip label="🔴" value="untested" current={verdictFilter} onChange={setVerdictFilter} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 divide-x divide-warmline">
        <div
          className="max-h-[640px] overflow-y-auto px-3 py-2 font-mono text-[12px] leading-relaxed"
          data-testid="zerou-tree-log-tree"
        >
          {tree.subdirs.length === 0 && tree.files.length === 0 ? (
            <div className="text-xs text-muted italic py-4 text-center">no branch-trace events</div>
          ) : (
            <TreeView
              dir={tree}
              indent=""
              openPath={openPath}
              togglePath={togglePath}
              focusOnBranches={focusOnBranches}
              activeBranchIds={activeBranchIds}
              pulsing={pulsing}
            />
          )}
        </div>

        <div
          ref={streamRef}
          className="max-h-[640px] overflow-y-auto px-3 py-2 font-mono text-[11px] leading-relaxed bg-paper"
          data-testid="zerou-tree-log-stream"
        >
          {filteredEvents.length === 0 ? (
            <div className="text-xs text-muted italic py-4 text-center">
              {events.length === 0
                ? 'no branch-trace events'
                : 'no events match this filter'}
            </div>
          ) : (
            <ul className="space-y-1.5">
              {filteredEvents.map((ev) => {
                const isLive = liveBranchIds.has(ev.branch_id);
                return (
                  <li
                    key={ev.seq}
                    data-testid={`zerou-tree-log-event-${ev.seq}`}
                    className={`px-2 py-1 rounded border border-transparent hover:border-warmline hover:bg-cream cursor-pointer transition-colors ${
                      isLive ? 'anim-pulse-green' : ''
                    }`}
                    onClick={() => setDrawerSeq(ev.seq)}
                  >
                    <div className="flex items-baseline gap-2">
                      <span className="text-muted/60 flex-shrink-0 text-[10px]">
                        {ev.ts.slice(11, 23)}
                      </span>
                      <span className={`flex-shrink-0 ${VERDICT_TONE[ev.verdict]}`}>
                        {VERDICT_GLYPH[ev.verdict]}
                      </span>
                      <span className="text-ink truncate flex-1" title={ev.branch_id}>
                        {ev['code.function']}@{ev['code.line.number']}:{ev.branch_kind}-
                        {ev.line_start}
                      </span>
                      <span className="text-coral flex-shrink-0 text-[10px]">#{ev.seq}</span>
                    </div>
                    <div className="text-muted/70 text-[10px] truncate pl-[3.5rem]">
                      trace={ev.trace_id.slice(0, 8)}… verdict={ev.verdict}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {drawerEvent && (
        <ZerouLogEventDrawer
          event={drawerEvent}
          prevEvent={drawerPrev}
          nextEvent={drawerNext}
          onClose={() => setDrawerSeq(null)}
        />
      )}
    </div>
  );
}

function TreeView({
  dir,
  indent,
  openPath,
  togglePath,
  focusOnBranches,
  activeBranchIds,
  pulsing,
}: {
  dir: TreeDir;
  indent: string;
  openPath: Set<string>;
  togglePath: (p: string) => void;
  focusOnBranches: (ids: string[], label: string) => void;
  activeBranchIds: Set<string> | null;
  pulsing: Set<string>;
}) {
  // Render this dir's children (subdirs first, then files). Indent uses
  // box-drawing characters for the ASCII-art feel.
  const items: Array<{ kind: 'dir'; d: TreeDir } | { kind: 'file'; f: TreeFile }> = [
    ...dir.subdirs.map((d) => ({ kind: 'dir' as const, d })),
    ...dir.files.map((f) => ({ kind: 'file' as const, f })),
  ];

  return (
    <ul className="list-none">
      {items.map((item, idx) => {
        const last = idx === items.length - 1;
        const glyph = last ? '└─' : '├─';
        const childIndent = `${indent}${last ? '   ' : '│  '}`;

        if (item.kind === 'dir') {
          const isOpen = openPath.has(item.d.fullPath);
          const allBranchIds = collectBranchIdsForDir(item.d);
          return (
            <li key={`d-${item.d.fullPath}`}>
              <div
                className="flex items-baseline gap-1 hover:bg-cream rounded px-1 cursor-pointer"
                data-testid={`zerou-tree-log-dir-${item.d.fullPath.replace(/[\\/]/g, '-') || 'root'}`}
              >
                <span className="text-muted/70 whitespace-pre">{indent}{glyph} </span>
                <button
                  type="button"
                  onClick={() => togglePath(item.d.fullPath)}
                  className="text-muted hover:text-ink text-[10px] flex-shrink-0"
                  aria-label={isOpen ? 'collapse' : 'expand'}
                >
                  {isOpen ? '▾' : '▸'}
                </button>
                <button
                  type="button"
                  onClick={() => focusOnBranches(allBranchIds, `${item.d.fullPath}/`)}
                  className="text-ink hover:text-coral transition-colors text-left flex-1 truncate"
                >
                  {item.d.name}/
                </button>
                <span
                  className={`text-[10px] ${VERDICT_TONE[item.d.worst]} flex-shrink-0 ml-1`}
                  aria-label={item.d.worst}
                >
                  {VERDICT_GLYPH[item.d.worst]}
                </span>
              </div>
              {isOpen && (
                <TreeView
                  dir={item.d}
                  indent={childIndent}
                  openPath={openPath}
                  togglePath={togglePath}
                  focusOnBranches={focusOnBranches}
                  activeBranchIds={activeBranchIds}
                  pulsing={pulsing}
                />
              )}
            </li>
          );
        }

        const f = item.f;
        const fileKey = `f-${f.file}-${idx}`;
        const fileIsOpen = openPath.has(`${dir.fullPath}::${f.file}`);
        const fileBranchIds = f.fns.flatMap((fn) => fn.events.map((e) => e.branch_id));
        return (
          <li key={fileKey}>
            <div
              className="flex items-baseline gap-1 hover:bg-cream rounded px-1 cursor-pointer"
              data-testid={`zerou-tree-log-file-${f.file.replace(/[\\/.]/g, '-')}`}
            >
              <span className="text-muted/70 whitespace-pre">{indent}{glyph} </span>
              <button
                type="button"
                onClick={() => togglePath(`${dir.fullPath}::${f.file}`)}
                className="text-muted hover:text-ink text-[10px] flex-shrink-0"
              >
                {fileIsOpen ? '▾' : '▸'}
              </button>
              <button
                type="button"
                onClick={() => focusOnBranches(fileBranchIds, f.file)}
                className="text-ink hover:text-coral transition-colors text-left flex-1 truncate"
              >
                {f.file}
              </button>
              <span
                className={`text-[10px] ${VERDICT_TONE[f.worst]} flex-shrink-0 ml-1`}
                aria-label={f.worst}
              >
                {VERDICT_GLYPH[f.worst]}
              </span>
            </div>
            {fileIsOpen && (
              <ul className="list-none">
                {f.fns.map((fn, fIdx) => {
                  const lastFn = fIdx === f.fns.length - 1;
                  const fnGlyph = lastFn ? '└─' : '├─';
                  const fnChildIndent = `${childIndent}${lastFn ? '   ' : '│  '}`;
                  const fnOpen = openPath.has(`${dir.fullPath}::${f.file}::${fn.fn}`);
                  return (
                    <li key={`fn-${fn.fn}-${fIdx}`}>
                      <div
                        className="flex items-baseline gap-1 hover:bg-cream rounded px-1"
                        data-testid={`zerou-tree-log-fn-${fn.fn}`}
                      >
                        <span className="text-muted/70 whitespace-pre">{childIndent}{fnGlyph} </span>
                        <button
                          type="button"
                          onClick={() => togglePath(`${dir.fullPath}::${f.file}::${fn.fn}`)}
                          className="text-muted hover:text-ink text-[10px] flex-shrink-0"
                        >
                          {fnOpen ? '▾' : '▸'}
                        </button>
                        <button
                          type="button"
                          onClick={() => focusOnBranches(fn.events.map((e) => e.branch_id), `${fn.fn}()`)}
                          className="text-coral hover:text-coralhover transition-colors text-left flex-1 truncate"
                        >
                          {fn.fn}@{fn.fnLine}()
                        </button>
                        <span
                          className={`text-[10px] ${VERDICT_TONE[fn.worst]} flex-shrink-0 ml-1`}
                          aria-label={fn.worst}
                        >
                          {VERDICT_GLYPH[fn.worst]}
                        </span>
                      </div>
                      {fnOpen && (
                        <ul className="list-none">
                          {fn.events.map((ev, eIdx) => {
                            const lastEv = eIdx === fn.events.length - 1;
                            const evGlyph = lastEv ? '└─' : '├─';
                            const isActive = activeBranchIds?.has(ev.branch_id);
                            const isPulsing = pulsing.has(ev.branch_id);
                            return (
                              <li
                                key={`ev-${ev.seq}`}
                                className={`flex items-baseline gap-1 rounded px-1 ${
                                  isActive ? 'bg-coralsoft/40' : ''
                                } ${isPulsing ? 'anim-pulse-green' : ''}`}
                                data-testid={`zerou-tree-log-leaf-${ev.seq}`}
                              >
                                <span className="text-muted/70 whitespace-pre">{fnChildIndent}{evGlyph} </span>
                                <button
                                  type="button"
                                  onClick={() => focusOnBranches([ev.branch_id], ev.branch_label)}
                                  className={`text-left flex-1 truncate ${VERDICT_TONE[ev.verdict]} hover:underline`}
                                  title={ev.branch_id}
                                >
                                  {ev.branch_label}
                                </button>
                                <span
                                  className={`text-[10px] ${VERDICT_TONE[ev.verdict]} flex-shrink-0`}
                                  aria-label={ev.verdict}
                                >
                                  {VERDICT_GLYPH[ev.verdict]}
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function collectBranchIdsForDir(dir: TreeDir): string[] {
  const out: string[] = [];
  for (const f of dir.files) for (const fn of f.fns) for (const ev of fn.events) out.push(ev.branch_id);
  for (const s of dir.subdirs) out.push(...collectBranchIdsForDir(s));
  return out;
}

function VerdictChip({
  label,
  value,
  current,
  onChange,
}: {
  label: string;
  value: VerdictFilter;
  current: VerdictFilter;
  onChange: (v: VerdictFilter) => void;
}) {
  const active = current === value;
  return (
    <button
      type="button"
      onClick={() => onChange(value)}
      data-testid={`zerou-tree-log-verdict-chip-${value}`}
      className={`px-2 py-0.5 text-[11px] rounded-full font-mono border transition-colors ${
        active
          ? 'bg-coral text-cream border-coral'
          : 'bg-cream text-muted border-warmline hover:border-coral hover:text-coral'
      }`}
      aria-pressed={active}
    >
      {label}
    </button>
  );
}

// BranchNode is imported but only used for ergonomic types in tests — keep
// it referenced so unused-import lint doesn't fire.
export type { BranchNode };
