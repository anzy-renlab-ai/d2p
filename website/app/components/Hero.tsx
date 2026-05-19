'use client';

import { ArrowRight } from 'lucide-react';
import { useLang } from '../i18n';
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

          {/* Right: 62s demo video — auto-loop with mint accent frame */}
          <div className="relative">
            <div className="relative aspect-video w-full overflow-hidden rounded-2xl bg-[#0A0A0A] shadow-2xl ring-1 ring-[#7CFFB2]/30">
              <video
                src="/zerou-demo.mp4"
                autoPlay
                loop
                muted
                playsInline
                preload="auto"
                className="h-full w-full object-cover"
                aria-label="ZeroU 60-second demo loop"
              />
              {/* subtle mint corner glow */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 rounded-2xl"
                style={{
                  boxShadow: '0 0 80px -20px rgba(124, 255, 178, 0.35) inset',
                }}
              />
            </div>
            <p className="mt-3 text-center font-mono text-[11px] tracking-wider text-muted/70">
              {t(
                '60s demo · the whole pipeline · real data from PR #6',
                '60 秒 demo · 全流程 · PR #6 真实数据',
              )}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
