import { test, expect } from '@playwright/test';
import path from 'node:path';
import { startHarness, type Harness } from './harness.js';

let h: Harness;

test.beforeAll(async () => {
  h = await startHarness();
});

test.afterAll(async () => {
  if (h) await h.teardown();
});

test('Full session: Landing → Setup → Workspace shows live events → reach DONE', async ({ page }) => {
  await page.goto(h.uiUrl);

  // Type demo path + start
  const demoDir = path.join(h.tmpDir, 'demo-cli');
  await page.getByRole('textbox').fill(demoDir);
  await page.getByRole('button', { name: /Start session/ }).click();

  // Setup page: detector heading appears (Step 1 — 项目类型)
  await expect(page.getByText('Step 1 — 项目类型')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/cli-tool|saas-web|library/).first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: '确认' }).click();

  // Vision finalizes in round 1 with fake claude
  await expect(page.getByText(/Step 2/).first()).toBeVisible();
  await expect(page.getByText(/✓ vision 已定稿/)).toBeVisible({ timeout: 30_000 });

  // Start loop
  await page.getByRole('button', { name: /Start loop/ }).click();

  // Workspace: GapList + RunLog visible
  await expect(page.getByText('Gap 队列')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/Live Run Log/)).toBeVisible();

  // Settings button still reachable from Workspace
  await expect(page.getByRole('button', { name: /⚙ 设置/ })).toBeVisible();

  // Hard proof end-to-end: daemon emits MERGED via the loop (poll the API
  // directly — robust to UI virtualization / scroll position).
  await expect
    .poll(
      async () => {
        const res = await page.request.get(`${h.daemonUrl}/api/log/events?limit=200`);
        const j = (await res.json()) as { events: { kind: string }[] };
        return j.events.filter((e) => e.kind === 'MERGED').length;
      },
      { timeout: 120_000, intervals: [1000, 2000, 5000] },
    )
    .toBeGreaterThan(0);

  // Session reaches a terminal state (Done.tsx auto-calls /session/end on
  // DONE, so we accept either DONE or ENDED).
  await expect
    .poll(
      async () => {
        const res = await page.request.get(`${h.daemonUrl}/api/session/current`);
        const j = (await res.json()) as { session: { status: string } | null };
        return j.session?.status ?? 'none';
      },
      { timeout: 60_000, intervals: [1000, 2000] },
    )
    .toMatch(/^(DONE|ENDED)$/);

  // Take a screenshot so we have visual evidence the Workspace UI was alive.
  await page.screenshot({ path: 'playwright-report/workspace-final.png', fullPage: true });
});
