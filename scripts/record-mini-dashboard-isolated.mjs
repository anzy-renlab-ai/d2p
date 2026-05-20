// Re-record the v2 mini-dashboard — isolated, centered, full-screen.
import { chromium } from 'playwright';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';

const execFileP = promisify(execFile);
const OUT_DIR = 'D:/lll/d2p/tmp/recordings';
const RAW_DIR = path.join(OUT_DIR, 'raw3');
const OUT_FILE = path.join(OUT_DIR, 'zerou-dashboard-iso.mp4');
const FFMPEG = 'D:/pitchkit-sandbox/pitchkit/node_modules/@ffmpeg-installer/win32-x64/ffmpeg.exe';

await mkdir(RAW_DIR, { recursive: true });

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  recordVideo: { dir: RAW_DIR, size: { width: 1920, height: 1080 } },
  deviceScaleFactor: 1,
});
const p = await ctx.newPage();
await p.goto('http://127.0.0.1:8181/#live');
await p.waitForLoadState('domcontentloaded');
await p.waitForTimeout(800);

// Override the page entirely — render ONLY the live console centered + scaled.
await p.evaluate(() => {
  // Add full-screen overlay
  const stage = document.createElement('div');
  stage.style.cssText = `
    position: fixed; inset: 0;
    background: #0A0A0A;
    z-index: 99999;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 40px;
    box-sizing: border-box;
  `;
  document.body.appendChild(stage);

  // Move the live console into the overlay
  const live = document.querySelector('#live .container');
  if (!live) return;
  const liveClone = live.cloneNode(true);
  stage.appendChild(liveClone);

  // Strip the section header (case-label / h2 / summary) so we just see the console
  ['.case-label', '#live-h2', '.case-summary'].forEach((sel) => {
    const e = liveClone.querySelector(sel);
    if (e) e.style.display = 'none';
  });

  const dash = liveClone.querySelector('#zerou-console');
  if (dash) {
    dash.style.transform = 'scale(1.42)';
    dash.style.transformOrigin = 'center center';
    dash.style.margin = '160px auto';
  }
});

// Wait, the cloned dashboard isn't running its JS animation. Better: hide
// everything else but keep the original live console in place + style it.
await p.evaluate(() => {
  // Remove the overlay we just added
  const overlays = document.querySelectorAll('div[style*="z-index: 99999"]');
  overlays.forEach((o) => o.remove());

  // Hide all top-level main children except #live, plus the docket and footer
  const body = document.body;
  body.querySelectorAll(':scope > *').forEach((el) => {
    if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE') return;
    if (el.matches('.docket, .footer, .grain')) el.style.display = 'none';
  });
  const main = document.querySelector('main');
  if (main) {
    main.querySelectorAll(':scope > *').forEach((el) => {
      if (el.id !== 'live') el.style.display = 'none';
    });
  }
  const live = document.querySelector('#live');
  if (live) {
    live.style.padding = '40px 0';
    live.style.minHeight = '100vh';
    live.style.display = 'flex';
    live.style.alignItems = 'center';
    live.style.justifyContent = 'center';
    // hide title/summary so only dashboard is seen
    ['.case-label', '#live-h2', '.case-summary'].forEach((sel) => {
      const e = live.querySelector(sel);
      if (e) e.style.display = 'none';
    });
    const container = live.querySelector('.container');
    if (container) {
      container.style.maxWidth = 'none';
      container.style.padding = '0 60px';
      container.style.width = '100%';
    }
    const dash = live.querySelector('#zerou-console');
    if (dash) {
      dash.style.transform = 'scale(1.45)';
      dash.style.transformOrigin = 'center center';
      dash.style.margin = '0 auto';
    }
  }
});

await p.waitForTimeout(1500);
await p.waitForTimeout(55_000);

await ctx.close();
await browser.close();

const files = (await readdir(RAW_DIR)).filter((f) => f.endsWith('.webm'));
if (!files.length) throw new Error('no webm recorded');
const src = path.join(RAW_DIR, files.sort().pop());
await execFileP(FFMPEG, [
  '-y', '-i', src,
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
  '-pix_fmt', 'yuv420p',
  '-movflags', '+faststart',
  '-an',
  OUT_FILE,
]);
await rm(RAW_DIR, { recursive: true, force: true });
console.log('  output:', OUT_FILE);
