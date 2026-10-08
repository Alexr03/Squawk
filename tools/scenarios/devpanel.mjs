export default async (page, shot) => {
  await page.waitForTimeout(2500);
  if (await page.locator('.help').count()) await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /Free shift/ }).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Director', exact: true }).click();
  await page.getByRole('button', { name: 'Start shift' }).click();
  await page.waitForTimeout(5000);
  if (await page.locator('.help').count()) await page.keyboard.press('Escape');
  await page.keyboard.press('F2');
  await page.waitForTimeout(400);
  await shot('115-devpanel');
  await page.getByRole('button', { name: /Mid-air collision/ }).click();
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: /Bird strike/ }).click();
  await page.waitForTimeout(1500);
  console.log('state:', await page.evaluate(() => { const s = window.squawkSnap(); return JSON.stringify({ incidents: s.incidents.map(i => i.kind + (i.offAirport ? ' off-airport' : '')), emergencies: s.aircraft.filter(a => a.emergency).map(a => a.cs + ' ' + a.emergency.nature), debugUsed: s.debugUsed }); }));
  console.log('log:', (await page.locator('.comms .ln').allTextContents()).slice(-3).join(' | '));
};
