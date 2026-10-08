// Tower shift: run at 4x for a while, then interact: select, radial menu, issue via keyboard and command line.
export default async (page, shot) => {
  await page.waitForTimeout(2500);
  await page.getByRole('button', { name: /Free shift/ }).click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'Start shift' }).click();
  await page.waitForTimeout(5000);
  await page.getByRole('button', { name: '4×' }).click();
  await page.waitForTimeout(70000);
  await shot('10-tower-busy');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(500);
  await shot('11-selected');
  // Right-click the selected aircraft via the card's first action instead: open radial with right-click at scope center.
  const box = await page.locator('.scopewrap').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
  await page.waitForTimeout(500);
  await shot('12-radial');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '1×' }).click();
  await page.waitForTimeout(8000);
  await shot('13-after');
};
