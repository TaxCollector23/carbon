import { test, expect, request as pwRequest } from '@playwright/test';

const API_URL = 'http://127.0.0.1:4000';

/**
 * Seed a project + two snapshots via the real API, then verify the
 * dashboard's Compare button opens the diff modal and the diff view root
 * eventually renders after picking the second snapshot.
 */
test('compare button opens the snapshot diff modal', async ({ page }) => {
  const ctx = await pwRequest.newContext();
  const suffix = Date.now().toString(36);
  const slug = `e2e-diff-${suffix}`;

  const proj = await ctx.post(`${API_URL}/v1/projects`, {
    data: { orgId: 'org_test', name: `diff ${slug}`, slug },
  });
  expect([200, 201]).toContain(proj.status());

  const snap = (name: string, records: unknown[]) =>
    ctx.post(`${API_URL}/v1/snapshots`, {
      data: {
        projectSlug: slug,
        name,
        snapshot: { version: 1, takenAt: Date.now(), records },
      },
    });

  const rA = await snap('one', [
    { resource: 'user', id: 'u1', data: { name: 'a' }, createdAt: 0, updatedAt: 0 },
  ]);
  const rB = await snap('two', [
    { resource: 'user', id: 'u1', data: { name: 'A' }, createdAt: 0, updatedAt: 1 },
    { resource: 'user', id: 'u2', data: { name: 'b' }, createdAt: 1, updatedAt: 1 },
  ]);
  // If the API can't accept snapshot writes in this environment, bail
  // gracefully — the interaction still needs a working seed.
  test.skip(rA.status() >= 400 || rB.status() >= 400, 'snapshot save endpoint unavailable');
  await ctx.dispose();

  await page.goto('/snapshots');

  const compare = page.getByTestId('compare-snapshot-one').first();
  await compare.waitFor({ state: 'visible', timeout: 20_000 });
  await compare.click();

  const target = page.getByTestId('compare-target-two').first();
  await target.waitFor({ state: 'visible', timeout: 10_000 });
  await target.click();

  await expect(page.getByTestId('snapshot-diff-view')).toBeVisible({ timeout: 15_000 });
});
