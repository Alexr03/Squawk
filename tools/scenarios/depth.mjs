export default async (page, shot) => {
  await page.waitForTimeout(2500);
  if (await page.locator('.help').count()) await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /Free shift/ }).click();
  await page.waitForTimeout(300);
  await page.getByLabel('Start time').fill('16');
  await page.getByRole('button', { name: 'Start shift' }).click();
  await page.waitForTimeout(6000);
  if (await page.locator('.help').count()) await page.keyboard.press('Escape');
  await page.locator('[title="Flight strips"]').click();
  await shot('92-depth-tower');
  for (let i = 0; i < 2; i++) { await page.mouse.move(800, 450); await page.mouse.wheel(0, -400); await page.waitForTimeout(300); }
  await page.waitForTimeout(1000);
  await shot('93-depth-close');
  for (let i = 0; i < 5; i++) { await page.mouse.move(800, 450); await page.mouse.wheel(0, 400); await page.waitForTimeout(300); }
  await page.waitForTimeout(1000);
  await shot('94-depth-wide');
};
