// Record the v2 mini-dashboard as 1920x1080 mp4 for the pitchkit storyboard.
// Uses Playwright's video recording, then ffmpegs into clean mp4.
import { chromium } from 'playwright';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';

const execFileP = promisify(execFile);

const OUT_DIR = 'D:/lll/d2p/tmp/recordings';
const RAW_DIR = path.join(OUT_DIR, 'raw');
const OUT_FILE = path.join(OUT_DIR, 'zerou-dashboard.mp4');
const FFMPEG = 'D:/pitchkit-sandbox/pitchkit/node_modules/@ffmpeg-installer/win32-x64/ffmpeg.exe';

await mkdir(RAW_DIR, { recursive: true });

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  recordVideo: { dir: RAW_DIR, size: { width: 1920, height: 1080 } },
});
const p = await ctx.newPage();

await p.goto('http://127.0.0.1:8181/#live');
await p.waitForLoadState('domcontentloaded');

// Ensure the live console is in view immediately and animations have time to settle
await p.waitForTimeout(500);
await p.evaluate(() => document.querySelector('#live')?.scrollIntoView({ block: 'center' }));
await p.waitForTimeout(800);

// Record one full cycle (~52s) + 2s slack
await p.waitForTimeout(55_000);

await ctx.close(); // flushes the video
await browser.close();

// Find the most recent .webm and ffmpeg it to mp4 (H.264, faststart)
const files = (await readdir(RAW_DIR)).filter((f) => f.endsWith('.webm'));
if (!files.length) throw new Error('no webm recorded');
const src = path.join(RAW_DIR, files.sort().pop());
console.log('  source:', src);

await execFileP(FFMPEG, [
  '-y', '-i', src,
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
  '-pix_fmt', 'yuv420p',
  '-movflags', '+faststart',
  '-an',
  OUT_FILE,
]);
console.log('  output:', OUT_FILE);

// Clean up the raw webm
await rm(RAW_DIR, { recursive: true, force: true });
console.log('\n✓ recording done');
