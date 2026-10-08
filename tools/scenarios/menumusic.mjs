export default async (page) => {
  await page.addInitScript(() => {
    const O = window.AudioContext; let n = 0;
    window.__osc = () => n;
    window.AudioContext = class extends O { createOscillator() { n++; return super.createOscillator(); } };
  });
  await page.reload();
  await page.waitForTimeout(2500);
  if (await page.locator('.help').count()) await page.keyboard.press('Escape');
  await page.mouse.click(1200, 300);
  await page.waitForTimeout(6000);
  console.log('menu oscillators', await page.evaluate(() => window.__osc()));
};
