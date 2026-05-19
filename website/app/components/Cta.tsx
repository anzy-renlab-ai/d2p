'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { useLang } from '../i18n';
import { ScrollFadeIn } from './primitives/ScrollFadeIn';

const COMMAND = 'git clone https://github.com/Upp-Ljl/d2p && cd d2p && d2p start ./your-demo';

export function Cta() {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(COMMAND);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // ignore
    }
  }

  return (
    <section className="bg-paper px-6 py-32 lg:py-40">
      <div className="mx-auto max-w-3xl">
        <ScrollFadeIn className="text-center">
          <h2 className="font-serif text-[36px] font-medium leading-[1.05] tracking-tight text-ink sm:text-[52px]">
            {t('Now, give ZeroU a demo.', '现在,给 ZeroU 一个 demo')}
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-base text-muted sm:text-lg">
            {t(
              'Less than a coffee. A PR-ready product.',
              '不到一杯咖啡的钱,换一个 PR-ready 的 product。',
            )}
          </p>
        </ScrollFadeIn>

        <ScrollFadeIn delay={0.1}>
          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-coral px-7 py-3.5 text-[15px] font-medium text-cream shadow-glow transition-all hover:-translate-y-px hover:bg-coralhover"
            >
              {t('Clone the demo. Run it.', '克隆 demo,跑一次')}
            </button>
            <a
              href="#case"
              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-coral px-7 py-3.5 text-[15px] font-medium text-coral transition-colors hover:bg-coralsoft"
            >
              {t('See the 1h 31min real run', '看 1h31min 真跑案例')}
            </a>
          </div>

          {open && (
            <div className="mx-auto mt-6 flex max-w-2xl items-center gap-2 rounded-xl bg-cream px-4 py-3 ring-1 ring-warmline">
              <code className="flex-1 truncate font-mono text-[12.5px] text-ink">
                {COMMAND}
              </code>
              <button
                type="button"
                onClick={copy}
                className="inline-flex items-center gap-1.5 rounded-md bg-paper px-3 py-1.5 font-mono text-[11px] text-muted ring-1 ring-warmline transition-colors hover:bg-coralsoft hover:text-coral"
                aria-label="Copy command"
              >
                {copied ? (
                  <>
                    <Check size={12} aria-hidden="true" /> copied
                  </>
                ) : (
                  <>
                    <Copy size={12} aria-hidden="true" /> copy
                  </>
                )}
              </button>
            </div>
          )}
        </ScrollFadeIn>
      </div>
    </section>
  );
}
