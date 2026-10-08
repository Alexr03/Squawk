export default async (page, shot) => {
  await page.waitForTimeout(2500);
  if (await page.locator('.help').count()) await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /Free shift/ }).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Ground + Tower', exact: true }).click();
  await page.getByRole('button', { name: 'Start shift' }).click();
  await page.waitForTimeout(6000);
  if (await page.locator('.help').count()) await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Pause' }).click();
  for (let i = 0; i < 2; i++) { await page.mouse.move(800, 450); await page.mouse.wheel(0, -400); await page.waitForTimeout(400); }
  await page.waitForTimeout(1200);
  await shot('103-bridges');
};
