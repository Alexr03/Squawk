// PWA check against a production build: manifest served, service worker active, shell precached, opens offline.
// Usage: pnpm --filter @squawk/web build && pnpm --filter @squawk/web preview, then node tools/pwa.mjs [url]
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:4173/';
const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`); if (!cond) process.exitCode = 1; };

await page.goto(url);
const href = await page.getAttribute('link[rel=manifest]', 'href');
const manifest = await (await page.request.get(new URL(href, url).href)).json();
ok(manifest.name === 'Squawk' && manifest.display === 'standalone' && manifest.theme_color === '#070e1c', `manifest served (${href})`);
for (const icon of manifest.icons) ok((await page.request.get(new URL(icon.src, new URL(href, url)).href)).headers()['content-type'] === 'image/png', `icon ${icon.src} ${icon.purpose ?? ''}`);
ok(await page.getAttribute('meta[name=theme-color]', 'content') === '#070e1c', 'theme-color meta');

const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
ok(!!scope, `service worker active (scope ${scope})`);
await page.waitForTimeout(1000);
const cached = await page.evaluate(async () => {
  const out = [];
  for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) out.push(`${k} ${new URL(r.url).pathname}`);
  return out;
});
ok(cached.some(c => /shell.*\/assets\/main-.*\.js$/.test(c)) && cached.some(c => c.endsWith('.woff2')), `app shell precached (${cached.length} entries)`);
ok(!cached.some(c => /transformers|ort-wasm/.test(c)), 'transformers chunk not cached');

// Open the free-shift setup so a data pack is fetched, then check it's cached on first use.
await page.reload();
await page.getByRole('button', { name: /^Free shift/ }).click();
await page.getByRole('button', { name: 'Start shift' }).click();
await page.waitForTimeout(4000);
const packs = await page.evaluate(async () => (await (await caches.open('squawk-assets')).keys()).map(r => new URL(r.url).pathname).filter(p => p.endsWith('.json')));
ok(packs.length > 0, `data packs cached on first use: ${packs.join(', ')}`);

await ctx.setOffline(true);
await page.goto(url);
ok(await page.getByRole('button', { name: /^Free shift/ }).isVisible(), 'opens offline from the cache');
await browser.close();
