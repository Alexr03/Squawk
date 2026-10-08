// Screenshot helper for visual checks: node tools/shot.mjs <url|file> <out.png> [width] [height] [waitMs] [script.js]
// The optional script runs in the page after load (e.g. to click through menus) and may return a value, which is printed.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const [src, out, w = '1600', h = '900', wait = '1000', script] = process.argv.slice(2);
const url = /^https?:/.test(src) ? src : pathToFileURL(src).href;
const browser = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--use-angle=d3d11', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push(String(e)));
await page.goto(url);
await page.waitForTimeout(+wait);
if (script) {
  const r = await page.evaluate(readFileSync(script, 'utf8'));
  if (r !== undefined) console.log('RESULT', JSON.stringify(r));
  await page.waitForTimeout(500);
}
await page.screenshot({ path: out });
if (errors.length) console.log('PAGE ERRORS:\n' + errors.slice(0, 20).join('\n'));
await browser.close();
