# ZeroU · landing v2 (Claude-Design-style)

A vanilla HTML / CSS / JS landing page for ZeroU, designed in parallel to the Pace landing reference. Inverts the warm-paper Pace palette to a **dark mission-console + mint accent** aesthetic while keeping the same dossier-style "case file" rhythm. Zero build step, zero dependencies, zero JS framework.

## Files

```
website-v2/
├── index.html       ← 6 sections (Hero → 3 shift cases → 4 gates → 5 sworn → CTA)
├── styles.css       ← Design tokens + all motion (no Tailwind / no build)
├── script.js        ← Scroll progress, reveal stagger, pipeline animation, copy CTA
├── zerou-demo.mp4   ← 62s production demo video (autoplay/loop/muted in Theatre section)
└── vercel.json      ← static-site config (no framework, no build command)
```

## Vercel deploy — one-time setup

1. Push the parent `d2p` repo to GitHub (already done at `github.com/Upp-Ljl/d2p`).
2. On vercel.com → **New Project → Import this repo**.
3. **Framework Preset: Other** (or leave blank — `vercel.json` sets framework: null).
4. **Root Directory: `website-v2/`** ← must set this manually.
5. Build Command: (leave empty — static site).
6. Output Directory: (leave empty / `.`).
7. Click **Deploy**.

Subsequent commits to main → auto-deploy. Every PR → preview URL.

## Custom domain (zerou.renlab.ai)

In Vercel → Settings → Domains → Add → `zerou.renlab.ai`. Vercel will show DNS records to give your DNS owner; record types follow the same shape as:

```
CNAME  zerou      <vercel-cname-target>.vercel-dns-017.com.
TXT    _vercel    vc-domain-verify=zerou.renlab.ai,<verify-token>
```

## Local preview

No build step. Open `index.html` directly in a browser, or run any static server:

```
cd website-v2
python3 -m http.server 8000
# → http://localhost:8000
```

## Design rationale

- **Inverts Pace's paper-warm palette** (#ece4d2 paper / #b2382b red) → **#0A0A0A bg + #7CFFB2 mint accent**. Matches the production demo video's own visual language so eye stays inside one aesthetic.
- **Preserves Pace's structural rhythm**: docket → hero → case files → sworn promises → affirmation → CTA. Each section is a complete narrative unit, not a feature list.
- **Switches the metaphor**: Pace = case file / dossier (PI investigating your work). ZeroU = **overnight shift log** (factory mid-shift ledger, 4 stamps per fix, NEED_HUMAN published transparently).
- **One paper-receipt section** mid-page provides the dark→paper→dark beat — a literal printed PR body excerpt as proof, not abstraction.
- **Real data only**: every number on the page (`1h 31min`, `$4.24`, `2 / 28`, `24 NEED_HUMAN`, commit sha `5aedd6e`, PR #6) comes from the actual agent-game-platform run, not a marketing mock.

## Motion inventory (all CSS keyframes or RAF, no library)

| element                       | technique                                              |
| ----------------------------- | ------------------------------------------------------ |
| Docket scroll progress        | scaleX transform driven by scroll handler              |
| Hero H1 fragment stagger      | CSS keyframe `heroFragIn` + per-fragment `--d` delay   |
| Mint accent_em underline      | `markerDraw` + `markerSettle` keyframes                |
| Vision/CSS redact reveal      | `redactReveal` keyframe with per-element `--rd` delay  |
| Live reviewer pipeline (4-stage cycle) | RAF + state machine in script.js (3 scenarios) |
| Exhibit dog-ear on hover      | CSS `::after` border-width transition                  |
| Verdict "已点火/已合并" stamp  | `stampThud` keyframe, IO-triggered                     |
| Counter ticker (review meta)  | RAF easeOutCubic in script.js                          |
| Case watermark slide-in       | IO-triggered translateX                                 |
| Reveal-on-scroll stagger      | IO + per-element `--reveal-d`                          |
| Button hover shimmer          | `::before` translateX gradient                         |

## What's intentionally _not_ here

- No React / Next.js / build step
- No external JS framework (no jQuery, no Alpine, no Lottie)
- No analytics / no tracking
- No marketing fluff in copy ("AI-powered", "revolutionary", "10x" — all banned)
- No founder photo / no team grid (Pace doesn't have one either; ZeroU follows suit)
- No `<form>` / no email capture (download via git clone, that's the funnel)
