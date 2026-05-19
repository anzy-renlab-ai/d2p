'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type Lang = 'en' | 'zh';

type Ctx = {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (en: string, zh: string) => string;
};

const LangCtx = createContext<Ctx | null>(null);

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>('en');

  // Hydrate from localStorage once.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem('zerou-lang');
      if (stored === 'zh' || stored === 'en') {
        setLangState(stored);
      }
    } catch {
      // ignore
    }
  }, []);

  // Keep <html lang> in sync.
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('lang', lang);
    }
  }, [lang]);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      window.localStorage.setItem('zerou-lang', l);
    } catch {
      // ignore
    }
  }, []);

  const t = useCallback(
    (en: string, zh: string) => (lang === 'zh' ? zh : en),
    [lang],
  );

  const value = useMemo<Ctx>(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <LangCtx.Provider value={value}>{children}</LangCtx.Provider>;
}

export function useLang(): Ctx {
  const ctx = useContext(LangCtx);
  if (!ctx) {
    // Server-safe fallback before hydration.
    return {
      lang: 'en',
      setLang: () => {
        /* noop */
      },
      t: (en) => en,
    };
  }
  return ctx;
}
