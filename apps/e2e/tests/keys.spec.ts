import { test, expect } from '@playwright/test';

test('create an API key and see the one-time secret', async ({ page }) => {
  await page.goto('/keys');

  // "New API key" (header) or "Create key" (empty state) — either works.
  const createBtn = page.getByRole('button', { name: /new api key|create key/i }).first();
  await createBtn.click();

  const suffix = Date.now().toString(36);
  const keyName = `e2e-key-${suffix}`;

  await page.getByText('Name', { exact: true }).locator('..').locator('input').fill(keyName);
  await page
    .getByText(/^Org ID/i)
    .locator('..')
    .locator('input')
    .fill('org_test');

  await page
    .getByRole('dialog', { name: /new api key/i })
    .getByRole('button', { name: /^create key$/i })
    .click();

  // The one-time-secret modal appears with the raw key.
  await expect(page.getByRole('heading', { name: /copy your key now/i })).toBeVisible({
    timeout: 15_000,
  });
  // The raw secret uses the "ck_live_<prefix>.<secret>" convention.
  await expect(page.locator('text=/ck_live_[a-f0-9]+\\./').first()).toBeVisible();

  await page.getByRole('button', { name: /stored it/i }).click();

  // The key row now shows up in the list.
  await expect(page.getByText(keyName, { exact: true })).toBeVisible({ timeout: 10_000 });
});
