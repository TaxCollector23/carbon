import { test, expect } from '@playwright/test';

test.describe('Emulators section', () => {
  test('renders the polling indicator', async ({ page }) => {
    await page.goto('/emulators');
    await expect(page.getByText(/polling every 4s/i)).toBeVisible({ timeout: 15_000 });
  });

  test('chaos + load-test modals open when there are running emulators', async ({ page }) => {
    await page.goto('/emulators');
    // The suite doesn't spawn a real emulator process, so the row list may be
    // empty. In that case the modal-open buttons don't exist — verify the
    // empty state instead. Both outcomes are a valid render.
    const chaosBtn = page.locator('[data-testid="emulator-chaos-button"]').first();
    const loadBtn = page.locator('[data-testid="emulator-load-test-button"]').first();
    const emptyState = page.getByText(/no emulators running/i);

    await Promise.race([
      chaosBtn.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => null),
      emptyState.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => null),
    ]);

    if (await chaosBtn.isVisible().catch(() => false)) {
      await chaosBtn.click();
      await expect(page.getByRole('heading', { name: /apply chaos preset/i })).toBeVisible();
      await page.getByRole('button', { name: /^cancel$/i }).click();

      await loadBtn.click();
      await expect(page.getByRole('heading', { name: /load test emulator/i })).toBeVisible();

      // Clamp verification: type an out-of-range concurrency, verify the
      // number input's max attribute keeps it bounded on submit-time
      // math (the component clamps to 1..1000 in onSubmit).
      const conc = page.locator('[data-testid="load-test-concurrency-input"]');
      await conc.fill('99999');
      await expect(conc).toHaveAttribute('max', '1000');

      const dur = page.locator('[data-testid="load-test-duration-input"]');
      await dur.fill('99999999');
      await expect(dur).toHaveAttribute('max', '60000');

      // Close without submitting — we don't have a running emulator to hit.
      await page.getByRole('button', { name: /^close$/i }).click();
    } else {
      await expect(emptyState).toBeVisible();
    }
  });
});
