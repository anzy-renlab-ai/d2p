// Regenerates the 4 ZeroU dashboard screenshots used by the official site
// (site/public/dashboards/0?-*.png).
//
// Strategy:
//   1. Spawn a Vite dev server (no daemon — the UI falls back to mock data
//      for projects / sessions, and demo mode renders the Workspace with
//      full mock state). This keeps the screenshot path hermetic.
//   2. Drive Chromium with Playwright, set locale to English via localStorage,
//      and shoot each frame.
//   3. Write 1440×900 viewport PNGs straight into site/public/dashboards/.
//
// Run with:  node scripts/regen-site-screenshots.mjs

import { spawn } from 'node:child_process';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uiRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(uiRoot, '..');
const outDir = path.join(repoRoot, 'site', 'public', 'dashboards');

async function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, () => {
      const addr = srv.address();
      if (!addr || typeof addr !== 'object') return reject(new Error('no port'));
      const p = addr.port;
      srv.close(() => resolve(p));
    });
  });
}

async function waitForHttp(url, timeoutMs = 60_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`waitForHttp(${url}) timed out`);
}

async function main() {
  const port = await freePort();
  const viteBin = path.join(repoRoot, 'node_modules', 'vite', 'bin', 'vite.js');
  const vite = spawn(
    process.execPath,
    [viteBin, '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    { cwd: uiRoot, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  vite.stdout.on('data', (b) => process.stderr.write(`[vite] ${b}`));
  vite.stderr.on('data', (b) => process.stderr.write(`[vite-err] ${b}`));

  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await waitForHttp(`${baseUrl}/`);

    const browser = await chromium.launch();
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
    });
    // Pre-seed English locale so wordmark + labels match prior screenshots.
    await ctx.addInitScript(() => {
      try { window.localStorage.setItem('d2p.locale', 'en'); } catch {}
    });

    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('[pageerror]', e.message, '\n', e.stack));
    page.on('console', (msg) => {
      if (msg.type() === 'error') console.error('[console.error]', msg.text());
    });

    // Fake the daemon endpoints so the daemon-down banner stays hidden and
    // mock data renders cleanly. Health returns a healthy stub; the rest
    // return empty arrays so the UI keeps its mock fallback.
    await ctx.route('**/api/health', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          daemonVersion: '0.1.0',
          promptsVersion: 1,
          claudeCli: { found: true, version: '2.1.81' },
          gitCli: { found: true, version: '2.51.2' },
          dbPath: 'C:\\Users\\jushi\\.zerou\\state.db',
          uptimeMs: 1234567,
        }),
      }),
    );
    await ctx.route('**/api/projects', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ projects: [] }) }),
    );
    await ctx.route('**/api/sessions*', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sessions: [] }) }),
    );
    await ctx.route('**/api/projects/*/sessions', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sessions: [] }) }),
    );
    await ctx.route('**/api/session/current', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          session: null,
          demo: null,
          presetStatus: [],
          costTotals: { inputTokens: 0, outputTokens: 0, estimatedUsd: 0 },
        }),
      }),
    );
    await ctx.route('**/api/loop/state', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ isRunning: false, pauseRequested: false, sessionId: null }),
      }),
    );
    await ctx.route('**/api/commits**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ commits: [] }) }),
    );
    await ctx.route('**/api/milestones', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ milestones: [] }) }),
    );
    await ctx.route('**/api/log/stream', (route) =>
      route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' }),
    );

    // ── 01-home: Projects list ────────────────────────────────────────
    await page.goto(baseUrl + '/');
    // Wait for the ProjectsHome heading.
    await page.getByRole('heading', { name: 'ZeroU' }).first().waitFor({ timeout: 15_000 });
    // Give animations a beat.
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(outDir, '01-home.png') });
    console.log('wrote 01-home.png');

    // ── 02-sessions: pick first project → SessionsList ────────────────
    // Project cards are anchors with the project name; click the first one.
    // The first card in mockProjects is `agent-game-platform`.
    await page.getByText('agent-game-platform', { exact: false }).first().click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(outDir, '02-sessions.png') });
    console.log('wrote 02-sessions.png');

    // ── 03-workspace: enter demo mode for offline Workspace ───────────
    // Back to projects list, click "Try multi-turn demo →"
    await page.goto(baseUrl + '/');
    await page.getByRole('heading', { name: 'ZeroU' }).first().waitFor({ timeout: 15_000 });
    await page.getByText(/Try multi-turn demo/).click();
    // Workspace renders — wait for the back-to-projects button.
    await page.waitForTimeout(1500);
    // Dismiss the SessionResumeBanner (demo-mode artifact) if it appears so
    // the canvas matches the production screenshot rhythm.
    const resumeDismiss = page.getByRole('button', { name: /稍后|Later/ });
    if (await resumeDismiss.count()) {
      await resumeDismiss.first().click().catch(() => undefined);
      await page.waitForTimeout(400);
    }
    // Hide the demo-mode coral banner via injected CSS — it's a demo
    // artifact, not part of the production look.
    await page.addStyleTag({ content: '.bg-coral\\/10.border-b { display: none !important; }' });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(outDir, '03-workspace.png') });
    console.log('wrote 03-workspace.png');

    // ── 04-presets: open the Checklist drawer in StatusStrip ──────────
    // The PresetKpi button shows label "Checklist" in English.
    await page.getByRole('button', { name: /Checklist/i }).first().click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(outDir, '04-presets.png') });
    console.log('wrote 04-presets.png');

    await browser.close();
  } finally {
    try { vite.kill('SIGTERM'); } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
