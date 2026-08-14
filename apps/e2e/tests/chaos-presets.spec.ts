import { test, expect } from '@playwright/test';

test('create a chaos preset and see it in the list', async ({ page }) => {
  await page.goto('/chaos-presets');

  await page.locator('[data-testid="new-chaos-preset-button"]').first().click();
  await expect(page.getByRole('heading', { name: /new chaos preset/i })).toBeVisible();

  const suffix = Date.now().toString(36);
  const name = `e2e-preset-${suffix}`;
  await page.locator('[data-testid="chaos-preset-name-input"]').fill(name);

  const rules = JSON.stringify([{ kind: 'latency', floorMs: 100, jitterMs: 50 }], null, 2);
  const rulesInput = page.locator('[data-testid="chaos-preset-rules-input"]');
  await rulesInput.fill(rules);

  await page.getByRole('button', { name: /^create preset$/i }).click();

  // The list refreshes after creation; the new row should appear.
  await expect(page.getByText(name, { exact: true })).toBeVisible({ timeout: 15_000 });
});
