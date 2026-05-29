import { Pill } from './Pill';

/**
 * Mission Control dashboard tunnel block. URL comes from
 * NEXT_PUBLIC_DASHBOARD_URL — inlined at build time by Next.js (NEXT_PUBLIC_*
 * are baked into client chunks), so toggling the tunnel requires a Vercel
 * redeploy. Mirrors the LiveDemo pattern (which exposes meme-weather).
 */
const DASHBOARD_URL = process.env.NEXT_PUBLIC_DASHBOARD_URL || '';

export function LocalDashboardLink() {
  const isLive = DASHBOARD_URL.length > 0;

  return (
    <section id="local-dashboard" className="max-w-6xl mx-auto px-6 py-16">
      <div className="card card-hover p-8 sm:p-10">
        <div className="flex flex-wrap items-baseline justify-between gap-3 mb-3">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-muted mb-2 font-mono">
              Watch it run · live dashboard
            </div>
            <h2 className="text-3xl tracking-tight leading-tight">
              Open the{' '}
              <span className="text-coral">Mission Control</span> dashboard
            </h2>
          </div>
          <StatusPill isLive={isLive} />
        </div>

        <p className="text-sm text-muted max-w-3xl mb-6 leading-relaxed">
          ZeroU runs a local web dashboard at{' '}
          <code className="font-mono text-coral">localhost:5173</code>. When the
          owner&apos;s daemon is up and tunnelled, you can drive it from any
          device.
        </p>

        {/* Big button */}
        <div className="mb-6">
          {isLive ? (
            <a
              href={DASHBOARD_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-6 py-3.5 rounded bg-coral text-cream text-base font-semibold hover:bg-coralhover transition-colors shadow-soft"
            >
              <span>Open ZeroU dashboard</span>
              <span aria-hidden className="font-mono">→</span>
            </a>
          ) : (
            <span
              aria-disabled="true"
              className="inline-flex items-center gap-2 px-6 py-3.5 rounded bg-warmline text-muted text-base font-semibold cursor-not-allowed select-none opacity-50"
              title="NEXT_PUBLIC_DASHBOARD_URL is unset on this deployment"
            >
              <span>Open ZeroU dashboard</span>
              <span aria-hidden className="font-mono">→</span>
            </span>
          )}
        </div>

        {/* URL preview when live */}
        {isLive && (
          <div className="mb-6 font-mono text-[12px] text-muted break-all">
            {DASHBOARD_URL}
          </div>
        )}

        {/* Operator tip */}
        <div className="border-t border-warmline pt-5 text-[12px] text-muted leading-relaxed">
          <div className="font-mono uppercase tracking-widest text-[10px] mb-2">
            tip for the owner
          </div>
          <pre className="font-mono text-[11px] bg-paper/60 text-ink/85 p-3 rounded overflow-x-auto leading-relaxed">{`# On owner's machine
zerou start                      # daemon at :5174, UI at :5173
cloudflared tunnel --url http://localhost:5173

# Set on Vercel
NEXT_PUBLIC_DASHBOARD_URL=https://<random>.trycloudflare.com`}</pre>
        </div>
      </div>
    </section>
  );
}

function StatusPill({ isLive }: { isLive: boolean }) {
  if (isLive) {
    return (
      <div className="flex items-center gap-2">
        <Pill tone="forest" mono>
          <span aria-hidden>●</span> live · ZeroU daemon online
        </Pill>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <Pill tone="slate" mono>
        <span aria-hidden>○</span> offline — owner&apos;s tunnel not configured
      </Pill>
    </div>
  );
}
