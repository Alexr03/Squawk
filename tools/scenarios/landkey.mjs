export default async (page) => {
  const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await page.waitForTimeout(2500);
  if (await page.locator('.help').count()) await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /Free shift/ }).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Ground + Tower', exact: true }).click();
  await page.getByRole('button', { name: 'Start shift' }).click();
  await page.waitForTimeout(5000);
  if (await page.locator('.help').count()) await page.keyboard.press('Escape');
  await page.keyboard.press('3');
  for (let i = 0; i < 60; i++) { if (await page.locator('.alert', { hasText: /Landing clearance/ }).count()) break; await page.waitForTimeout(1000); }
  const al = page.locator('.alert', { hasText: /Landing clearance/ }).first();
  console.log('alert', (await al.textContent()).replace(/\s+/g, ' '));
  await al.click(); await page.waitForTimeout(500);
  console.log('card actions', JSON.stringify(await page.locator('.card .acts button').allTextContents()));
  await page.locator('.card .acts button', { hasText: /land/i }).first().click();
  await page.waitForTimeout(300);
  console.log('toasts', JSON.stringify(await page.locator('.toast').allTextContents()));
  await page.waitForTimeout(3000);
  console.log('log tail', JSON.stringify((await page.locator('.comms .ln').allTextContents()).slice(-3)));
  console.log('errors', JSON.stringify(errs.slice(0, 5)));
};
