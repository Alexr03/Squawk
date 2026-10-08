export default async (page, shot) => {
  await page.waitForTimeout(2500);
  if (await page.locator('.help').count()) await page.keyboard.press('Escape');
  await page.waitForTimeout(7000);
  await shot('r-home');
  await page.getByRole('button', { name: /^Settings$/ }).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: /About/ }).click();
  await page.waitForTimeout(300);
  await shot('r-about');
};
