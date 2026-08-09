import { test, expect } from '@playwright/test';

test('activity page renders timeline or empty state', async ({ page }) => {
  await page.goto('/activity');

  const empty = page.getByText(/no activity yet/i);
  const timeline = page.locator('[data-testid="activity-timeline"], table, ul[role="list"]');

  // Wait for whichever shows up first.
  await Promise.race([
    empty.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => null),
    timeline.first().waitFor({ state: 'visible', timeout: 15_000 }).catch(() => null),
  ]);

  const emptyVisible = await empty.isVisible().catch(() => false);
  const timelineVisible = await timeline.first().isVisible().catch(() => false);
  expect(emptyVisible || timelineVisible).toBeTruthy();
});
