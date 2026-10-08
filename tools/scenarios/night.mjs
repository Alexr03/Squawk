export default async (page, shot) => {
  await page.waitForTimeout(2500);
  if (await page.locator('.help').count()) await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /Free shift/ }).click();
  await page.waitForTimeout(300);
  await page.getByLabel('Start time').fill('22');
  await page.getByRole('button', { name: 'Start shift' }).click();
  await page.waitForTimeout(5000);
  if (await page.locator('.help').count()) await page.keyboard.press('Escape');
  console.log('clock at start', await page.locator('.clock').textContent());
  await shot('90-fast-start');
  await page.getByRole('button', { name: '4 times speed' }).click();
  await page.waitForTimeout(4000);
  console.log('clock later', await page.locator('.clock').textContent());
  await shot('91-fast-dusk');
};
