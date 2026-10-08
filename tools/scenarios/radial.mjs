export default async (page, shot) => {
  await page.waitForTimeout(2500);
  if (await page.locator('.help').count()) await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /Free shift/ }).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Start shift' }).click();
  await page.waitForTimeout(4000);
  if (await page.locator('.help').count()) await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '4 times speed' }).click();
  await page.waitForTimeout(12000);
  await page.getByRole('button', { name: '1 times speed' }).click();
  await page.locator('.strip:not(.dim)').first().click();
  await page.waitForTimeout(1500);
  await shot('65-strip-zoom');
  const b = await page.locator('.bubble').first().boundingBox();
  if (b) await page.mouse.click(b.x - 16, b.y + 34, { button: 'right' });
  await page.waitForTimeout(500);
  await shot('66-radial');
};
