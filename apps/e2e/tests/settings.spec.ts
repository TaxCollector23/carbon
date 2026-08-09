import { test, expect } from '@playwright/test';

/**
 * The Settings section first resolves "current organization" — with auth
 * disabled and no ?orgId= hint that endpoint 404s, which lands the UI on
 * the OrgIdPrompt ("Point the dashboard at an org"). Typing org_test and
 * clicking Load persists the org id in localStorage and re-fetches, at
 * which point the Organization form + members panel render.
 */
test('settings — point at org, edit slack webhook, verify persistence', async ({ page }) => {
  await page.goto('/settings');

  // The prompt may or may not appear depending on whether a prior test in
  // the same serial run seeded localStorage. If it's present, fill it.
  const promptHeading = page.getByRole('heading', {
    name: /point the dashboard at an org/i,
  });
  const orgForm = page.getByRole('heading', { name: /^organization$/i });

  const seenPrompt = await promptHeading.isVisible({ timeout: 5_000 }).catch(() => false);
  if (seenPrompt) {
    await page.getByPlaceholder('org_…').fill('org_test');
    await page.getByRole('button', { name: /^load$/i }).click();
  }

  await expect(orgForm).toBeVisible({ timeout: 15_000 });

  // The members section header renders once org.data is loaded.
  await expect(page.getByRole('heading', { name: /^members$/i })).toBeVisible();

  // Slack webhook — write, save, reload, verify it stuck.
  const slack = page.getByPlaceholder(/hooks\.slack\.com/i);
  await expect(slack).toBeVisible();
  const suffix = Date.now().toString(36);
  const hookUrl = `https://hooks.slack.com/services/E2E/${suffix}/token${suffix}`;
  await slack.fill(hookUrl);
  await page.getByRole('button', { name: /^save webhooks$/i }).click();
  // Success message appears inline.
  await expect(page.getByText(/^saved\.$/i)).toBeVisible({ timeout: 15_000 });

  // Reload and confirm the value is still there.
  await page.reload();
  const slackAfter = page.getByPlaceholder(/hooks\.slack\.com/i);
  await expect(slackAfter).toBeVisible({ timeout: 15_000 });
  await expect(slackAfter).toHaveValue(hookUrl);
});
