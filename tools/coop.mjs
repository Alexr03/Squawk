// End-to-end co-op check: a host and a guest page in one Chromium, connected by the manual invite/answer codes.
// The guest claims Tower + Director, the host takes Delivery + Ground and starts; we check the guest gets snapshots, that a guest
// command reaches the host's sim (and one for the host's frequency is refused), then drop the host and let the guest
// take over from the last full state.
// Usage: pnpm dev (in another shell), then node tools/coop.mjs [url] [--room]
// --room connects through a 6-letter room code instead; it needs the app built/served with VITE_LEADERBOARD_URL
// pointing at the worker (node tools/lb-local.mjs runs one locally).
import { chromium } from 'playwright';

const url = process.argv.slice(2).find(a => !a.startsWith('--')) ?? 'http://localhost:5173/';
const viaRoom = process.argv.includes('--room');
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-features=WebRtcHideLocalIpsWithMdns'] });
const errors = [];
async function player(name) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 860 } });
  await ctx.addInitScript(n => localStorage.setItem('squawk.settings', JSON.stringify({ callsign: n, pilotVoices: false, tutorialHints: false })), name);
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(`${name}: ${e}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(`${name}: ${m.text()}`); });
  await page.goto(url);
  await page.getByRole('button', { name: /^Co-op/ }).click();
  return page;
}
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`); if (!cond) process.exitCode = 1; return cond; };
const shot = (page, name) => process.env.SHOTS && page.screenshot({ path: `${process.env.SHOTS}/${name}.png` });
const until = async (page, fn, arg, ms = 20000) => page.waitForFunction(fn, arg, { timeout: ms, polling: 200 });

const host = await player('Hosty');
const guest = await player('Guesty');

await host.getByRole('button', { name: 'Host', exact: true }).click();
if (viaRoom) {
  // --- room code signalling
  await host.locator('[data-testid=room]').waitFor();
  const room = await host.locator('[data-testid=room]').innerText();
  console.log(`room code: ${room}`);
  await guest.getByPlaceholder('ABCDEF').fill(room);
  await guest.getByRole('button', { name: 'Join', exact: true }).click();
} else {
  // --- manual signalling
  await host.getByRole('button', { name: 'New invite code' }).click();
  await until(host, () => document.querySelector('[data-testid=invite]')?.value.length > 50);
  const invite = await host.locator('[data-testid=invite]').inputValue();
  console.log(`invite code: ${invite.length} chars`);
  await guest.getByPlaceholder("Paste the host's invite code").fill(invite);
  await guest.getByRole('button', { name: 'Make answer code' }).click();
  await until(guest, () => document.querySelector('[data-testid=answer-out]')?.value.length > 50);
  const answer = await guest.locator('[data-testid=answer-out]').inputValue();
  console.log(`answer code: ${answer.length} chars`);
  await host.locator('[data-testid=answer-in]').fill(answer);
  await host.getByRole('button', { name: 'Connect' }).click();
}
await until(host, () => document.body.innerText.includes('Guesty'));
ok(true, 'guest connected and listed in the host lobby');

// --- seats: guest claims Tower + Director, host takes Delivery + Ground
await until(guest, () => document.body.innerText.includes('Waiting for the host'));
for (const seat of ['Tower', 'Director']) {
  await guest.locator('.seat', { hasText: seat }).getByRole('button', { name: 'claim' }).click();
  await until(host, s => document.querySelector(`select[aria-label="${s} controller"]`)?.selectedOptions[0]?.textContent === 'Guesty', seat);
}
await host.getByLabel('Delivery controller').selectOption({ label: 'Hosty (host)' });
await host.getByLabel('Ground controller').selectOption({ label: 'Hosty (host)' });
await until(guest, () => document.querySelector('.seat.mine')?.textContent.includes('Tower'));
ok(true, 'seat claims synced (guest: Tower + Director; host: Delivery + Ground)');

await shot(host, 'host-lobby'); await shot(guest, 'guest-lobby');
await host.getByRole('button', { name: 'Start shift' }).click();
await until(guest, () => globalThis.__coop?.session?.remote?.snap?.tick > 0, null, 30000);
const t0 = await guest.evaluate(() => globalThis.__coop.session.remote.snap.tick);
await guest.waitForTimeout(2000);
const t1 = await guest.evaluate(() => globalThis.__coop.session.remote.snap.tick);
ok(t1 > t0, `guest receives snapshots (tick ${t0} → ${t1})`);
const MINE = ['EGLL:DIR', 'EGLL:TWR'];
ok(JSON.stringify((await guest.evaluate(() => globalThis.__coop.session.remote.seats)).sort()) === JSON.stringify(MINE), `guest seats = ${MINE}`);
ok(JSON.stringify((await host.evaluate(() => globalThis.__coop.session.client.cfg.coverage)).sort()) === '["EGLL:DEL","EGLL:DIR","EGLL:GND","EGLL:TWR"]', 'sim coverage = union of claimed seats');

