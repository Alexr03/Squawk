export default async (page, shot) => {
  await page.waitForTimeout(2500);
  if (await page.locator('.help').count()) await page.keyboard.press('Escape');
  await shot('70-menu');
  await page.getByRole('button', { name: /Free shift/ }).click();
  await page.waitForTimeout(500);
  await shot('71-setup');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /Back/ }).click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: /Career/ }).click().catch(() => {});
  await page.waitForTimeout(500);
  await shot('72-career');
};
