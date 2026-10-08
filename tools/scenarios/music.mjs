export default async (page, shot) => {
  await page.addInitScript(() => {
    const O = window.AudioContext; let n = 0;
    window.__osc = () => n;
    window.AudioContext = class extends O { createOscillator() { n++; return super.createOscillator(); } };
  });
  await page.reload();
  await page.waitForTimeout(2500);
  if (await page.locator('.help').count()) await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /Free shift/ }).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Start shift' }).click();
  await page.waitForTimeout(5000);
  if (await page.locator('.help').count()) await page.keyboard.press('Escape');
  await page.mouse.click(800, 400);
  await page.waitForTimeout(9000);
  console.log('oscillators started', await page.evaluate(() => window.__osc()));
};
