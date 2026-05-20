// Re-record the v2 mini-dashboard alone, isolated, filling the frame.
import { chromium } from 'playwright';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';

const execFileP = promisify(execFile);
const OUT_DIR = 'D:/lll/d2p/tmp/recordings';
const RAW_DIR = path.join(OUT_DIR, 'raw2');
const OUT_FILE = path.join(OUT_DIR, 'zerou-dashboard-tight.mp4');
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

// Hide everything except the live console; center it; scale it up to fill.
await p.evaluate(() => {
  const live = document.querySelector('#live');
  if (!live) return;
  // wipe everything else
  document.querySelectorAll('body > *').forEach((el) => {
    if (el !== document.querySelector('main')) el.style.display = 'none';
  });
  document.querySelectorAll('main > *').forEach((el) => {
    if (!el.contains(live) && el !== live) el.style.display = 'none';
  });
  // ensure live's chain visible
  let n = live;
  while (n && n !== document.body) { n.style.display = ''; n = n.parentElement; }
  // strip section padding so dashboard fills viewport
  live.style.padding = '20px';
  live.style.minHeight = '100vh';
  live.style.display = 'flex';
  live.style.alignItems = 'center';
  // scale the dashboard up
  const dash = document.querySelector('#zerou-console');
  if (dash) {
    dash.style.transform = 'scale(1.32)';
    dash.style.transformOrigin = 'center center';
    dash.style.margin = '0 auto';
  }
  // hide the section's case-label + h2 + summary so only the dashboard shows
  ['.case-label', '#live-h2', '.case-summary'].forEach((sel) => {
    const e = live.querySelector(sel);
    if (e) e.style.display = 'none';
  });
});

// Let dashboard restart its loop with the new layout
await p.waitForTimeout(1500);
// Record 55s of the cycle (the full sequence is ~52s)
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
