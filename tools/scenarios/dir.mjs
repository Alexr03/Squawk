export default async (page, shot) => {
  await page.waitForTimeout(2500);
  /* closeHelp */ if (await page.locator('.help').count()) await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /Free shift/ }).click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'Director', exact: true }).click();
  await page.getByRole('button', { name: 'Start shift' }).click();
  await page.waitForTimeout(5000);
  await page.getByRole('button', { name: '4×' }).click();
  await page.waitForTimeout(40000);
  await shot('20-dir');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(300);
  await shot('21-dir-selected');
  await page.keyboard.press('h');
  await page.waitForTimeout(400);
  await shot('22-dir-heading-ring');
  await page.keyboard.press('Escape');
};
