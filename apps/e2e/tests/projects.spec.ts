import { test, expect } from '@playwright/test';

test('create a project and see it in the list', async ({ page }) => {
  await page.goto('/projects');

  await page.getByRole('button', { name: /new project/i }).first().click();

  const suffix = Date.now().toString(36);
  const name = `e2e project ${suffix}`;
  const slug = `e2e-${suffix}`;

  // The form doesn't attach ids to inputs; select by label text.
  await page.getByText('Name', { exact: true }).locator('..').locator('input').fill(name);
  await page
    .getByText(/^Slug/i)
    .locator('..')
    .locator('input')
    .fill(slug);
  await page
    .getByText(/^Org ID/i)
    .locator('..')
    .locator('input')
    .fill('org_test');

  await page.getByRole('button', { name: /^create project$/i }).click();

  // The list refreshes after creation; the new slug should appear as a row.
  await expect(page.getByText(slug, { exact: true })).toBeVisible({ timeout: 15_000 });
});
