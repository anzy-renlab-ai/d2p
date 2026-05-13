import { useState } from 'react';
import type { Gap, GapStatus } from '../types.js';
import { useStore } from '../store.js';
import { Button } from './Button.js';

const STATUS_LABEL: Record<GapStatus, string> = {
  PENDING: '待处理',
  IN_PROGRESS: '处理中',
  DONE: '完成',
  SKIPPED: '跳过',
  NEED_HUMAN: '需人工',
  SPLIT_DONE: '已拆分',
};

const STATUS_COLOR: Record<GapStatus, string> = {
  PENDING: 'text-slate-600',
  IN_PROGRESS: 'text-blue-600 font-semibold',
  DONE: 'text-green-600',
  SKIPPED: 'text-slate-400 line-through',
  NEED_HUMAN: 'text-amber-700',
  SPLIT_DONE: 'text-purple-600',
};

const STATUS_ORDER: GapStatus[] = ['IN_PROGRESS', 'PENDING', 'NEED_HUMAN', 'DONE', 'SKIPPED', 'SPLIT_DONE'];

function group(gaps: Gap[]): Map<GapStatus, Gap[]> {
  const m = new Map<GapStatus, Gap[]>();
  for (const s of STATUS_ORDER) m.set(s, []);
  for (const g of gaps) m.get(g.status)?.push(g);
  return m;
}

export function GapList() {
  const gaps = useStore((s) => s.gaps);
  const skipGap = useStore((s) => s.skipGap);
  const [expanded, setExpanded] = useState<number | null>(null);

  const grouped = group(gaps);

  return (
    <div className="bg-white rounded border overflow-hidden">
      <div className="px-3 py-2 border-b bg-slate-50 text-sm font-medium">
        Gap 队列 <span className="text-slate-500">({gaps.length})</span>
      </div>
      <div className="max-h-[calc(100vh-220px)] overflow-y-auto">
        {STATUS_ORDER.map((status) => {
          const items = grouped.get(status) ?? [];
          if (items.length === 0) return null;
          return (
            <div key={status}>
              <div className="px-3 py-1 bg-slate-100 text-xs text-slate-600 uppercase tracking-wide">
                {STATUS_LABEL[status]} ({items.length})
              </div>
              <ul className="divide-y">
                {items.map((g) => (
                  <li key={g.id} className="px-3 py-2 text-sm">
                    <div className="flex items-start gap-2">
                      <span className={`text-xs uppercase ${STATUS_COLOR[g.status]}`}>
                        {g.severity}
                      </span>
                      <button
                        onClick={() => setExpanded(expanded === g.id ? null : g.id)}
                        className="flex-1 text-left hover:text-brand"
                      >
                        {g.title}
                      </button>
                      {g.status === 'PENDING' && (
                        <Button variant="ghost" onClick={() => void skipGap(g.id)}>跳过</Button>
                      )}
                    </div>
                    {expanded === g.id && (
                      <div className="mt-2 text-xs text-slate-600 space-y-1">
                        <div><span className="text-slate-400">slug:</span> {g.slug}</div>
                        <div><span className="text-slate-400">分类:</span> {g.category}</div>
                        <div><span className="text-slate-400">来源:</span> {g.source}</div>
                        <div className="whitespace-pre-wrap">{g.body}</div>
                        {g.expectedFilesChanged.length > 0 && (
                          <div>
                            <span className="text-slate-400">预计改:</span>{' '}
                            {g.expectedFilesChanged.join(', ')}
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
        {gaps.length === 0 && (
          <div className="p-4 text-slate-500 text-sm">还没有 gap，等 differ 跑一下</div>
        )}
      </div>
    </div>
  );
}
