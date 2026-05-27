import { useState } from 'react';
import type { ReviewVerify } from '../types-zerou.js';

const GLYPH: Record<ReviewVerify['steps'][number]['status'], { glyph: string; tone: string; ring: string }> = {
  pass:    { glyph: '✓', tone: 'text-forest', ring: 'ring-forest/30' },
  fail:    { glyph: '✗', tone: 'text-rust',   ring: 'ring-rust/30' },
  skipped: { glyph: '—', tone: 'text-muted',  ring: 'ring-warmline' },
};

export function ZerouVerifyStrip({ verify }: { verify: ReviewVerify }) {
  const [openStep, setOpenStep] = useState<string | null>(null);
  return (
    <section
      className="bg-cream border border-warmline rounded-lg p-4"
      data-testid="zerou-verify-strip"
    >
      <div className="flex items-baseline justify-between mb-2">
        <div className="text-[10px] uppercase tracking-widest text-muted/70 font-medium">
          Verify
        </div>
        <div
          className={`text-xs font-mono ${verify.ok ? 'text-forest' : 'text-rust'}`}
          data-testid="zerou-verify-overall"
        >
          {verify.ok ? '✓ all pass' : `✗ broken by ${verify.brokenBy ?? 'unknown'}`}
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {verify.steps.map((step) => {
          const meta = GLYPH[step.status];
          const open = openStep === step.name;
          return (
            <button
              type="button"
              key={step.name}
              onClick={() => step.failOutput && setOpenStep(open ? null : step.name)}
              className={`text-left bg-paper border border-warmline rounded-md p-3 ring-1 ${meta.ring} ${step.failOutput ? 'cursor-pointer hover:bg-cream' : 'cursor-default'}`}
              data-testid={`zerou-verify-step-${step.name}`}
            >
              <div className="flex items-baseline justify-between">
                <span className="text-xs font-mono uppercase tracking-wider text-ink">{step.name}</span>
                <span className={`text-base leading-none ${meta.tone}`}>{meta.glyph}</span>
              </div>
              <div className="text-[10px] text-muted/70 font-mono mt-1.5">
                {step.durationMs > 0 ? `${(step.durationMs / 1000).toFixed(1)}s` : '—'}
              </div>
              {open && step.failOutput && (
                <pre className="mt-2 text-[10px] font-mono text-rust whitespace-pre-wrap break-all">
                  {step.failOutput}
                </pre>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}
