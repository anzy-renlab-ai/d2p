import { useState, useEffect, useRef } from 'react';
import type { SseEnvelope } from '../types.js';
import { useStore } from '../store.js';

const KIND_LABEL: Record<string, { label: string; color: string }> = {
  SESSION_STARTED: { label: '会话开始', color: 'text-slate-700' },
  VISION_QUESTION_ASKED: { label: 'vision 提问', color: 'text-slate-500' },
  VISION_ANSWERED: { label: 'vision 回答', color: 'text-slate-500' },
  VISION_FINALIZED: { label: 'vision 定稿', color: 'text-slate-700' },
  TYPE_DETECTED: { label: '识别类型', color: 'text-slate-700' },
  PRESET_CHOSEN: { label: 'preset 选定', color: 'text-slate-700' },
  DIFF_PRODUCED: { label: '生成 gap', color: 'text-blue-700' },
  GAP_PICKED: { label: '挑 gap', color: 'text-blue-700 font-medium' },
  WORKTREE_CREATED: { label: '建 worktree', color: 'text-slate-600' },
  AGENT_START: { label: 'agent 起', color: 'text-slate-500' },
  AGENT_END: { label: 'agent 收', color: 'text-slate-400' },
  STATIC_GATE_PASSED: { label: '静态门 ✓', color: 'text-green-600' },
  STATIC_GATE_FAILED: { label: '静态门 ✗', color: 'text-amber-700' },
  ALIGNMENT_RESULT: { label: 'alignment', color: 'text-slate-600' },
  REVIEW_VERDICT: { label: 'review', color: 'text-slate-700' },
  ADVERSARIAL_RESULT: { label: '对抗审', color: 'text-slate-700' },
  FIX_COMMITTED: { label: '提 commit', color: 'text-green-700' },
  FIX_DROPPED: { label: '丢 fix', color: 'text-red-600' },
  MERGED: { label: '合并 ✓', color: 'text-green-700 font-medium' },
  GAP_DONE: { label: 'gap 完成', color: 'text-green-700 font-medium' },
  GAP_SKIPPED: { label: 'gap 跳过', color: 'text-slate-500' },
  GAP_ESCALATED: { label: 'gap 升级', color: 'text-amber-700' },
  LOOP_STARTED: { label: '主循环起', color: 'text-blue-700 font-medium' },
  LOOP_PAUSED: { label: '主循环停', color: 'text-amber-700' },
  LOOP_RESUMED: { label: '主循环续', color: 'text-blue-700' },
  DONE_CHECK_RESULT: { label: '终评', color: 'text-purple-700' },
  SESSION_DONE: { label: '会话达标 🎉', color: 'text-green-700 font-bold' },
  SESSION_ENDED: { label: '会话结束', color: 'text-slate-600' },
  SESSION_CRASH_RECOVERED: { label: '崩溃恢复', color: 'text-amber-700' },
  ERROR: { label: '错误', color: 'text-red-600' },
};

function fmtTime(ts: number): string {
  const d = new Date(ts);
  return d.toISOString().slice(11, 19);
}

function summary(e: SseEnvelope): string {
  const p = e.payload as Record<string, unknown>;
  if (e.kind === 'GAP_PICKED' || e.kind === 'GAP_DONE' || e.kind === 'GAP_SKIPPED') {
    return String(p.slug ?? '');
  }
  if (e.kind === 'TYPE_DETECTED') return `${p.type} (${Number(p.confidence ?? 0).toFixed(2)})`;
  if (e.kind === 'PRESET_CHOSEN') return String(p.type ?? '');
  if (e.kind === 'DIFF_PRODUCED') return `+${p.inserted ?? 0} gaps`;
  if (e.kind === 'AGENT_START' || e.kind === 'AGENT_END') {
    return `${p.role ?? ''}${p.model ? `/${p.model}` : ''}${p.thought ? ' — ' + p.thought : ''}`;
  }
  if (e.kind === 'ALIGNMENT_RESULT') return `score ${Number(p.score ?? 0).toFixed(2)}`;
  if (e.kind === 'REVIEW_VERDICT') return `${p.verdict} (${p.reasonCode})`;
  if (e.kind === 'FIX_COMMITTED' || e.kind === 'MERGED') {
    const sha = String(p.commitSha ?? p.mergeSha ?? '');
    return sha.slice(0, 7);
  }
  if (e.kind === 'GAP_ESCALATED' || e.kind === 'LOOP_PAUSED') return String(p.reason ?? '');
  if (e.kind === 'DONE_CHECK_RESULT') return p.visionSatisfied ? '✓ 满足' : '× 未满足';
  if (e.kind === 'ERROR') return String(p.message ?? '');
  return '';
}

