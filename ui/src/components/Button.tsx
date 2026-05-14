import type { ButtonHTMLAttributes, ReactNode } from 'react';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  children: ReactNode;
}

const VARIANTS: Record<NonNullable<Props['variant']>, string> = {
  primary:
    'bg-coral text-cream hover:bg-coralhover disabled:bg-warmline disabled:text-muted',
  secondary:
    'bg-cream text-ink border border-warmline hover:bg-paper disabled:opacity-50',
  danger:
    'bg-rust text-cream hover:opacity-90 disabled:bg-warmline disabled:text-muted',
  ghost:
    'bg-transparent text-muted hover:text-ink hover:bg-warmline/40 disabled:opacity-50',
};

export function Button({ variant = 'primary', className = '', children, ...rest }: Props) {
  return (
    <button
      className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${VARIANTS[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
