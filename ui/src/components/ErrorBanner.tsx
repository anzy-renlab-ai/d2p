import type { ReactNode } from 'react';

export function ErrorBanner({ message, onDismiss }: { message: ReactNode; onDismiss?: () => void }) {
  return (
    <div className="bg-coralsoft/40 border border-coral/30 text-ink rounded-md px-4 py-3 text-sm flex items-start gap-3">
      <span className="text-rust mt-0.5">⚠</span>
      <span className="flex-1 leading-relaxed">{message}</span>
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="text-muted hover:text-ink text-lg leading-none"
          aria-label="dismiss"
        >
          ×
        </button>
      )}
    </div>
  );
}
