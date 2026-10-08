export default async (page, shot) => {
  await page.waitForTimeout(2500);
  if (await page.locator('.help').count()) await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /Free shift/ }).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Start shift' }).click();
  await page.waitForTimeout(5000);
  if (await page.locator('.help').count()) await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: /Display/ }).click();
  await shot('105-ingame-settings');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  console.log('settings closed', await page.locator('.settings-layer').count() === 0, 'pause menu still', await page.locator('.modal').count());
};