export function RunLog() {
  const events = useStore((s) => s.events);
  const sse = useStore((s) => s.sseConnected);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [filter, setFilter] = useState<'all' | 'milestones'>('all');
  const scrollRef = useRef<HTMLDivElement>(null);
  const autoScroll = useRef(true);

  useEffect(() => {
    if (autoScroll.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events.length]);

  const MILESTONES = new Set([
    'TYPE_DETECTED',
    'PRESET_CHOSEN',
    'VISION_FINALIZED',
    'DIFF_PRODUCED',
    'GAP_PICKED',
    'GAP_DONE',
    'GAP_SKIPPED',
    'GAP_ESCALATED',
    'STATIC_GATE_FAILED',
    'REVIEW_VERDICT',
    'MERGED',
    'LOOP_PAUSED',
    'LOOP_RESUMED',
    'DONE_CHECK_RESULT',
    'SESSION_DONE',
    'SESSION_ENDED',
    'ERROR',
  ]);

  const filtered = filter === 'milestones' ? events.filter((e) => MILESTONES.has(e.kind)) : events;

  function toggle(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    autoScroll.current = false;
  }

  return (
    <div className="bg-white rounded border flex flex-col h-full">
      <div className="px-3 py-2 border-b bg-slate-50 text-sm font-medium flex items-center justify-between">
        <span>
          Live Run Log <span className="text-slate-500">({filtered.length})</span>
          {!sse && <span className="ml-2 text-amber-600 text-xs">(streaming offline)</span>}
        </span>
        <div className="flex gap-1">
          <button
            onClick={() => setFilter('all')}
            className={`text-xs px-2 py-0.5 rounded ${filter === 'all' ? 'bg-brand text-white' : 'text-slate-600 hover:bg-slate-200'}`}
          >
            全部
          </button>
          <button
            onClick={() => setFilter('milestones')}
            className={`text-xs px-2 py-0.5 rounded ${filter === 'milestones' ? 'bg-brand text-white' : 'text-slate-600 hover:bg-slate-200'}`}
          >
            里程碑
          </button>
        </div>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto" onWheel={() => (autoScroll.current = false)}>
        {filtered.length === 0 ? (
          <div className="p-4 text-slate-500 text-sm">还没有事件…</div>
        ) : (
          <ul className="divide-y text-sm font-mono">
            {filtered.map((e) => {
              const meta = KIND_LABEL[e.kind] ?? { label: e.kind, color: 'text-slate-600' };
              return (
                <li key={e.id} className="px-3 py-1.5">
                  <button onClick={() => toggle(e.id)} className="w-full text-left flex gap-2 items-start hover:bg-slate-50">
                    <span className="text-slate-400 text-xs">{fmtTime(e.ts)}</span>
                    <span className={`text-xs ${meta.color}`}>{meta.label}</span>
                    <span className="flex-1 text-xs text-slate-600 truncate">{summary(e)}</span>
                  </button>
                  {expanded.has(e.id) && (
                    <pre className="mt-1 text-xs bg-slate-50 p-2 rounded overflow-x-auto">
                      {JSON.stringify(e.payload, null, 2)}
                    </pre>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
