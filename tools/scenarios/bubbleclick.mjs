export default async (page, shot) => {
  page.on('console', m => { if (m.text().startsWith('DBG')) console.log(m.text()); });
  await page.waitForTimeout(2500);
  if (await page.locator('.help').count()) await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /Free shift/ }).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Ground + Tower', exact: true }).click();
  await page.getByRole('button', { name: 'Start shift' }).click();
  await page.waitForTimeout(5000);
  if (await page.locator('.help').count()) await page.keyboard.press('Escape');
  await page.keyboard.press('3');
  await page.waitForTimeout(6000);
  await shot('106-bubbles');
  console.log('bubbles', await page.locator('.bubble').count(), 'alerts', await page.locator('.alert').count());
  let ok = 0, tries = 0;
  for (let i = 0; i < 40 && tries < 12; i++) {
    const al = page.locator('.alert').first();
    if (!(await al.count())) { await page.waitForTimeout(1500); continue; }
    const alcs = (await al.locator('b').textContent()).trim();
    await al.click(); await page.waitForTimeout(1200);
    const bub = page.locator('.bubble.split', { hasText: alcs }).first();
    const b = bub.locator('.act');
    if (await b.count()) {
      const cs = (await bub.locator('.sel').textContent()).trim();
      const box = await b.boundingBox().catch(() => null);
      if (box) { tries++; if (tries === 1) { await shot('107-before-press'); console.log('alerts', JSON.stringify((await page.locator('.alert').allTextContents()).map(t => t.replace(/s+/g, ' ')))); } await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await page.waitForTimeout(250);
        console.log('clock', await page.locator('.clock').textContent(), 'speed', await page.locator('.speeds button.on').textContent().catch(() => 'none'), 'toast right after:', JSON.stringify(await page.locator('.toast').allTextContents()));
        await page.waitForTimeout(2750);
        console.log('log after press:', JSON.stringify((await page.locator('.comms .ln').allTextContents()).slice(-2)), 'strip:', (await page.locator('.strip', { hasText: cs }).first().textContent().catch(() => '')).replace(/s+/g, ' ').slice(0, 60));
        if (await page.locator('.bubble.wait', { hasText: cs }).count() || await page.locator('.card .rb').count()) ok++; else { console.log('missed', cs, 'toasts', JSON.stringify(await page.locator('.toast').allTextContents()), 'act', await b.textContent().catch(() => '?'), 'atPoint', await page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e ? e.tagName + '.' + e.className : null; }, [box.x + box.width / 2, box.y + box.height / 2])); if (tries > 2) break; }
      }
    }
    await page.waitForTimeout(1500);
  }
  console.log(`bubble presses that took effect: ${ok}/${tries}`);
};
