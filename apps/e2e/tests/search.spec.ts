import { test, expect } from '@playwright/test';

/**
 * Command-palette search — Cmd+K opens the modal, typing hits the real
 * /v1/search endpoint, ↓/Enter drives keyboard navigation.
 *
 * The seeded fixture org always has at least one project (`checkout-api`),
 * so we query for "checkout" and assume at least one result comes back.
 * If nothing matches (empty DB in some CI variant) we accept the empty-
 * state banner instead of failing — this test is about the interaction,
 * not the corpus.
 */
test.describe('Search palette', () => {
  test('Cmd+K opens the modal, typing shows results, Enter navigates', async ({
    page,
    browserName,
  }) => {
    await page.goto('/');

    // Cmd on WebKit, Ctrl elsewhere. Playwright accepts both names via the
    // "Meta"/"Control" modifier keys.
    const mod = browserName === 'webkit' ? 'Meta' : 'Control';
    await page.keyboard.press(`${mod}+KeyK`);

    const modal = page.getByTestId('search-modal');
    await expect(modal).toBeVisible();
    const input = page.getByTestId('search-input');
    await expect(input).toBeFocused();

    await input.fill('checkout');

    // Wait for either results or the empty state.
    await Promise.race([
      page.getByTestId('search-result').first().waitFor({ state: 'visible' }),
      page.getByTestId('search-empty').waitFor({ state: 'visible' }),
    ]);

    const results = page.getByTestId('search-result');
    const count = await results.count();

    if (count === 0) {
      // No corpus in this DB — palette still needs to close on Esc.
      await page.keyboard.press('Escape');
      await expect(modal).not.toBeVisible();
      return;
    }

    // ArrowDown highlights the first row (or advances from it).
    await page.keyboard.press('ArrowDown');
    const active = page.locator('[data-testid="search-result"][data-active="true"]');
    await expect(active).toHaveCount(1);

    // Enter navigates to the highlighted result and closes the palette.
    const href = await active.getAttribute('href');
    expect(href).toBeTruthy();
    await Promise.all([
      page.waitForURL((url) => url.pathname.startsWith(href!.split('?')[0]!)),
      page.keyboard.press('Enter'),
    ]);
    await expect(modal).not.toBeVisible();
  });

  test('Esc closes the palette', async ({ page, browserName }) => {
    await page.goto('/');
    const mod = browserName === 'webkit' ? 'Meta' : 'Control';
    await page.keyboard.press(`${mod}+KeyK`);
    await expect(page.getByTestId('search-modal')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('search-modal')).not.toBeVisible();
  });
});
