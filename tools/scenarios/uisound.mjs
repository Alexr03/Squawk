export default async (page) => {
  await page.addInitScript(() => {
    const O = window.AudioContext; let n = 0;
    window.__osc = () => n;
    window.AudioContext = class extends O { createOscillator() { n++; return super.createOscillator(); } };
  });
  await page.reload();
  await page.waitForTimeout(2500);
  if (await page.locator('.help').count()) await page.keyboard.press('Escape');
  const before = await page.evaluate(() => window.__osc());
  await page.getByRole('button', { name: /^Settings$/ }).click();
  await page.waitForTimeout(300);
  await page.locator('input.switch').first().click();
  await page.waitForTimeout(300);
  console.log('oscillators from clicks', (await page.evaluate(() => window.__osc())) - before);
};
