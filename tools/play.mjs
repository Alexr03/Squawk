// Scripted play-through for visual checks: node tools/play.mjs <url> <scenario.mjs> <outDir>
// The scenario module exports default async (page, shot) => {}; shot(name) saves <outDir>/<name>.png.
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { mkdirSync } from 'node:fs';

const [url, scenario, out = '.'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--use-angle=d3d11', '--enable-gpu', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', e => errors.push('pageerror: ' + (e.stack ?? e)));
await page.goto(url);
const shot = async name => { await page.screenshot({ path: `${out}/${name}.png` }); console.log('shot', name); };
const mod = await import(pathToFileURL(scenario).href);
try { await mod.default(page, shot); } catch (e) { console.log('SCENARIO ERROR', e); await shot('error'); }
if (errors.length) console.log('PAGE ERRORS:\n' + [...new Set(errors)].slice(0, 30).join('\n'));
await browser.close();
