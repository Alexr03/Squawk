export default async (page, shot) => {
  await page.waitForTimeout(2500);
  if (await page.locator('.help').count()) await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /Free shift/ }).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: /Made-up day/ }).click();
  await shot('67-setup-madeup');
  await page.getByRole('button', { name: 'Start shift' }).click();
  await page.waitForTimeout(5000);
  if (await page.locator('.help').count()) await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '4 times speed' }).click();
  await page.waitForTimeout(10000);
  console.log('alerts', await page.locator('.alert').count(), 'strips', await page.locator('.strip').count());
  await shot('68-madeup-play');
};
