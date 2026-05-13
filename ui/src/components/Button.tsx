import type { ButtonHTMLAttributes, ReactNode } from 'react';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  children: ReactNode;
}

const VARIANTS: Record<NonNullable<Props['variant']>, string> = {
  primary: 'bg-brand text-white hover:bg-blue-700 disabled:bg-slate-300',
  secondary: 'bg-white text-slate-900 border border-slate-300 hover:bg-slate-50 disabled:opacity-50',
  danger: 'bg-red-600 text-white hover:bg-red-700 disabled:bg-slate-300',
  ghost: 'bg-transparent text-slate-700 hover:bg-slate-100 disabled:opacity-50',
};

export function Button({ variant = 'primary', className = '', children, ...rest }: Props) {
  return (
    <button
      className={`px-3 py-1.5 rounded text-sm transition-colors ${VARIANTS[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
