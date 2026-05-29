import { ReactNode } from 'react';

export type PillTone =
  | 'neutral'
  | 'coral'
  | 'forest'
  | 'rust'
  | 'slate'
  | 'sage'
  | 'amber'
  | 'plum';

const tones: Record<PillTone, string> = {
  neutral: 'bg-cream text-ink border-warmline',
  coral: 'bg-coralsoft text-coral border-coral/30',
  forest: 'bg-sage-50 text-sage-600 border-sage-100',
  rust: 'bg-[#F7E0E3] text-rust border-rust/30',
  slate: 'bg-slate-50 text-slate-600 border-slate-100',
  sage: 'bg-sage-50 text-sage-600 border-sage-100',
  amber: 'bg-amber-50 text-amber-600 border-amber-100',
  plum: 'bg-plum-50 text-plum-600 border-plum-100',
};

export function Pill({
  tone = 'neutral',
  mono = false,
  children,
}: {
  tone?: PillTone;
  mono?: boolean;
  children: ReactNode;
}) {
  return (
    <span
      className={[
        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded border text-[11px] font-medium',
        mono ? 'font-mono' : '',
        tones[tone],
      ].join(' ')}
    >
      {children}
    </span>
  );
}
