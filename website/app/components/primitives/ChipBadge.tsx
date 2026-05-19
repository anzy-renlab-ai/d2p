import { clsx } from './clsx';
import type { ReactNode } from 'react';

type Tone = 'paper' | 'coral' | 'sage' | 'amber' | 'slate' | 'plum' | 'rust';

type Props = {
  tone?: Tone;
  children: ReactNode;
  className?: string;
  mono?: boolean;
};

const toneMap: Record<Tone, string> = {
  paper: 'bg-paper text-muted ring-1 ring-warmline',
  coral: 'bg-coralsoft text-coral ring-1 ring-coral/20',
  sage: 'bg-sage-50 text-sage-600 ring-1 ring-sage-600/20',
  amber: 'bg-amber-50 text-amber-600 ring-1 ring-amber-600/20',
  slate: 'bg-slate-50 text-slate-600 ring-1 ring-slate-600/20',
  plum: 'bg-plum-50 text-plum-600 ring-1 ring-plum-600/20',
  rust: 'bg-rust/10 text-rust ring-1 ring-rust/20',
};

export function ChipBadge({ tone = 'paper', children, className, mono = true }: Props) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs',
        mono && 'font-mono',
        toneMap[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
