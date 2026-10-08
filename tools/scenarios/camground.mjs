export default async (page, shot) => {
  await page.waitForTimeout(2500);
  if (await page.locator('.help').count()) await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /Free shift/ }).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Ground + Tower', exact: true }).click();
  await page.getByRole('button', { name: 'Start shift' }).click();
  await page.waitForTimeout(6000);
  if (await page.locator('.help').count()) await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '2 times speed' }).click();
  await page.waitForTimeout(14000);
  const strips = page.locator('.strip:not(.dim)');
  const n = await strips.count();
  for (let i = 0; i < n; i++) { const t = await strips.nth(i).textContent(); if (/push|taxi|stand/i.test(t)) { await strips.nth(i).click(); console.log('picked', t.trim().slice(0, 40)); break; } }
  await page.waitForTimeout(1500);
  await shot('98-ground-intent');
  await page.locator('.follow').click();
  await page.waitForTimeout(6000);
  await shot('99-follow');
  await page.keyboard.press('Shift+V');
  await page.waitForTimeout(8000);
  console.log('toasts', await page.locator('.toast').allTextContents());
  await shot('100-auto');
};
