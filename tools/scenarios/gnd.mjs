export default async (page, shot) => {
  await page.waitForTimeout(2500);
  await page.getByRole('button', { name: /Free shift/ }).click();
  await page.waitForTimeout(400);
  await page.locator('label.seat').filter({ hasText: 'Tower' }).click();
  await page.locator('label.seat').filter({ hasText: 'Ground' }).click();
  await page.getByRole('button', { name: 'Start shift' }).click();
  await page.waitForTimeout(5000);
  await page.getByRole('button', { name: '4×' }).click();
  await page.waitForTimeout(30000);
  await page.getByRole('button', { name: '1×' }).click();
  await shot('30-gnd');
  // Work the queue a few times with the keyboard: N selects, then the default instruction.
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('n');
    await page.waitForTimeout(200);
    const t = await page.locator('.queue button.sel').textContent().catch(() => '');
    if (/clearance/i.test(t)) await page.keyboard.press('c');
    else if (/push/i.test(t)) await page.keyboard.press('p');
    else if (/taxi/i.test(t)) { await page.keyboard.press('x'); await page.waitForTimeout(300); await shot('31-taxi-edit-' + i); await page.keyboard.press('Enter'); }
    await page.waitForTimeout(1500);
  }
  await page.waitForTimeout(3000);
  await shot('32-gnd-after');
};
