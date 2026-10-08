export default async (page, shot) => {
  await page.waitForTimeout(2500);
  if (await page.locator('.help').count()) await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /Free shift/ }).click();
  await page.waitForTimeout(300);
  await page.route('**/*.json', async r => { await new Promise(res => setTimeout(res, 1500)); await r.continue(); });
  await page.getByRole('button', { name: 'Start shift' }).click();
  await page.waitForTimeout(600);
  await shot('81-loading');
};
