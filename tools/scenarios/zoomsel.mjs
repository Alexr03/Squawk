// Select an aircraft, zoom right out, and log what paints white on the radar canvas.
export default async (page, shot) => {
  page.on('console', m => { if (m.text().startsWith('WHITE')) console.log(m.text()); });
  await page.evaluate(() => {
    const P = CanvasRenderingContext2D.prototype, f = P.fill;
    P.fill = function (...a) {
      if (String(this.fillStyle).toLowerCase() === '#ffffff' && !window.__logged) { window.__logged = 1; console.log('WHITE FILL ' + new Error().stack); }
      return f.apply(this, a);
    };
  });
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
  await page.locator('.strip:not(.dim)').first().click();
  await page.waitForTimeout(1500);
  for (let i = 0; i < 6; i++) { await page.mouse.move(800, 450); await page.mouse.wheel(0, 600); await page.waitForTimeout(250); }
  await page.waitForTimeout(800);
  await shot('70-zoomout');
};