// Speed the host up until the guest has someone to talk to.
await host.getByRole('button', { name: '4×' }).click();
await until(guest, m => globalThis.__coop.session.remote.snap.aircraft.some(a => m.includes(a.freq) && a.phase !== 'gone'), MINE, 180000);
const sent = await guest.evaluate(async () => {
  const r = globalThis.__coop.session.remote;
  for (const ac of r.snap.aircraft.filter(a => r.seats.includes(a.freq) && a.phase !== 'gone')) {
    const tries = ac.kind === 'arr' ? [{ verb: 'land', runway: ac.runway }, { verb: 'heading', hdg: Math.round(ac.hdg) || 360 }] : [{ verb: 'luw', runway: ac.runway }, { verb: 'cto', runway: ac.runway }];
    for (const t of [...tries, { verb: 'sayagain' }]) {
      const err = await r.issue([{ cs: ac.cs, ...t }]);
      if (!err) return { cs: ac.cs, verb: t.verb, seat: ac.freq.split(':')[1], tick: r.snap.tick };
    }
  }
  return null;
});
ok(!!sent, `guest command accepted: ${JSON.stringify(sent)}`);
if (sent) {
  await until(host, s => globalThis.__coop.session.client.snap.radio.some(x => x.cs === s.cs && x.from === 'atc' && x.seat === s.seat && !x.auto && x.tick >= s.tick - 8), sent);
  ok(true, `host's sim radio log has the guest's ${sent.seat} transmission to ${sent.cs}`);
  await until(guest, cs => document.querySelector('.log')?.innerText.includes(cs), sent.cs);
  ok(true, 'guest radio log shows it');
}
// The host refuses a guest command for an aircraft on someone else's frequency (bypassing the guest's own check).
const refused = await guest.evaluate(() => new Promise(res => {
  const s = globalThis.__coop.session, ac = s.remote.snap.aircraft.find(a => !s.remote.seats.includes(a.freq) && a.phase !== 'gone');
  if (!ac) return res('no aircraft');
  s.remote.waiting.set(9999, res);
  s.send({ t: 'cmd', id: 9999, cmds: [{ cs: ac.cs, verb: 'sayagain' }] });
}));
ok(/not your frequency/.test(String(refused)), `host refuses commands outside the guest's seats: ${refused}`);

// Mid-shift handover: host gives Ground to the guest.
await host.keyboard.press('Escape');
await host.getByLabel('Ground controller').selectOption({ label: 'Guesty' });
await until(guest, () => globalThis.__coop.session.remote.seats.includes('EGLL:GND'));
await until(guest, () => document.body.innerText.includes('Handover: Ground'), null, 5000).catch(() => {});
ok(await guest.evaluate(() => document.body.innerText.includes('Handover: Ground')), 'handover toast on the guest');
await shot(host, 'host-menu'); await shot(guest, 'guest-game');
await host.keyboard.press('Escape');

const stats = await host.evaluate(() => globalThis.__coop.session.stats);
for (const [k, [raw, packed]] of Object.entries(stats)) console.log(`message ${k}: ${raw} B JSON → ${packed} B deflated`);

// --- host drop and takeover
await until(guest, () => !!globalThis.__coop.session.lastFull, null, 15000);
const fullTick = await guest.evaluate(() => globalThis.__coop.session.lastFull.tick);
await host.context().close();
await until(guest, () => document.body.innerText.includes('Host lost'), null, 15000);
ok(true, 'guest sees "Host lost — shift paused"');
await shot(guest, 'guest-lost');
await guest.getByRole('button', { name: 'Take over hosting' }).click();
await guest.getByRole('button', { name: 'Resume shift' }).waitFor();
await guest.getByLabel('Tower controller').selectOption({ label: 'Guesty (host)' });
await guest.getByRole('button', { name: 'Resume shift' }).click();
await until(guest, ft => globalThis.__coop.session.client?.snap?.tick > ft, fullTick, 20000);
ok(true, `guest took over hosting and the shift carries on from tick ${fullTick}`);

if (errors.length) console.log('PAGE ERRORS:\n' + errors.slice(0, 20).join('\n'));
await browser.close();
