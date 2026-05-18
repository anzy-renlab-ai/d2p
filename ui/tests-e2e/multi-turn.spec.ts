// E2E coverage for the multi-turn (complex gap autonomous run) preview routes.
// Mock-driven — does not touch daemon or real Claude. Verifies:
//   - panel renders for every phase
//   - turn counter / progress bars update in stream mode
//   - scratchpad appends as turns advance
//   - phase toolbar links navigate between states

import { test, expect } from '@playwright/test';
import { startHarness, type Harness } from './harness.js';

let h: Harness;

test.beforeAll(async () => {
  h = await startHarness();
});

test.afterAll(async () => {
  if (h) await h.teardown();
});

const STATIC_STATES = ['running', 'paused', 'finalizing', 'done'] as const;

for (const state of STATIC_STATES) {
  test(`multi-turn/${state} renders panel without error`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${h.uiUrl}/?preview=multi-turn/${state}`);

    await expect(page.getByText('multi-turn 自治')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId('multi-turn-panel')).toBeVisible();
    await expect(page.getByTestId('multi-turn-headline')).toBeVisible();
    await expect(page.getByTestId('multi-turn-verdict')).toBeVisible();
    await expect(page.getByTestId('multi-turn-phase')).toBeVisible();

    expect(errors, `pageerror on multi-turn/${state}: ${errors.join(', ')}`).toEqual([]);
    await page.screenshot({
      path: `design-screenshots/preview-multi-turn-${state}.png`,
      fullPage: true,
    });
  });
}

test('multi-turn/stream advances headline live', async ({ page }) => {
  await page.goto(`${h.uiUrl}/?preview=multi-turn/stream`);
  await expect(page.getByTestId('multi-turn-panel')).toBeVisible();

  const headline0 = await page.getByTestId('multi-turn-headline').innerText();

  await page.waitForFunction(
    (initial) => {
      const el = document.querySelector('[data-testid="multi-turn-headline"]');
      return el && el.textContent && el.textContent.trim() !== initial.trim();
    },
    headline0,
    { timeout: 10_000 },
  );

  const headline1 = await page.getByTestId('multi-turn-headline').innerText();
  expect(headline1).not.toEqual(headline0);

  // Expand details → scratchpad should have at least one note
  await page.getByTestId('multi-turn-details-toggle').click();
  const padItems = await page.getByTestId('multi-turn-scratchpad').locator('li').count();
  expect(padItems).toBeGreaterThan(0);
});

test('multi-turn toolbar lets you switch between states', async ({ page }) => {
  await page.goto(`${h.uiUrl}/?preview=multi-turn/running`);
  await expect(page.getByTestId('multi-turn-phase')).toHaveText('进行中');

  await page.click('a[href="?preview=multi-turn/finalizing"]');
  await expect(page.getByTestId('multi-turn-phase')).toHaveText('收尾');

  await page.click('a[href="?preview=multi-turn/done"]');
  await expect(page.getByTestId('multi-turn-phase')).toHaveText('完成');
});
