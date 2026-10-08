export default async (page, shot) => {
  await page.waitForTimeout(2500);
  if (await page.locator('.help').count()) await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /Free shift/ }).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Start shift' }).click();
  await page.waitForTimeout(5000);
  if (await page.locator('.help').count()) await page.keyboard.press('Escape');
  for (const k of ['3', '5', '1']) { await page.keyboard.press(k); await page.waitForTimeout(300); console.log('key', k, '-> active', await page.locator('.speeds button.on').textContent()); }
  await page.keyboard.press('Shift+Digit4'); await page.waitForTimeout(1200);
  console.log('after Shift+4 scale', await page.locator('.scale').textContent());
  await shot('102-speed');
};
