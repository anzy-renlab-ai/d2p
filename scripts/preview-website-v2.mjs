// Quick screenshot pass on website-v2/ for visual review before push.
import { chromium } from 'playwright';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

const ROOT = 'D:/lll/d2p/website-v2';
const PORT = 8181;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.mp4':  'video/mp4',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
};

const server = http.createServer(async (req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  const safe = urlPath === '/' ? '/index.html' : urlPath;
  const full = join(ROOT, safe);
  try {
    const body = await readFile(full);
    res.writeHead(200, { 'Content-Type': MIME[extname(full).toLowerCase()] ?? 'application/octet-stream' });
    res.end(body);
  } catch (e) {
    res.writeHead(404);
    res.end('404');
  }
});

await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
console.log(`> static server :${PORT}`);

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();

const errors = [];
p.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
p.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`); });

await p.goto(`http://127.0.0.1:${PORT}/`);
await p.waitForLoadState('domcontentloaded');
await p.waitForTimeout(2500); // let hero animations settle

// Top of page (hero + pipeline)
await p.screenshot({ path: 'test-results/v2-1-hero.png', fullPage: false });
console.log('  hero shot done');

// Scroll progressively + capture sections
const sections = ['#shift', '#watch', '#gates', '#sworn', '#download'];
for (let i = 0; i < sections.length; i++) {
  await p.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el) el.scrollIntoView({ behavior: 'instant', block: 'start' });
  }, sections[i]);
  await p.waitForTimeout(1100);
  await p.screenshot({ path: `test-results/v2-${i + 2}-${sections[i].replace('#','')}.png` });
  console.log(`  ${sections[i]} shot done`);
}

// Full page
await p.evaluate(() => window.scrollTo(0, 0));
await p.waitForTimeout(400);
await p.screenshot({ path: 'test-results/v2-full.png', fullPage: true });
console.log('  full-page shot done');

if (errors.length) {
  console.log('  errors:');
  for (const e of errors) console.log('   - ' + e);
}

await browser.close();
server.close();
console.log('\n✓ preview pass complete');
