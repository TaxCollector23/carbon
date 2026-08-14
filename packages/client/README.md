# @carbon/client

Officially-generated, typed TypeScript/JavaScript client for the
[Carbon](https://carbon-web-psi.vercel.app) control-plane API. Every method and every
response shape derives directly from the server's OpenAPI spec — there
are no hand-written per-endpoint methods, so the client is always in
lockstep with the API.

## Install

```bash
pnpm add @carbon/client
# or
npm i @carbon/client
```

Requires Node 18+ (or any runtime with a global `fetch`).

## Quickstart

```ts
import { createCarbonClient, CarbonError } from '@carbon/client';

const carbon = createCarbonClient({
  baseUrl: 'http://localhost:4000',
  apiKey: process.env.CARBON_API_KEY,
});

const { data, error } = await carbon.GET('/v1/projects');
if (error) throw new CarbonError(error);
console.log(data);

// POST with a typed body
const created = await carbon.POST('/v1/projects', {
  body: { name: 'demo', slug: 'demo' },
});
if (created.error) throw new CarbonError(created.error);
```

## Auth

Pass an `apiKey` and every request is sent with
`Authorization: Bearer <key>`. If your service instead relies on
cookies (e.g. a Better Auth session), skip `apiKey` and pass a `fetch`
that forwards `credentials: 'include'`.

## Regenerating types

The generated types live in `src/api-types.gen.ts`. Regenerate them
against the checked-in OpenAPI snapshot with:

```bash
pnpm --filter @carbon/client codegen
```

or from the repo root:

```bash
pnpm client:codegen
```

## Types

Raw wire types are re-exported for advanced use cases:

```ts
import type { paths, components } from '@carbon/client';

type Project = components['schemas']['Project'];
type ListProjectsResp =
  paths['/v1/projects']['get']['responses']['200']['content']['application/json'];
```
