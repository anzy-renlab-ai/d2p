'use client';

import { useLang } from '../i18n';
import { LangToggle } from './LangToggle';

type Col = {
  title: string;
  links: { label: string; href: string; external?: boolean }[];
};

export function Footer() {
  const { t } = useLang();

  const cols: Col[] = [
    {
      title: t('Product', '产品'),
      links: [
        { label: t('Features', '功能'), href: '#features' },
        { label: t('How it works', '工作原理'), href: '#how' },
        { label: t('Roadmap', 'Roadmap'), href: '#' },
      ],
    },
    {
      title: t('Docs', '文档'),
      links: [
        { label: 'DEV-DOC', href: 'https://github.com/Upp-Ljl/d2p/blob/main/docs/DEV-DOC.md', external: true },
        { label: 'CLAUDE.md', href: 'https://github.com/Upp-Ljl/d2p/blob/main/CLAUDE.md', external: true },
      ],
    },
    {
      title: t('Repo', '仓库'),
      links: [
        { label: 'GitHub', href: 'https://github.com/Upp-Ljl/d2p', external: true },
        {
          label: 'Real PR #6',
          href: 'https://github.com/anzy-renlab-ai/agent-game-platform/pull/6',
          external: true,
        },
        { label: 'Issues', href: 'https://github.com/Upp-Ljl/d2p/issues', external: true },
      ],
    },
    {
      title: t('About', '关于'),
      links: [
        { label: t('Manifesto', '理念'), href: '#' },
        { label: t('Contact', '联系'), href: 'mailto:hello@zerou.dev' },
      ],
    },
  ];

  return (
    <footer className="border-t border-warmline bg-cream px-6 py-14">
      <div className="mx-auto max-w-6xl">
        <div className="grid grid-cols-2 gap-10 sm:grid-cols-4">
          {cols.map((col) => (
            <div key={col.title}>
              <div className="font-mono text-[10px] uppercase tracking-wider text-muted">
                {col.title}
              </div>
              <ul className="mt-4 space-y-2" role="list">
                {col.links.map((l) => (
                  <li key={l.label}>
                    <a
                      href={l.href}
                      {...(l.external
                        ? { target: '_blank', rel: 'noreferrer' }
                        : {})}
                      className="text-sm text-ink/80 transition-colors hover:text-coral"
                    >
                      {l.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-col items-start justify-between gap-4 border-t border-warmline pt-6 sm:flex-row sm:items-center">
          <div className="font-mono text-[12px] text-muted">
            ZeroU · MIT · built with claude code · 2026
          </div>
          <LangToggle />
        </div>
      </div>
    </footer>
  );
}
