import type { ButtonHTMLAttributes, ReactNode } from 'react';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  /** Show spinner + auto-disable. Optionally pass `loadingText` to swap the
   *  label while loading; otherwise children render with a leading spinner. */
  loading?: boolean;
  loadingText?: string;
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

export function Button({
  variant = 'primary',
  className = '',
  loading = false,
  loadingText,
  disabled,
  children,
  ...rest
}: Props) {
  const isDisabled = disabled || loading;
  return (
    <button
      aria-busy={loading || undefined}
      disabled={isDisabled}
      className={`px-4 py-2 rounded-md text-sm font-medium transition-colors inline-flex items-center justify-center gap-2 ${VARIANTS[variant]} ${loading ? 'cursor-progress' : ''} ${className}`}
      {...rest}
    >
      {loading && <Spinner />}
      <span>{loading ? (loadingText ?? children) : children}</span>
    </button>
  );
}

function Spinner() {
  return (
    <svg
      className="animate-spin w-3.5 h-3.5"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
