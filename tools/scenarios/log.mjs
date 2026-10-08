export default async (page, shot) => {
  await page.waitForTimeout(2500);
  if (await page.locator('.help').count()) await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /Free shift/ }).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Start shift' }).click();
  await page.waitForTimeout(4000);
  if (await page.locator('.help').count()) await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '4 times speed' }).click();
  await page.waitForTimeout(20000);
  await page.locator('[title="Radio log"]').click();
  await page.waitForTimeout(600);
  console.log('radio height', await page.locator('.radio').evaluate(e => e.getBoundingClientRect().height));
  await shot('63-log-open');
};
