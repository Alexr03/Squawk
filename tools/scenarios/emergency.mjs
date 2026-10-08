// Development server only: an engine-failure Mayday on final, cleared to land from its bubble, stops on the runway.
export default async (page, shot) => {
  await page.waitForTimeout(2500);
  if (await page.locator('.help').count()) await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /Free shift/ }).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Start shift' }).click();
  await page.waitForTimeout(5000);
  if (await page.locator('.help').count()) await page.keyboard.press('Escape');
  await page.keyboard.press('5');
  for (let i = 0; i < 120 && !(await page.evaluate(() => window.squawkSnap().aircraft.some(a => a.kind === 'arr' && a.nav.established && !a.onGround))); i++) await page.waitForTimeout(1000);
  await page.evaluate(() => window.squawkDebug('emergency'));
  let stopped = null;
  for (let i = 0; i < 240 && !stopped; i++) {
    // Clear whoever needs landing clearance, from their bubble.
    const em = page.locator('.alert', { hasText: /MAYDAY|Landing clearance/ }).first();
    if (await em.count()) { await em.click(); await page.waitForTimeout(700); }
    const b = page.locator('.bubble.split .act', { hasText: /Clear to land/ }).first();
    if (await b.count()) await b.dispatchEvent('pointerdown', { button: 0 });
    stopped = await page.evaluate(() => window.squawkSnap().aircraft.find(a => a.phase === 'stopped')?.cs ?? null);
    if (i % 20 === 0) console.log('t' + i, await page.evaluate(() => { const e = window.squawkSnap().aircraft.find(a => a.emergency); return e ? [e.cs, e.phase, e.owner, e.freq, 'land=' + e.cleared.land, 'full=' + e.fullStop, Math.round(e.alt), e.runway].join(' ') : 'no emergency aircraft'; }));
    await page.waitForTimeout(1000);
  }
  console.log('stopped on the runway:', stopped);
  await page.keyboard.press('1');
  const al = page.locator('.alert', { hasText: /fire service/ }).first();
  console.log('alert:', (await al.textContent().catch(() => 'none')).replace(/\s+/g, ' '));
  await al.click().catch(() => {});
  await page.waitForTimeout(6000);
  await shot('114-emergency-stop');
  console.log('incident:', await page.evaluate(() => JSON.stringify(window.squawkSnap().incidents.map(i => ({ kind: i.kind, runway: i.runway, fire: +i.fire.toFixed(2), dispatched: i.dispatched !== null, onScene: i.onScene !== null })))));
};
