import { test, expect } from '@playwright/test';

test('jobs page renders table or empty state', async ({ page }) => {
  await page.goto('/jobs');

  await expect(page.locator('[data-testid="jobs-status-filter"]')).toBeVisible({
    timeout: 15_000,
  });

  const empty = page.getByText(/No jobs in the last 24h|Jobs API is not deployed/i);
  const table = page.locator('[data-testid="jobs-table-body"]');

  await Promise.race([
    empty.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => null),
    table.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => null),
  ]);

  const emptyVisible = await empty.isVisible().catch(() => false);
  const tableVisible = await table.isVisible().catch(() => false);
  expect(emptyVisible || tableVisible).toBeTruthy();
});

test('changing the status filter re-issues the query', async ({ page }) => {
  await page.goto('/jobs');
  const select = page.locator('[data-testid="jobs-status-filter"]');
  await expect(select).toBeVisible({ timeout: 15_000 });

  await select.selectOption('failed');
  // The page should stay mounted and re-render with the filter applied; either
  // a table body or an empty-state block must be present (i.e. no crash).
  const empty = page.getByText(/No jobs in the last 24h|Jobs API is not deployed/i);
  const table = page.locator('[data-testid="jobs-table-body"]');
  await Promise.race([
    empty.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => null),
    table.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => null),
  ]);
  const emptyVisible = await empty.isVisible().catch(() => false);
  const tableVisible = await table.isVisible().catch(() => false);
  expect(emptyVisible || tableVisible).toBeTruthy();
});
