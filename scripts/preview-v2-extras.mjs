import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
p.on('console', (m) => { if (m.type() === 'error') errs.push('console.error: ' + m.text()); });
await p.goto('http://127.0.0.1:8181/');
await p.waitForLoadState('domcontentloaded');
await p.waitForTimeout(2500);
for (const sel of ['#live', '#overnight', '#gates', '#shift']) {
  try {
    await p.evaluate((s) => document.querySelector(s)?.scrollIntoView({ block: 'start' }), sel);
    await p.waitForTimeout(1600);
    await p.screenshot({ path: 'test-results/v2x-' + sel.replace('#','') + '.png' });
    console.log('  shot', sel);
  } catch (e) { console.log('  fail', sel, e.message); }
}
if (errs.length) {
  console.log('\nerrors:');
  for (const e of errs) console.log('  -', e);
}
await browser.close();
