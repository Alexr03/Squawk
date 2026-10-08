// Menu -> Free shift (Tower) -> play a little.
export default async (page, shot) => {
  await page.waitForTimeout(4000);
  await shot('01-menu');
  await page.getByRole('button', { name: /Free shift/ }).click();
  await page.waitForTimeout(500);
  await shot('02-setup');
  await page.getByRole('button', { name: 'Start shift' }).click();
  await page.waitForTimeout(6000);
  await shot('03-game');
  // Speed up and look again.
  await page.getByRole('button', { name: '4×' }).click();
  await page.waitForTimeout(15000);
  await shot('04-game-later');
  // Select the most urgent aircraft and open its radial menu.
  await page.keyboard.press('Tab');
  await page.waitForTimeout(400);
  await shot('05-selected');
};
