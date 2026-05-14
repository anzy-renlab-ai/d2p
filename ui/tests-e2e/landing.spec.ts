import { test, expect } from '@playwright/test';
import { startHarness, type Harness } from './harness.js';

let h: Harness;

test.beforeAll(async () => {
  h = await startHarness();
});

test.afterAll(async () => {
  if (h) await h.teardown();
});

test('Landing renders, health badge healthy, ⚙ button reachable', async ({ page }) => {
  await page.goto(h.uiUrl);
  await expect(page.getByRole('heading', { name: 'd2p' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Start session/ })).toBeVisible();

  // Health badge should turn healthy within a few SSE roundtrips
  await expect(page.locator('text=healthy')).toBeVisible({ timeout: 15_000 });

  // Settings button is visible from Landing top-right
  await expect(page.getByRole('button', { name: /⚙ 设置/ })).toBeVisible();
});

test('Opens Settings page and shows three engine kinds', async ({ page }) => {
  await page.goto(h.uiUrl);
  await page.getByRole('button', { name: /⚙ 设置/ }).click();
  await expect(page.getByText('LLM 引擎')).toBeVisible();
  await expect(page.getByRole('radio', { name: 'claude-cli' })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'openai-compat' })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'anthropic-api' })).toBeVisible();
});

test('Picking openai-compat reveals quick presets (incl. MiniMax)', async ({ page }) => {
  await page.goto(h.uiUrl);
  await page.getByRole('button', { name: /⚙ 设置/ }).click();
  await page.getByRole('radio', { name: 'openai-compat' }).click();
  await expect(page.getByText('快速预设')).toBeVisible();
  await expect(page.getByRole('button', { name: 'MiniMax' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'OpenRouter' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'DeepSeek' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Z\.ai/ })).toBeVisible();
});

test('MiniMax preset fills baseUrl + MiniMax-M2 models', async ({ page }) => {
  await page.goto(h.uiUrl);
  await page.getByRole('button', { name: /⚙ 设置/ }).click();
  await page.getByRole('radio', { name: 'openai-compat' }).click();
  await page.getByRole('button', { name: 'MiniMax' }).click();
  await expect(page.locator('input[value="https://api.minimaxi.chat/v1"]')).toBeVisible();
  await expect(page.locator('input[value="MiniMax-M2"]').first()).toBeVisible();
});

test('OpenRouter preset fills baseUrl + model fields', async ({ page }) => {
  await page.goto(h.uiUrl);
  await page.getByRole('button', { name: /⚙ 设置/ }).click();
  await page.getByRole('radio', { name: 'openai-compat' }).click();
  await page.getByRole('button', { name: 'OpenRouter' }).click();
  await expect(page.locator('input[value="https://openrouter.ai/api/v1"]')).toBeVisible();
  await expect(page.locator('input[value="anthropic/claude-3-5-haiku"]')).toBeVisible();
});

test('Saving config without API key shows error inline', async ({ page }) => {
  await page.goto(h.uiUrl);
  await page.getByRole('button', { name: /⚙ 设置/ }).click();
  await page.getByRole('radio', { name: 'openai-compat' }).click();
  await page.getByRole('button', { name: /保存设置/ }).click();
  await expect(page.getByText(/API key 不能为空/)).toBeVisible();
});
