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
  await page.waitForTimeout(8000);
  // no selection
  await page.waitForTimeout(1500);
  await shot('69-sel');
  for (let i = 0; i < 6; i++) { await page.mouse.move(800, 450); await page.mouse.wheel(0, 600); await page.waitForTimeout(250); }
  await page.waitForTimeout(800);
  await shot('70-zoomout');
};
