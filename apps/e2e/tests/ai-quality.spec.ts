import { test, expect, request as pwRequest } from '@playwright/test';

const API_URL = 'http://127.0.0.1:4000';

test('ai-quality page renders empty state or a report card for a project', async ({ page }) => {
  // Seed a project so the picker has something to select. If one already
  // exists we just take the first row on the page.
  const ctx = await pwRequest.newContext();
  const slug = `e2e-aiq-${Date.now().toString(36)}`;
  await ctx.post(`${API_URL}/v1/projects`, {
    data: { orgId: 'org_test', name: `aiq ${slug}`, slug },
  });
  await ctx.dispose();

  await page.goto('/ai-quality');

  // Wait for the picker's <select> to render (loaded projects) or for the
  // "no projects" hint.
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
    // Nothing to pick — this itself is a valid render.
    return;
  }

  // A project is selected by default. Expect either the empty state ("No AI
  // quality reports yet") or the "Latest report" heading.
  const empty = page.getByText(/no ai quality reports yet/i);
  const latest = page.getByRole('heading', { name: /latest report/i });

  await Promise.race([
    empty.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => null),
    latest.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => null),
  ]);

  const ok =
    (await empty.isVisible().catch(() => false)) || (await latest.isVisible().catch(() => false));
  expect(ok).toBeTruthy();
});
