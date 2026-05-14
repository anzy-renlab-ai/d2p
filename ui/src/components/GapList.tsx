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
  PENDING: 'text-muted',
  IN_PROGRESS: 'text-coral font-semibold',
  DONE: 'text-forest',
  SKIPPED: 'text-muted/60 line-through',
  NEED_HUMAN: 'text-rust',
  SPLIT_DONE: 'text-coral',
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
    <div className="card overflow-hidden flex flex-col h-full">
      <div className="card-header flex items-center justify-between">
        <span>Gap 队列</span>
        <span className="text-xs font-sans text-muted">{gaps.length}</span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {STATUS_ORDER.map((status) => {
          const items = grouped.get(status) ?? [];
          if (items.length === 0) return null;
          return (
            <div key={status}>
              <div className="px-4 py-1.5 bg-paper text-[10px] text-muted uppercase tracking-wider font-medium">
                {STATUS_LABEL[status]} · {items.length}
              </div>
              <ul className="divide-y divide-warmline">
                {items.map((g) => (
                  <li key={g.id} className="px-4 py-2.5 text-sm">
                    <div className="flex items-start gap-2">
                      <span className={`text-[10px] uppercase tracking-wider ${STATUS_COLOR[g.status]}`}>
                        {g.severity}
                      </span>
                      <button
                        onClick={() => setExpanded(expanded === g.id ? null : g.id)}
                        className="flex-1 text-left text-ink hover:text-coral transition-colors"
                      >
                        {g.title}
                      </button>
                      {g.status === 'PENDING' && (
                        <Button variant="ghost" onClick={() => void skipGap(g.id)}>跳过</Button>
                      )}
                    </div>
                    {expanded === g.id && (
                      <div className="mt-2 text-xs text-muted space-y-1 pl-2 border-l-2 border-warmline">
                        <div><span className="text-muted/60">slug:</span> {g.slug}</div>
                        <div><span className="text-muted/60">分类:</span> {g.category}</div>
                        <div><span className="text-muted/60">来源:</span> {g.source}</div>
                        <div className="whitespace-pre-wrap">{g.body}</div>
                        {g.expectedFilesChanged.length > 0 && (
                          <div>
                            <span className="text-muted/60">预计改:</span>{' '}
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
          <div className="p-6 text-muted text-sm italic font-serif">还没有 gap，等 differ 跑一下…</div>
        )}
      </div>
    </div>
  );
}
