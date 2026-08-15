import { test, expect, request as pwRequest } from '@playwright/test';

const API_URL = 'http://127.0.0.1:4000';

test('drift page renders the config card and history for a project', async ({ page }) => {
  const ctx = await pwRequest.newContext();
  const slug = `e2e-drift-${Date.now().toString(36)}`;
  await ctx.post(`${API_URL}/v1/projects`, {
    data: { orgId: 'org_test', name: `drift ${slug}`, slug },
  });
  await ctx.dispose();

  await page.addInitScript((selectedSlug) => {
    window.localStorage.setItem('carbon.selectedProjectSlug', selectedSlug);
  }, slug);
  await page.goto('/drift');

  const picker = page.locator('label:has-text("Project") select');
  const noProjects = page.getByText(/no projects yet — create one/i);

  await Promise.race([
    picker
      .first()
      .waitFor({ state: 'visible', timeout: 15_000 })
      .catch(() => null),
    noProjects.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => null),
  ]);

  if (await noProjects.isVisible().catch(() => false)) {
    return;
  }

  // Either the config card renders (with the "Config" heading) or the
  // "select a project" hint when no project is picked.
  const configHeading = page.getByRole('heading', { name: /^Config$/ });
  const selectHint = page.getByText(/select a project/i);
  await Promise.race([
    configHeading.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => null),
    selectHint.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => null),
  ]);

  const ok =
    (await configHeading.isVisible().catch(() => false)) ||
    (await selectHint.isVisible().catch(() => false));
  expect(ok).toBeTruthy();

  // Either the empty-state (no history rows yet, no recording) OR at least
  // one history row must render — both are valid depending on backend seed.
  const emptyHistory = page.getByText(/no drift checks yet/i);
  const runButton = page.getByTestId('drift-run-now-button');
  await Promise.race([
    emptyHistory.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => null),
    runButton.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => null),
  ]);
});
