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
  await page.locator('.alert').first().click();
  await page.waitForTimeout(300);
  await page.locator('.card .acts button').first().click();
  await page.waitForTimeout(400);
  console.log('wait bubbles', await page.locator('.bubble.wait').count(), 'card cue', await page.locator('.card .rb').count());
  await shot('64-readback');
};
