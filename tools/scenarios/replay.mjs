export default async (page, shot) => {
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.waitForTimeout(2500);
  if (await page.locator('.help').count()) await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /Free shift/ }).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Start shift' }).click();
  await page.waitForTimeout(5000);
  if (await page.locator('.help').count()) await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '4 times speed' }).click();
  await page.waitForTimeout(100000);
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('button', { name: 'End shift' }).click();
  await page.waitForTimeout(3000);
  const n = await page.getByRole('button', { name: 'Replay' }).count();
  console.log('replay buttons', n);
  if (n) { await page.getByRole('button', { name: 'Replay' }).first().click(); await page.waitForTimeout(4000); }
  console.log('in game', await page.locator('.game').count(), 'errors', JSON.stringify(errs));
  await shot('72-replay');
};
