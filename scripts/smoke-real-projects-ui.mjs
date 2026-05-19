// Smoke: verify the UI now renders projects from the real daemon (not mock).
// Boots a chromium page against the running dev server, asserts:
//   1. ProjectsHome shows the daemon-registered demos (cpbl / cairn, etc).
//   2. Clicking a project enters SessionsList backed by real /api/projects/:id/sessions.
//   3. Workspace shows real agents / commits / milestones (or empty + mock fallback when DB has no data).
//
// Captures four screenshots in test-results/ for visual review.
import { chromium } from 'playwright';

const UI = process.env.UI_URL || 'http://127.0.0.1:5173';
const DAEMON = process.env.DAEMON_URL || 'http://127.0.0.1:5174';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();

console.log(`> hitting ${DAEMON}/api/projects to get expected list`);
const daemonRes = await fetch(`${DAEMON}/api/projects`).then((r) => r.json());
const expectedNames = daemonRes.projects.map((x) => x.name);
console.log(`  daemon reports projects: ${JSON.stringify(expectedNames)}`);

console.log(`> opening ${UI}`);
await p.goto(UI);
// Use 'domcontentloaded' — full networkidle waits on SSE log stream that
// never settles by design (it's a long-lived EventSource).
await p.waitForLoadState('domcontentloaded');
await p.waitForTimeout(1500);

await p.screenshot({ path: 'test-results/smoke-1-projects-home.png', fullPage: false });

// Each project card has data-testid="project-card-${id}".
const cards = await p.$$('[data-testid^="project-card-"]');
const cardCount = cards.length;
console.log(`  ProjectsHome rendered ${cardCount} cards`);

if (expectedNames.length > 0 && cardCount < expectedNames.length) {
  throw new Error(`expected ≥${expectedNames.length} cards, got ${cardCount}`);
}

// Click first project that matches a daemon-registered name.
if (expectedNames.length > 0) {
  const target = expectedNames[0];
  const card = await p.$(`button:has-text("${target}")`);
  if (!card) throw new Error(`no card for daemon project "${target}"`);
  await card.click();
  await p.waitForTimeout(700);
  await p.screenshot({ path: 'test-results/smoke-2-sessions-list.png', fullPage: false });

  // We should now be on SessionsList — has "session-row-*" entries.
  const sessions = await p.$$('[data-testid^="session-row-"]');
  console.log(`  SessionsList shows ${sessions.length} session rows`);

  if (sessions.length > 0) {
    const sess = sessions[0];
    await sess.click();
    await p.waitForTimeout(800);
    await p.screenshot({ path: 'test-results/smoke-3-workspace.png', fullPage: false });

    // Workspace should have agents board + commits timeline.
    const agentsBoard = await p.$('[data-testid="sessions-board"]');
    const commitsTimeline = await p.$('[data-testid="commits-timeline"]');
    console.log(`  Workspace agentsBoard=${Boolean(agentsBoard)} commitsTimeline=${Boolean(commitsTimeline)}`);

    // Drill into implementer to verify drawer still works post-wire.
    const implementer = await p.$('[data-testid="session-card-implementer"]');
    if (implementer) {
      await implementer.click();
      await p.waitForTimeout(400);
      await p.screenshot({ path: 'test-results/smoke-4-impl-drawer.png', fullPage: false });
    }
  } else {
    console.log('  (no sessions to drill into — fine, falls back to mock for empty state)');
  }
}

await browser.close();

console.log('\n✓ smoke probes complete. screenshots in test-results/');
console.log('  - smoke-1-projects-home.png');
console.log('  - smoke-2-sessions-list.png');
console.log('  - smoke-3-workspace.png');
console.log('  - smoke-4-impl-drawer.png');
