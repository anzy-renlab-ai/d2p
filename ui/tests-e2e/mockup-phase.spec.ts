// E2E coverage for the mockup-first phase preview routes.
// Mock-driven — does not touch daemon or real Claude. Verifies:
//   - panel renders for every phase without JS errors
//   - phase toolbar links are present and labeled
//   - key UI elements visible per phase
//   - screenshots to design-screenshots/

import { test, expect } from '@playwright/test';
import { startHarness, type Harness } from './harness.js';

let h: Harness;

test.beforeAll(async () => {
  h = await startHarness();
});

test.afterAll(async () => {
  if (h) await h.teardown();
});

const STATES = ['drafting', 'review', 'revising', 'approved'] as const;

for (const state of STATES) {
  test(`mockup-phase/${state} renders panel without JS error`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto(`${h.uiUrl}/?preview=mockup-phase/${state}`);

    // Toolbar must appear
    await expect(page.getByText('mockup-first phase')).toBeVisible({ timeout: 8_000 });
    // Panel root element
    await expect(page.getByTestId('mockup-phase-panel')).toBeVisible({ timeout: 8_000 });

    expect(errors, `pageerror on mockup-phase/${state}: ${errors.join(', ')}`).toEqual([]);

    await page.screenshot({
      path: `design-screenshots/preview-mockup-phase-${state}.png`,
      fullPage: true,
    });
  });
}

test('mockup-phase/drafting shows spinner and progress text', async ({ page }) => {
  await page.goto(`${h.uiUrl}/?preview=mockup-phase/drafting`);
  await expect(page.getByTestId('mockup-phase-panel')).toBeVisible();
  await expect(page.getByTestId('mockup-drafting-headline')).toContainText('d2p 正在为你画');
  await expect(page.getByTestId('mockup-drafting-progress')).toBeVisible();
});

test('mockup-phase/review shows 3 page thumbnails and action buttons', async ({ page }) => {
  await page.goto(`${h.uiUrl}/?preview=mockup-phase/review`);
  await expect(page.getByTestId('mockup-phase-panel')).toBeVisible();
  // Thumbnails for all 3 demo pages
  await expect(page.getByTestId('mockup-thumb-landing')).toBeVisible();
  await expect(page.getByTestId('mockup-thumb-dashboard')).toBeVisible();
  await expect(page.getByTestId('mockup-thumb-settings')).toBeVisible();
  // Action buttons
  await expect(page.getByTestId('mockup-approve-btn')).toBeVisible();
  await expect(page.getByTestId('mockup-revise-btn')).toBeVisible();
  await expect(page.getByTestId('mockup-skip-btn')).toBeVisible();
});

test('mockup-phase/revising shows revising overlay', async ({ page }) => {
  await page.goto(`${h.uiUrl}/?preview=mockup-phase/revising`);
  await expect(page.getByTestId('mockup-phase-panel')).toBeVisible();
  await expect(page.getByTestId('mockup-revising-mask')).toBeVisible();
  await expect(page.getByTestId('mockup-phase-badge')).toContainText('revising');
});

test('mockup-phase/approved shows approval confirmation and no action buttons', async ({ page }) => {
  await page.goto(`${h.uiUrl}/?preview=mockup-phase/approved`);
  await expect(page.getByTestId('mockup-phase-panel')).toBeVisible();
  await expect(page.getByTestId('mockup-approved-headline')).toContainText('已对齐预期');
  await expect(page.getByTestId('mockup-approved-thumbs')).toBeVisible();
  await expect(page.getByTestId('mockup-approve-btn')).not.toBeVisible();
});

test('mockup-phase toolbar links to all 4 states', async ({ page }) => {
  await page.goto(`${h.uiUrl}/?preview=mockup-phase/review`);
  await expect(page.locator('a[href="?preview=mockup-phase/drafting"]')).toBeVisible();
  await expect(page.locator('a[href="?preview=mockup-phase/review"]')).toBeVisible();
  await expect(page.locator('a[href="?preview=mockup-phase/revising"]')).toBeVisible();
  await expect(page.locator('a[href="?preview=mockup-phase/approved"]')).toBeVisible();
});

test('preview index includes mockup-phase section links', async ({ page }) => {
  await page.goto(`${h.uiUrl}/?preview=index`);
  await expect(page.getByText('Mockup-first phase')).toBeVisible();
  for (const s of STATES) {
    await expect(page.locator(`a[href="?preview=mockup-phase/${s}"]`)).toBeVisible();
  }
});
