import { Pill } from './Pill';

/**
 * Live tunnel block. URL comes from NEXT_PUBLIC_LIVE_DEMO_URL — inlined at
 * build time by Next.js (NEXT_PUBLIC_* are baked into client chunks), so
 * toggling the tunnel requires a Vercel redeploy. That is intentional: the
 * button reflects the last deploy's view of the tunnel, not a live probe.
 */
const LIVE_DEMO_URL = process.env.NEXT_PUBLIC_LIVE_DEMO_URL || '';
const BUILT_AT = new Date().toISOString().slice(0, 16).replace('T', ' ');

export function LiveDemo() {
  const isLive = LIVE_DEMO_URL.length > 0;

  return (
    <section id="live-demo" className="max-w-6xl mx-auto px-6 py-16">
      <div className="card p-8 sm:p-10">
        <div className="flex flex-wrap items-baseline justify-between gap-3 mb-3">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-muted mb-2 font-mono">
              touch the demo yourself
            </div>
            <h2 className="text-3xl tracking-tight leading-tight">
              The link below is{' '}
              <span className="text-coral">Loeser&apos;s laptop</span>.
            </h2>
          </div>
          <StatusPill isLive={isLive} />
        </div>

        <p className="text-sm text-muted max-w-3xl mb-6 leading-relaxed">
          The meme-weather demo we just hardened is tunnelled out from a
          MacBook on the owner&apos;s desk. If you can reach it, the tunnel is
          up. If not, the laptop is asleep or the cloudflared process died —
          that&apos;s also a real signal about hobby-project ops.
        </p>

        {/* Big button */}
        <div className="mb-6">
          {isLive ? (
            <a
              href={LIVE_DEMO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-5 py-3 rounded bg-coral text-cream font-medium hover:bg-coralhover transition-colors shadow-soft"
            >
              <span>Open live demo</span>
              <span aria-hidden className="font-mono">→</span>
            </a>
          ) : (
            <span
              aria-disabled="true"
              className="inline-flex items-center gap-2 px-5 py-3 rounded bg-warmline text-muted font-medium cursor-not-allowed select-none"
              title="NEXT_PUBLIC_LIVE_DEMO_URL is unset on this deployment"
            >
              <span>Open live demo</span>
              <span aria-hidden className="font-mono">→</span>
            </span>
          )}
        </div>

        {/* URL preview when live */}
        {isLive && (
          <div className="mb-6 font-mono text-[12px] text-muted break-all">
            {LIVE_DEMO_URL}
          </div>
        )}

        {/* Operator tip */}
        <div className="border-t border-warmline pt-5 text-[12px] text-muted leading-relaxed">
          <div className="font-mono uppercase tracking-widest text-[10px] mb-2">
            tip for the owner
          </div>
          <pre className="font-mono text-[11px] bg-paper/60 text-ink/85 p-3 rounded overflow-x-auto leading-relaxed">{`cloudflared tunnel --url http://localhost:3000
# → https://<random>.trycloudflare.com
# paste that into Vercel env: NEXT_PUBLIC_LIVE_DEMO_URL
# redeploy. button goes live until cloudflared dies.`}</pre>
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
          <span aria-hidden>●</span> live
        </Pill>
        <Pill mono>built {BUILT_AT} UTC</Pill>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <Pill tone="slate" mono>
        <span aria-hidden>○</span> offline
      </Pill>
      <Pill mono>tunnel not configured</Pill>
    </div>
  );
}
