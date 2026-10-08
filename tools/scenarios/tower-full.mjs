// Work a whole 15-minute Tower shift from the keyboard, the way a player would: N for the most urgent, then the key it needs.
export default async (page, shot) => {
  await page.waitForTimeout(2500);
  /* closeHelp */ if (await page.locator('.help').count()) await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /Free shift/ }).click();
  await page.waitForTimeout(300);
  await page.locator('select').first().selectOption('15');
  await page.getByRole('button', { name: 'Start shift' }).click();
  await page.waitForTimeout(4000);
  await page.getByRole('button', { name: '4×' }).click();
  const t0 = Date.now(); let n = 0, last = '';
  while (Date.now() - t0 < 6 * 60_000) {
    if (await page.locator('.deb').count()) break;
    const items = await page.locator('.queue button').allTextContents();
    for (const t of items.slice(0, 3)) {
      const cs = t.trim().split(/\s+/)[0];
      await page.locator('.queue button', { hasText: cs }).first().click().catch(() => {});
      await page.waitForTimeout(120);
      const key = /Landing clearance/.test(t) ? 'l' : /gap OK/.test(t) && /Lined/.test(t) ? 't' : /Ready, gap OK/.test(t) ? 'l' : /Hand off/.test(t) ? 'k' : /readback/i.test(t) ? 'z' : null;
      if (key) { await page.keyboard.press(key); n++; last = `${cs} ${key}`; }
      await page.waitForTimeout(150);
    }
    await page.waitForTimeout(600);
    if (n && n % 25 === 0) await shot('40-tower-mid');
  }
  console.log('instructions sent', n, 'last', last);
  await page.waitForTimeout(1500);
  await shot('41-tower-end');
};
