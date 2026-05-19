# ZeroU Landing — Vercel Deploy

Production landing for **ZeroU** (formerly d2p). Next.js 14 App Router, TypeScript strict, Tailwind, Framer Motion. No tests — this is a marketing surface.

## Deploy to Vercel

1. Push the `d2p` repo to GitHub (already done: `github.com/Upp-Ljl/d2p`).
2. On vercel.com: **New Project → Import Git Repository** → pick `d2p`.
3. Framework Preset: **Next.js** (auto-detected).
4. **Root Directory: `website/`** ← required (this folder, not the repo root).
5. Build Command: leave default — `next build`.
6. Output Directory: leave default — `.next`.
7. Install Command: leave default — `npm install`.
8. Click **Deploy**.

Subsequent commits to `main` auto-deploy. Every PR gets a preview URL.

## Local dev

```bash
cd website
npm install
npm run dev    # http://localhost:3000
npm run build  # production build, must exit 0
```

## Structure

```
app/
  layout.tsx               root layout, fonts, metadata
  page.tsx                 single landing page
  globals.css              tailwind + reset + reduced-motion
  components/
    Hero.tsx               hero with mini-dashboard animation
    HeroDashboard.tsx      10s loop: 6 agents + commit timeline
    HowItWorks.tsx         4-step section
    Features.tsx           container for 3 feature rows
    ReviewerPipeline.tsx   5s loop: 4 reviewer nodes
    AgentBoard.tsx         6s loop: 6-agent grid
    PrCardMock.tsx         scroll-triggered PR modal
    CaseStudy.tsx          count-up data + commit timeline
    TechCredibility.tsx    logo wall + claims
    Cta.tsx                final CTA
    Footer.tsx
    LangToggle.tsx         zh ⇄ en context toggle
    primitives/
      ScrollFadeIn.tsx
      CountUp.tsx
      ChipBadge.tsx
      AgentCard.tsx
```

## i18n

The page ships English by default. The top-right `zh / en` button flips a React context-backed locale; choice is persisted in `localStorage` as `zerou-lang`. The `<html lang>` attribute is kept in sync.

## Real data baked into the page

- Project: `agent-game-platform` (Next.js + Bun, poker spectator platform)
- Duration: `1h 31min`
- Cost: `$4.24`
- Tokens: `454,674 in / 237,787 out`
- Merged commits: `5aedd6e`, `4b58841`, `3d2ad5f`, `53df272`
- Real PR: <https://github.com/anzy-renlab-ai/agent-game-platform/pull/6>
