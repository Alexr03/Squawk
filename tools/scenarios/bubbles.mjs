export default async (page, shot) => {
  await page.waitForTimeout(2500);
  if (await page.locator('.help').count()) await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /Free shift/ }).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Start shift' }).click();
  await page.waitForTimeout(4000);
  await page.getByRole('button', { name: '4 times speed' }).click();
  await page.waitForTimeout(25000);
  await page.getByRole('button', { name: '1 times speed' }).click();
  await shot('50-bubbles');
  const b = page.locator('.bubble').first();
  if (await b.count()) { console.log('clicking', await b.textContent()); await b.click(); }
  await page.waitForTimeout(3000);
  await shot('51-after-bubble');
};
