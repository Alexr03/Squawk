export default async (page, shot) => {
  await page.waitForTimeout(2500);
  if (await page.locator('.help').count()) await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /Free shift/ }).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Director', exact: true }).click();
  await page.getByRole('button', { name: 'Start shift' }).click();
  await page.waitForTimeout(5000);
  if (await page.locator('.help').count()) await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '4 times speed' }).click();
  for (let i = 0; i < 40; i++) {
    const a = page.locator('.alert', { hasText: /Holding/ }).first();
    if (await a.count()) { await a.click(); console.log('picked', (await a.textContent()).trim().slice(0, 40)); break; }
    await page.waitForTimeout(2000);
  }
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Pause' }).click();
  await page.waitForTimeout(600);
  await shot('101-hold');
};
