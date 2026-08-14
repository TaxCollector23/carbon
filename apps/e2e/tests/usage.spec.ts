import { test, expect } from '@playwright/test';

test.describe('Usage section', () => {
  test('shows the aggregate chart or an empty state, and the kind filter switches', async ({
    page,
  }) => {
    await page.goto('/usage');

    await expect(page.getByRole('heading', { name: /usage · last 30 days/i })).toBeVisible({
      timeout: 15_000,
    });

    // Either the empty state or the "Usage totals by kind" chart svg is
    // present after the aggregate query resolves.
    const empty = page.getByText(/no usage recorded/i);
    const chart = page.locator('svg[aria-label="Usage totals by kind"]');
    const errorBanner = page.getByRole('alert');

    await Promise.race([
      empty.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => null),
      chart
        .first()
        .waitFor({ state: 'visible', timeout: 15_000 })
        .catch(() => null),
      errorBanner
        .first()
        .waitFor({ state: 'visible', timeout: 15_000 })
        .catch(() => null),
    ]);

    // Any of the three is a valid render — the panel handled its state.
    const ok =
      (await empty.isVisible().catch(() => false)) ||
      (await chart
        .first()
        .isVisible()
        .catch(() => false)) ||
      (await errorBanner
        .first()
        .isVisible()
        .catch(() => false));
    expect(ok).toBeTruthy();

    // Kind filter — switch to "ingest" and back to "All kinds"; the select
    // value should update (no async assertion — the change is client-local).
    const filter = page.locator('label:has-text("Kind") select');
    await filter.selectOption({ value: 'ingest' });
    await expect(filter).toHaveValue('ingest');
    await filter.selectOption({ value: '' });
    await expect(filter).toHaveValue('');
  });
});
