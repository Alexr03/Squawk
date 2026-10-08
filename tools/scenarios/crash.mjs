// Development server only: stages a crash (window.squawkDebug) and checks the response chain end to end.
export default async (page, shot) => {
  await page.waitForTimeout(2500);
  if (await page.locator('.help').count()) await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /Free shift/ }).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Ground + Tower', exact: true }).click();
  await page.getByRole('button', { name: 'Start shift' }).click();
  await page.waitForTimeout(5000);
  if (await page.locator('.help').count()) await page.keyboard.press('Escape');
  await page.keyboard.press('5');
  for (let i = 0; i < 90 && (await page.evaluate(() => window.squawkSnap().aircraft.length)) < 3; i++) await page.waitForTimeout(1000);
  await page.keyboard.press('1');
  for (let i = 0; i < 10; i++) {
    await page.evaluate(() => window.squawkDebug?.('crash'));
    await page.waitForTimeout(1000);
    if (await page.locator('.alert', { hasText: /fire service/ }).count()) break;
  }
  const al = page.locator('.alert', { hasText: /fire service/ }).first();
  console.log('alert:', (await al.textContent()).replace(/\s+/g, ' '));
  await page.keyboard.press('1');
  await page.waitForTimeout(1500);
  await shot('110-crash-fire');
  await page.locator('[title="Runways: open or close"]').click();
  await page.waitForTimeout(300);
  console.log('runways:', (await page.locator('.rwypop').textContent()).replace(/\s+/g, ' '));
  await shot('111-runways');
  await page.locator('[title="Runways: open or close"]').click();
  await al.click();
  await page.waitForTimeout(800);
  await page.keyboard.press('5');
  await page.waitForTimeout(9000);
  await page.keyboard.press('1');
  await page.waitForTimeout(600);
  await shot('112-crews');
  await page.mouse.move(800, 450); for (let i = 0; i < 5; i++) { await page.mouse.wheel(0, 500); await page.waitForTimeout(200); }
  await page.waitForTimeout(1000);
  await shot('113-radar-marker');
};
