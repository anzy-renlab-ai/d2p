# zerou-site

Landing page for [ZeroU](https://github.com/Upp-Ljl/d2p) — the demo-to-production
hardener for vibe-coded apps.

Next.js 15 (App Router) + TypeScript + Tailwind. Zero non-Vercel runtime deps.

## Develop

```bash
npm install
npm run dev      # http://localhost:3000
```

## Build

```bash
npm run build
npm start        # serve production build
```

## Deploy to Vercel

`vercel.json` pins `framework: nextjs`. One-click import from GitHub.

## Structure

```
app/
  layout.tsx        — root, cream bg + metadata
  page.tsx          — single landing page
  globals.css       — Tailwind + d2p keyframes
components/
  SiteHeader.tsx    — sticky nav
  HeroSection.tsx   — headline + CTAs + slot for the 30s auto-play demo
  ValueTiers.tsx    — 4 cards: scan / fix / verify / trace
  Differentiator.tsx— log-as-proof callout
  BenchScoreboard.tsx — head-to-head Phase 22 numbers vs Sonnet / Opus
  QuickStart.tsx    — 4-command demo
  Footer.tsx
  Pill.tsx          — reusable severity / status badge
```

## Design system

Palette is copied verbatim from `d2p/ui/tailwind.config.ts` (paper / cream / ink
/ muted / coral / forest / rust / warmline). Keyframes (`drift-in`, `scale-in`,
`stagger-rise`, etc.) are in `app/globals.css`. All animations honour
`prefers-reduced-motion`.

## Hero demo slot

`HeroSection` leaves a div with `data-testid="hero-demo-slot"` for the 30-second
auto-play demo component (owned by Worker B). Drop the component into that slot
when it lands; the placeholder copy is intentionally minimal so the swap is a
straight replacement.

## Numbers

The `BenchScoreboard` quotes Phase 22 results from
`D:/lll/hardener-bench/COMPARISON.md` verbatim. If those change, update
`components/BenchScoreboard.tsx` (the `rows` constant) and bump the date pill.

The `MemeWeatherShowcase` quotes verbatim from
`D:/lll/meme-weather-zerou-test/.zerou/audit-report.md` and
`.zerou/enhance-report.md`. If you re-run `zerou audit` / `zerou enhance` on
meme-weather, refresh the numbers in `components/MemeWeatherShowcase.tsx` (the
`statStrip`, `beforeRows`, `afterRows` constants) and bump the date pill.

## Live demo tunnel (for owner)

To let the deployed Vercel site link into your local meme-weather:

1. Start meme-weather locally:

   ```bash
   cd D:\lll\meme-weather-zerou-test
   pnpm dev   # serves on localhost:3000
   ```

2. Tunnel to a public URL (no signup required):

   ```bash
   # Option A: Cloudflare (recommended, no signup)
   cloudflared tunnel --url http://localhost:3000
   # → prints https://<random>.trycloudflare.com

   # Option B: ngrok (requires free account)
   ngrok http 3000
   # → prints https://<random>.ngrok-free.app
   ```

3. Paste that URL into the Vercel project env vars:

   ```
   NEXT_PUBLIC_LIVE_DEMO_URL=https://<random>.trycloudflare.com
   ```

4. Redeploy on Vercel (Settings → Deployments → Redeploy latest).

Now the "Open live demo →" button on https://zerou.dev points at your laptop.
Kill the tunnel command → button still points there but the URL 502s.
Re-run → it's back up. Because `NEXT_PUBLIC_*` is inlined at build, switching
tunnel URLs requires a redeploy.

Caveat: `trycloudflare` quick tunnels last only as long as the `cloudflared`
process. For something more permanent, set up a named Cloudflare tunnel (free)
or ngrok with a static domain.
