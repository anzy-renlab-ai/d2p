'use client';

import { useLang } from '../i18n';
import { clsx } from './primitives/clsx';

export function LangToggle({ className }: { className?: string }) {
  const { lang, setLang } = useLang();
  return (
    <div
      className={clsx(
        'inline-flex rounded-full bg-cream p-0.5 ring-1 ring-warmline font-mono text-[11px]',
        className,
      )}
      role="group"
      aria-label="Language toggle"
    >
      <button
        type="button"
        onClick={() => setLang('en')}
        className={clsx(
          'rounded-full px-2.5 py-1 transition-colors',
          lang === 'en' ? 'bg-ink text-cream' : 'text-muted hover:text-ink',
        )}
        aria-pressed={lang === 'en'}
        aria-label="Switch to English"
      >
        en
      </button>
      <button
        type="button"
        onClick={() => setLang('zh')}
        className={clsx(
          'rounded-full px-2.5 py-1 transition-colors',
          lang === 'zh' ? 'bg-ink text-cream' : 'text-muted hover:text-ink',
        )}
        aria-pressed={lang === 'zh'}
        aria-label="切换为中文"
      >
        zh
      </button>
    </div>
  );
}
