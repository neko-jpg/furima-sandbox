import { expect, test } from '@playwright/test';
import { assertNoPageErrors, installPageGuards, resetSandbox } from './_sandbox.mjs';

test('visible interactive controls expose an accessible name and usable target', async ({ page }) => {
  const errors = await installPageGuards(page);
  await page.goto('/');
  await resetSandbox(page, 'controls');

  const controls = page.locator('button:visible, a:visible, input:visible, textarea:visible, select:visible');
  const count = await controls.count();
  expect(count).toBeGreaterThan(20);
  const unnamed = [];
  for (let index = 0; index < count; index += 1) {
    const control = controls.nth(index);
    if (await control.isDisabled().catch(() => false)) continue;
    const name = await control.evaluate((element) => {
      const aria = element.getAttribute('aria-label') || element.getAttribute('title');
      const text = element.textContent?.replace(/\s+/gu, ' ').trim();
      const placeholder = element.getAttribute('placeholder');
      const alt = element.querySelector('img')?.getAttribute('alt');
      return (aria || text || placeholder || alt || '').trim();
    });
    if (!name) unnamed.push(await control.evaluate((element) => element.outerHTML.slice(0, 240)));
  }
  expect(unnamed, `unnamed controls:\n${unnamed.join('\n')}`).toEqual([]);
  await assertNoPageErrors(errors);
});
