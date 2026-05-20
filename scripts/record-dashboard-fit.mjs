// Record dashboard with viewport matched to dashboard size, then upscale.
import { chromium } from 'playwright';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';

const execFileP = promisify(execFile);
const OUT_DIR = 'D:/lll/d2p/tmp/recordings';
const RAW_DIR = path.join(OUT_DIR, 'raw4');
const OUT_FILE = path.join(OUT_DIR, 'zerou-dashboard-fit.mp4');
const FFMPEG = 'D:/pitchkit-sandbox/pitchkit/node_modules/@ffmpeg-installer/win32-x64/ffmpeg.exe';

await mkdir(RAW_DIR, { recursive: true });

// Smaller viewport (closer to dashboard natural width); record, then ffmpeg scale to 1920x1080 with pad
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 600 },
  recordVideo: { dir: RAW_DIR, size: { width: 1280, height: 600 } },
  deviceScaleFactor: 1.5,
});
const p = await ctx.newPage();
await p.goto('http://127.0.0.1:8181/#live');
await p.waitForLoadState('domcontentloaded');
await p.waitForTimeout(800);

await p.evaluate(() => {
  document.body.querySelectorAll(':scope > *').forEach((el) => {
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
    live.style.padding = '20px 0';
    live.style.minHeight = '100vh';
    live.style.display = 'flex';
    live.style.alignItems = 'center';
    live.style.justifyContent = 'center';
    ['.case-label', '#live-h2', '.case-summary'].forEach((sel) => {
      const e = live.querySelector(sel);
      if (e) e.style.display = 'none';
    });
    const container = live.querySelector('.container');
    if (container) {
      container.style.maxWidth = 'none';
      container.style.padding = '0 24px';
      container.style.width = '100%';
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

// Scale up to 1920x1080 with pad (letterbox in mint-tinted dark)
await execFileP(FFMPEG, [
  '-y', '-i', src,
  '-vf', 'scale=1920:-2:flags=lanczos,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0x0A0A0A',
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
  '-pix_fmt', 'yuv420p',
  '-movflags', '+faststart',
  '-an',
  OUT_FILE,
]);
await rm(RAW_DIR, { recursive: true, force: true });
console.log('  output:', OUT_FILE);
