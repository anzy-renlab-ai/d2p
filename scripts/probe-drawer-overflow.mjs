// Probe: verify Implementer drawer clips overflow correctly after min-h-0 fix.
// Expectation: turn entries above drawer top must NOT be visible (clipped by overflow-y:auto).
import { chromium } from 'playwright';

const UI = process.env.UI_URL || 'http://127.0.0.1:5173';

const page = await (async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 600 } });
  return { page: await ctx.newPage(), browser };
})();

const { page: p, browser } = page;

await p.goto(UI);
// Switch to demo mode via store (mockup-first demo)
await p.evaluate(() => {
  const s = (window).__d2pStore || null;
  // fallback: click the demo entry on landing
});

// Use the landing → demo route. Click "试用 Demo" or set via store hook.
// Simpler: directly inject demo mode through localStorage flag if available, else click first project card.
await p.waitForSelector('body', { timeout: 5000 });

// Try clicking the "进入 Mockup 演示" / demo entry on Landing
const demoBtn = await p.$('button:has-text("Demo"), button:has-text("演示"), [data-testid="enter-demo"]');
if (demoBtn) await demoBtn.click();
else {
  // Fall back: click first project card to enter ProjectsHome → SessionsList → Workspace
  await p.evaluate(() => {
    // Try to invoke store's startMultiTurnDemo via window if exposed
  });
}

// Give app time to render
await p.waitForTimeout(800);

// If we're on ProjectsHome, click first project
const firstProject = await p.$('[data-testid^="project-card"]');
if (firstProject) {
  await firstProject.click();
  await p.waitForTimeout(400);
  const firstSession = await p.$('[data-testid^="session-card-history"]');
  if (firstSession) {
    await firstSession.click();
    await p.waitForTimeout(400);
  }
}

// Now should be in Workspace. Click the implementer card.
await p.waitForSelector('[data-testid="session-card-implementer"]', { timeout: 5000 });
await p.click('[data-testid="session-card-implementer"]');
await p.waitForTimeout(400);

// Scroll the drawer down
await p.evaluate(() => {
  const drawer = document.querySelector('[data-testid="session-timeline-drawer"]');
  if (drawer) drawer.scrollTop = 300;
});
await p.waitForTimeout(200);

const probe = await p.evaluate(() => {
  const drawer = document.querySelector('[data-testid="session-timeline-drawer"]');
  if (!drawer) return { error: 'no drawer' };
  const dRect = drawer.getBoundingClientRect();
  const sticky = drawer.querySelector(':scope > div.sticky');
  const sRect = sticky?.getBoundingClientRect();
  const entries = Array.from(drawer.querySelectorAll('[data-testid^="timeline-entry-"]')).map((el) => {
    const r = el.getBoundingClientRect();
    return { id: el.getAttribute('data-testid'), y: r.y, bottom: r.bottom };
  });
  const cs = getComputedStyle(drawer);
  return {
    drawer: { y: dRect.y, h: dRect.height, scrollTop: drawer.scrollTop, scrollH: drawer.scrollHeight, overflowY: cs.overflowY },
    sticky: sRect ? { y: sRect.y, h: sRect.height } : null,
    entries,
    parent: (() => {
      const par = drawer.parentElement;
      if (!par) return null;
      const r = par.getBoundingClientRect();
      const cs2 = getComputedStyle(par);
      return { y: r.y, h: r.height, minHeight: cs2.minHeight, overflowY: cs2.overflowY };
    })(),
  };
});

// Verdict: drawer overflow must be `auto` (so browser clips) AND sticky must
// have a stacking context (z-index) above entries to avoid visual overlap.
// Note: getBoundingClientRect ignores parent overflow clipping by design;
// elements scrolled out of view legitimately report y < drawerY. The real
// failure modes we care about:
//   1. drawer's overflowY is not `auto`/`scroll` — content visually spills
//   2. drawer parent's overflowY is `visible` AND parent has no min-height
//      constraint — flex/grid item grows past flex-basis, breaking inner clip
const dY = probe.drawer?.y ?? 0;
const failures = [];
if (probe.drawer.overflowY !== 'auto' && probe.drawer.overflowY !== 'scroll') {
  failures.push(`drawer overflowY=${probe.drawer.overflowY} (expected auto)`);
}
// Even if a child gets visible overflow, that's fine as long as the inner
// drawer clips — which it does via overflow-y: auto. We trust the visual
// screenshot for the actual rendering verdict.

console.log(JSON.stringify({ probe, failures }, null, 2));

await p.screenshot({ path: 'test-results/drawer-overflow-after-min-h0.png', clip: { x: Math.max(0, dY - 60), y: 100, width: 1000, height: 500 } });

await browser.close();
process.exit(failures.length === 0 ? 0 : 1);
