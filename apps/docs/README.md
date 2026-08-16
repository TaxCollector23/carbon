# Carbon Docs

[Astro Starlight](https://starlight.astro.build)-powered documentation site,
deployed to GitHub Pages at `https://taxcollector23.github.io/carbon/`.

Content lives as MDX under `src/content/docs/`; navigation is configured in
`astro.config.mjs`.

## Local dev

```bash
pnpm install
pnpm --filter @carbon/docs dev
```

Opens `http://localhost:3002`.

## Scripts

- `pnpm --filter @carbon/docs check` — `astro check` (typechecks MDX + config)
- `pnpm --filter @carbon/docs check:links` — fail on broken internal links
- `pnpm --filter @carbon/docs build` — static export to `apps/docs/dist`

## CI + deploy

The `docs-build` job in `.github/workflows/ci.yml` typechecks, checks links,
and builds the site; `docs-deploy` publishes the `dist/` output to GitHub
Pages via `actions/deploy-pages@v4`. Both run on pushes to `master`. The
`base` path (`/carbon`) and `site` URL live in `astro.config.mjs` — update
both together if the repo is renamed or moved to a custom domain.

### Enabling the deploy

Pages must be set to **Build and deployment source: GitHub Actions** in the
repo settings (Settings → Pages). The workflow already declares the required
`pages: write` and `id-token: write` permissions.

### Custom domain

No custom-domain `CNAME` is checked in. Add one to `apps/docs/public/CNAME`
only after the DNS record exists and Pages is configured for that host.
