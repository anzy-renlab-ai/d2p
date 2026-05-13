import type { ReactNode } from 'react';

export function ErrorBanner({ message, onDismiss }: { message: ReactNode; onDismiss?: () => void }) {
  return (
    <div className="bg-red-50 border border-red-200 text-red-800 rounded px-3 py-2 text-sm flex items-start gap-3">
      <span className="flex-1">{message}</span>
      {onDismiss && (
        <button onClick={onDismiss} className="text-red-600 hover:text-red-800" aria-label="dismiss">
          ×
        </button>
      )}
    </div>
  );
}
