// End-to-end co-op over PocketBase room codes: a signed-in host opens a room, an anonymous guest joins with the 8-digit code.
// Needs a local PocketBase with the migrations (see pocketbase/README.md) and the web app built against it.
// node tools/pbcoop.mjs <app url> <pocketbase url> <superuser email> <superuser password>
import { chromium } from 'playwright';
import PocketBase from 'pocketbase';
const [app, pbUrl, email, pass] = process.argv.slice(2);
const admin = new PocketBase(pbUrl);
await admin.collection('_superusers').authWithPassword(email, pass);
const u = await admin.collection('users').create({ name: 'HostPlayer', email: `host${Date.now()}@test.local`, password: 'x12345678', passwordConfirm: 'x12345678' });
const host = await admin.collection('users').impersonate(u.id, 3600);
const browser = await chromium.launch();
const hp = await (await browser.newContext()).newPage(), gp = await (await browser.newContext()).newPage();
const log = (who, p) => p.on('console', m => { if (m.type() === 'error') console.log(who, 'console error:', m.text().slice(0, 160)); });
log('host', hp); log('guest', gp);
await hp.addInitScript(([t, r]) => localStorage.setItem('pocketbase_auth', JSON.stringify({ token: t, record: r })), [host.authStore.token, host.authStore.record]);
for (const p of [hp, gp]) { await p.goto(app); await p.waitForTimeout(2500); if (await p.locator('.help').count()) await p.keyboard.press('Escape'); await p.getByRole('button', { name: /Co-op/ }).first().click(); await p.waitForTimeout(500); }
await hp.getByRole('button', { name: 'Host', exact: true }).click();
await hp.waitForSelector('[data-testid=room]', { timeout: 20000 });
const code = (await hp.locator('[data-testid=room]').textContent()).trim();
console.log('room code', code, /^\d{8}$/.test(code) ? '(8 digits)' : '(WRONG FORMAT)');
await gp.locator('input.room').fill(code);
await gp.getByRole('button', { name: 'Join', exact: true }).click();
await gp.waitForTimeout(12000);
console.log('host sees:', (await hp.locator('.coop').textContent()).replace(/\s+/g, ' ').match(/(Connected|connected|players?|seat)[^.]{0,80}/)?.[0] ?? '?');
console.log('guest sees:', (await gp.locator('.coop').textContent()).replace(/\s+/g, ' ').slice(0, 200));
await browser.close();
