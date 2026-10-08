export default async (page, shot) => {
  await page.waitForTimeout(2500);
  if (await page.locator('.help').count()) await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /Free shift/ }).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Start shift' }).click();
  await page.waitForTimeout(5000);
  if (await page.locator('.help').count()) await page.keyboard.press('Escape');
  await page.keyboard.press('5');
  for (let i = 0; i < 30; i++) { const b = page.locator('.bubble.split .act', { hasText: /Line up|Take-off|Clear to land/ }).first(); if (await b.count()) { await b.dispatchEvent('pointerdown', { button: 0 }); } await page.waitForTimeout(1500); }
  await page.mouse.move(800, 450); await page.mouse.wheel(0, 300); await page.waitForTimeout(1500);
  await shot('108-rwy-labels');
};
