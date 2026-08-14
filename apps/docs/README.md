# Carbon Docs

Mintlify-powered documentation site for Carbon. Content lives in `.mdx` files
alongside `docs.json` (navigation + theme).

## Local dev

```bash
pnpm --filter @carbon/docs dev
```

Opens `http://localhost:3002`.

## Scripts

- `pnpm --filter @carbon/docs validate` — strict validation (fails on warnings)
- `pnpm --filter @carbon/docs build` — produce a static bundle (`docs-site.zip`)
- `pnpm --filter @carbon/docs check` — raw `mintlify broken-links`
- `pnpm --filter @carbon/docs check:links` — wrapper that exits nonzero on any
  broken link (CI-friendly)

## CI + deploy

The `docs-build` job in `.github/workflows/ci.yml`:

1. runs `pnpm --filter @carbon/docs validate` (strict)
2. runs `pnpm --filter @carbon/docs check:links`
3. runs `pnpm --filter @carbon/docs build` — produces `apps/docs/docs-site.zip`
4. uploads the unpacked site as a `github-pages` artifact

The `docs-deploy` job runs on `main` only and pushes that artifact to GitHub
Pages via `actions/deploy-pages@v4`. The workflow declares `pages: write` and
`id-token: write` permissions.

### Enabling the deploy

The deploy job is a no-op until an operator enables Pages in the repo
settings (Settings → Pages → Build and deployment source: **GitHub Actions**).

### Custom domain

No custom-domain `CNAME` is checked in right now. Add one only after the DNS
record exists and Pages is configured for that host.

### Auth-gated builds

If your Mintlify project requires an authenticated CLI (private preview,
premium features), add a `MINTLIFY_TOKEN` secret to the repo and the
`docs-build` / `docs-deploy` jobs will run — otherwise they are skipped via
`if: env.MINTLIFY_TOKEN != ''`. Public sites do not need the token.

To add the secret:

```bash
gh secret set MINTLIFY_TOKEN --body "$YOUR_TOKEN"
```
