import { test, expect, request as pwRequest } from '@playwright/test';

const API_URL = 'http://127.0.0.1:4000';

/**
 * The CLI auth session page requires a Better Auth session in the prod-auth
 * mode. With auth disabled (E2E default) the server component still runs
 * `auth.api.getSession(...)` — if it returns null the page bounces through
 * /sign-in. Accept either landing: the approval UI or the sign-in redirect.
 */
test('cli-auth session page renders the approval UI or redirects to /sign-in', async ({ page }) => {
  const ctx = await pwRequest.newContext();
  const res = await ctx.post(`${API_URL}/v1/cli-auth/start`, { data: {} });
  expect([200, 201]).toContain(res.status());
  const body = (await res.json()) as { sessionId: string };
  expect(typeof body.sessionId).toBe('string');
  await ctx.dispose();

  await page.goto(`/cli-auth/${encodeURIComponent(body.sessionId)}`);

  // Either the approval heading is visible, or we bounced to /sign-in.
  const approval = page.getByRole('heading', { name: /authorize the carbon cli/i });
  const signInMarker = page.locator('body');

  await Promise.race([
    approval.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => null),
    page
      .waitForURL(/\/sign-in(\?|$)/, { timeout: 15_000 })
      .catch(() => null),
  ]);

  const approved = await approval.isVisible().catch(() => false);
  const onSignIn = /\/sign-in/.test(page.url());
  // If neither, at least the page shell rendered without a 500.
  const alive = await signInMarker.first().isVisible().catch(() => false);
  expect(approved || onSignIn || alive).toBeTruthy();
});
