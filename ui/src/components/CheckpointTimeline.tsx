import { useState } from 'react';
import { useLocale } from '../i18n/useLocale.js';
import {
  checkpointsForCommit,
  TIER_META,
  type CheckpointMock,
  type CheckpointTier,
} from '../mock/checkpoints.js';

// Rewindable snapshots attached to a commit. T-tiered for relevance:
//   T0 关键 / pinned : user should know this exists
//   T1 普通          : auto, kept ~7d, can rewind
//   T2 可清理         : auto, GC candidate
//
// Selective creation: NOT one per commit. Created at meaningful boundaries
// (pre-merge, pre-multi-turn, vision-finalize, user-pinned).

const T_ORDER: CheckpointTier[] = ['T0', 'T1', 'T2'];

export interface CheckpointTimelineProps {
  commitSha: string;
  /** When true, hide T2 by default (collapses noise). User can expand. */
  hideAuxByDefault?: boolean;
  onRewind?: (id: string) => void;
  onTogglePin?: (id: string) => void;
}

export function CheckpointTimeline({
  commitSha,
  hideAuxByDefault = true,
  onRewind,
  onTogglePin,
}: CheckpointTimelineProps) {
  const { t, locale } = useLocale();
  const [showAux, setShowAux] = useState(!hideAuxByDefault);
  const all = checkpointsForCommit(commitSha);
  if (all.length === 0) {
    return (
      <div className="text-[11px] text-muted/60 font-mono px-2 py-2">
        {locale === 'en' ? 'No checkpoints recorded for this commit' : '此 commit 没有快照'}
      </div>
    );
  }

  const grouped: Record<CheckpointTier, CheckpointMock[]> = { T0: [], T1: [], T2: [] };
  for (const cp of all) {
    // user-pinned forces T0 regardless of stored tier
    const tier: CheckpointTier = cp.pinned ? 'T0' : cp.tier;
    grouped[tier].push(cp);
  }

  const visibleTiers = showAux ? T_ORDER : T_ORDER.filter((t) => t !== 'T2');
  const auxCount = grouped.T2.length;

  return (
    <div className="space-y-3" data-testid={`checkpoint-timeline-${commitSha.slice(0, 7)}`}>
      <div className="flex items-baseline justify-between">
        <div className="text-[10px] uppercase tracking-widest text-muted/70 font-medium">
          {locale === 'en' ? `Checkpoints · ${all.length}` : `快照 · ${all.length} 个`}
        </div>
        {auxCount > 0 && (
          <button
            type="button"
            onClick={() => setShowAux(!showAux)}
            className="text-[11px] text-muted hover:text-ink font-sans transition-colors"
          >
            {showAux
              ? (locale === 'en' ? `Hide auxiliary (${auxCount})` : `收起辅助 (${auxCount}) ▴`)
              : (locale === 'en' ? `+ ${auxCount} auxiliary` : `+ ${auxCount} 辅助 ▾`)}
          </button>
        )}
      </div>

      <ol className="space-y-2">
        {visibleTiers.flatMap((tier) =>
          grouped[tier].map((cp) => (
            <CheckpointRow
              key={cp.id}
              cp={cp}
              effectiveTier={tier}
              onRewind={() => onRewind?.(cp.id)}
              onTogglePin={() => onTogglePin?.(cp.id)}
            />
          )),
        )}
      </ol>
    </div>
  );
}

function CheckpointRow({
  cp,
  effectiveTier,
  onRewind,
  onTogglePin,
}: {
  cp: CheckpointMock;
  effectiveTier: CheckpointTier;
  onRewind: () => void;
  onTogglePin: () => void;
}) {
  const { locale } = useLocale();
  const tierMeta = TIER_META[effectiveTier];
  const tierLabel = locale === 'en' ? tierMeta.enLabel : tierMeta.zhLabel;
  const isImportant = effectiveTier === 'T0';
  const elapsed = Date.now() - cp.ts;
  const elapsedTxt = elapsed < 3_600_000
    ? `${Math.max(1, Math.floor(elapsed / 60_000))}${locale === 'en' ? 'm' : '分'}`
    : elapsed < 86_400_000
      ? `${Math.floor(elapsed / 3_600_000)}${locale === 'en' ? 'h' : '小时'}`
      : `${Math.floor(elapsed / 86_400_000)}${locale === 'en' ? 'd' : '天'}`;

  return (
    <li
      className={`bg-cream rounded-lg px-3 py-2.5 ${tierMeta.ring} ${isImportant ? '' : 'opacity-90'}`}
      data-testid={`checkpoint-${cp.id}`}
    >
      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
        <span className={`inline-flex items-center gap-1 px-1.5 py-0 rounded text-[10px] font-sans font-medium ${tierMeta.chip}`}>
          {effectiveTier} {tierLabel}
        </span>
        {cp.pinned && (
          <span className="text-[10px] text-rust" title={locale === 'en' ? 'User-pinned' : '已固定'}>
            📌
          </span>
        )}
        {cp.recommended && !cp.pinned && (
          <span className="text-[10px] text-coral" title={locale === 'en' ? 'Recommended save point' : '推荐节点'}>
            ★
          </span>
        )}
        <span className="font-mono text-[11px] text-muted/70 truncate flex-1 min-w-0">{cp.tag}</span>
        <span className="text-[10px] text-muted/50 font-mono flex-shrink-0">{elapsedTxt}</span>
      </div>
      <div className="text-[11px] text-ink/80 leading-snug pl-1">{cp.reason}</div>
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={onRewind}
          className="text-[11px] px-2 py-0.5 rounded bg-coralsoft text-coral hover:bg-coral hover:text-cream transition-colors font-sans"
          title={locale === 'en' ? 'Revert worktree to this state' : '把工作区回退到这个快照'}
        >
          {locale === 'en' ? '↶ Rewind here' : '↶ 回到这里'}
        </button>
        <button
          type="button"
          onClick={onTogglePin}
          className="text-[11px] px-2 py-0.5 rounded text-muted hover:text-ink hover:bg-paper transition-colors font-sans"
          title={locale === 'en' ? 'Pin / unpin' : '固定 / 取消固定'}
        >
          {cp.pinned
            ? (locale === 'en' ? '✕ Unpin' : '✕ 取消固定')
            : (locale === 'en' ? '📌 Pin' : '📌 固定')}
        </button>
      </div>
    </li>
  );
}
