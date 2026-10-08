export default async (page, shot) => {
  await page.waitForTimeout(2500);
  if (await page.locator('.help').count()) await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^Settings$/ }).click();
  await page.waitForTimeout(400);
  await shot('82-settings');
  await page.getByRole('button', { name: /Voice commands/ }).click();
  await page.waitForTimeout(300);
  await shot('83-settings-voice');
};
