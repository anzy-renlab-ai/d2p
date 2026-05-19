'use client';

import { motion } from 'framer-motion';
import { clsx } from './clsx';

export type AgentRole =
  | 'differ'
  | 'implementer'
  | 'alignment'
  | 'behavioral'
  | 'adversarial'
  | 'done-check';

export type AgentStatus = 'idle' | 'working' | 'done';

const roleColor: Record<AgentRole, { bar: string; tint: string; ring: string; label: string }> = {
  differ: {
    bar: 'bg-slate-600',
    tint: 'bg-slate-50',
    ring: 'ring-slate-600/20',
    label: 'differ',
  },
  implementer: {
    bar: 'bg-amber-600',
    tint: 'bg-amber-50',
    ring: 'ring-amber-600/20',
    label: 'implementer',
  },
  alignment: {
    bar: 'bg-sage-600',
    tint: 'bg-sage-50',
    ring: 'ring-sage-600/20',
    label: 'alignment',
  },
  behavioral: {
    bar: 'bg-sage-600',
    tint: 'bg-sage-50',
    ring: 'ring-sage-600/20',
    label: 'behavioral',
  },
  adversarial: {
    bar: 'bg-rust',
    tint: 'bg-rust/5',
    ring: 'ring-rust/20',
    label: 'adversarial',
  },
  'done-check': {
    bar: 'bg-plum-600',
    tint: 'bg-plum-50',
    ring: 'ring-plum-600/20',
    label: 'done-check',
  },
};

type Props = {
  role: AgentRole;
  status: AgentStatus;
  /** Optional caption to render under the role label (e.g. a gap slug or score). */
  caption?: string;
  /** Reduced size for tight mini-dashboards. */
  compact?: boolean;
};

export function AgentCard({ role, status, caption, compact = false }: Props) {
  const c = roleColor[role];
  const working = status === 'working';
  const done = status === 'done';

  const dotColor =
    status === 'idle'
      ? 'bg-warmline'
      : status === 'working'
      ? 'bg-coral'
      : 'bg-forest';

  return (
    <motion.div
      layout
      animate={{
        backgroundColor: working ? undefined : 'rgba(250,249,245,1)', // cream
      }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className={clsx(
        'relative flex items-center gap-3 rounded-xl ring-1 transition-colors',
        compact ? 'p-2.5' : 'p-3.5',
        working ? `${c.tint} ${c.ring} shadow-glow` : 'bg-cream ring-warmline',
        done && 'opacity-90',
      )}
    >
      <span className={clsx('w-[2px] self-stretch rounded-full', c.bar)} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className={clsx(
              'inline-block h-1.5 w-1.5 rounded-full',
              dotColor,
              working && 'anim-breathe',
            )}
            aria-hidden="true"
          />
          <span className={clsx('font-mono text-[11px] uppercase tracking-wider text-ink/80')}>
            {c.label}
          </span>
          {working && (
            <span className="ml-auto font-mono text-[10px] text-coral">working</span>
          )}
          {done && (
            <span className="ml-auto font-mono text-[10px] text-forest">done</span>
          )}
        </div>
        {caption && (
          <div
            className={clsx(
              'mt-0.5 truncate font-mono text-muted',
              compact ? 'text-[10px]' : 'text-[11px]',
            )}
          >
            {caption}
          </div>
        )}
      </div>
    </motion.div>
  );
}
