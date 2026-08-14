import { test, expect, request as pwRequest } from '@playwright/test';

const API_URL = 'http://127.0.0.1:4000';

/**
 * Snapshots are per-project. Without a selected project the page shows
 * a "Select a project" empty state; once we seed a project it should
 * either surface the "No snapshots yet" empty text or a table of rows.
 */
test.describe('Snapshots section', () => {
  test('shows the select-a-project empty state when no project is picked', async ({ page }) => {
    await page.goto('/snapshots');

    // Either we already have projects (leftover from other specs in the same
    // serial run) and land on the per-project empty state, or we have no
    // projects at all and the picker itself explains that.
    const selectProject = page.getByText(/select a project/i).first();
    const noSnapshots = page.getByText(/no snapshots yet/i);
    const table = page.locator('table');
    const noProjects = page.getByText(/no projects yet — create one/i);

    await Promise.race([
      selectProject.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => null),
      noSnapshots.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => null),
      table
        .first()
        .waitFor({ state: 'visible', timeout: 15_000 })
        .catch(() => null),
      noProjects.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => null),
    ]);

    const anyVisible =
      (await selectProject.isVisible().catch(() => false)) ||
      (await noSnapshots.isVisible().catch(() => false)) ||
      (await table
        .first()
        .isVisible()
        .catch(() => false)) ||
      (await noProjects.isVisible().catch(() => false));
    expect(anyVisible).toBeTruthy();
  });

  test('with a seeded project the snapshots panel renders empty state or rows', async ({
    page,
  }) => {
    // Seed one project via the real API so the picker has something to pick.
    const ctx = await pwRequest.newContext();
    const slug = `e2e-snap-${Date.now().toString(36)}`;
    const res = await ctx.post(`${API_URL}/v1/projects`, {
      data: { orgId: 'org_test', name: `snap ${slug}`, slug },
    });
    // Accept 201 (created) or 200 (idempotent replay); anything else is fatal.
    expect([200, 201]).toContain(res.status());
    await ctx.dispose();

    await page.goto('/snapshots');

    // Once projects load, either the empty state text for snapshots renders
    // or a table of names is present.
    const noSnapshots = page.getByText(/no snapshots yet/i);
    const table = page.locator('table');
    await Promise.race([
      noSnapshots.waitFor({ state: 'visible', timeout: 20_000 }).catch(() => null),
      table
        .first()
        .waitFor({ state: 'visible', timeout: 20_000 })
        .catch(() => null),
    ]);
    const ok =
      (await noSnapshots.isVisible().catch(() => false)) ||
      (await table
        .first()
        .isVisible()
        .catch(() => false));
    expect(ok).toBeTruthy();
  });
});
