'use client';

import { ArrowRight } from 'lucide-react';
import { useLang } from '../i18n';
import { HeroDashboard } from './HeroDashboard';
import { LangToggle } from './LangToggle';
import { ChipBadge } from './primitives/ChipBadge';

export function Hero() {
  const { t } = useLang();

  return (
    <section className="relative overflow-hidden">
      {/* faint dotted grid background */}
      <div className="bg-dotted absolute inset-0 opacity-50" aria-hidden="true" />
      <div className="relative mx-auto flex max-w-7xl flex-col px-6 pt-6 lg:px-10">
        {/* top nav */}
        <nav
          className="flex items-center justify-between"
          aria-label="Primary"
        >
          <span className="font-serif italic text-coral text-[22px]">ZeroU</span>
          <div className="flex items-center gap-4">
            <a
              href="#how"
              className="hidden text-sm text-muted transition-colors hover:text-ink sm:inline"
            >
              {t('How it works', '工作原理')}
            </a>
            <a
              href="#case"
              className="hidden text-sm text-muted transition-colors hover:text-ink sm:inline"
            >
              {t('Case study', '案例')}
            </a>
            <a
              href="https://github.com/Upp-Ljl/d2p"
              target="_blank"
              rel="noreferrer"
              className="hidden text-sm text-muted transition-colors hover:text-ink sm:inline"
            >
              GitHub
            </a>
            <LangToggle />
          </div>
        </nav>

        <div className="grid grid-cols-1 items-center gap-10 pt-16 pb-20 lg:grid-cols-[46fr_54fr] lg:gap-12 lg:pt-24 lg:pb-28">
          {/* Left: copy + CTAs */}
          <div className="flex flex-col">
            <h1 className="font-serif font-medium leading-[1.05] tracking-tight text-ink text-[40px] sm:text-[48px] lg:text-[64px]">
              {t('Ship the demo.', 'demo')}
              <br />
              <span className="text-coral">
                {t('Skip the product work.', '跑成 product')}
              </span>
            </h1>
            <p className="mt-6 max-w-xl text-base text-muted leading-relaxed sm:text-lg">
              {t(
                'Point ZeroU at a local demo folder. It writes the README, CI, CSRF, backups, empty states, loading states, a11y — then pushes a real PR.',
                '给一个本地 demo 文件夹,ZeroU 自动补完 README、CI、CSRF、备份、空态、loading、a11y——并真 push GitHub 开 PR。',
              )}
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
              <a
                href="https://github.com/Upp-Ljl/d2p"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-coral px-6 py-3 text-sm font-medium text-cream shadow-glow transition-all hover:-translate-y-px hover:bg-coralhover"
              >
                {t('Clone the demo. Run it.', '克隆 demo,跑一次')}
              </a>
              <a
                href="#case"
                className="inline-flex items-center justify-center gap-1 text-sm font-medium text-coral underline-offset-4 transition-colors hover:text-coralhover hover:underline"
              >
                {t('See a 1h 31min real run', '看 1h31min 真跑案例')}
                <ArrowRight size={14} aria-hidden="true" />
              </a>
            </div>

            {/* hard data chips */}
            <div className="mt-10 flex flex-wrap gap-2">
              <ChipBadge tone="paper">1h 31min</ChipBadge>
              <ChipBadge tone="paper">$4.24</ChipBadge>
              <ChipBadge tone="paper">2 merged · 24 NEED_HUMAN</ChipBadge>
            </div>
          </div>

          {/* Right: mini dashboard animation */}
          <div className="relative">
            <div className="aspect-[5/4] max-h-[640px] w-full lg:aspect-auto lg:h-[68vh] lg:max-h-none">
              <HeroDashboard />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
