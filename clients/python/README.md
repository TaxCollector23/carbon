# carbon-client

Official Python client for the [Carbon](https://carbon-web-psi.vercel.app) control-plane API.
Thin sync + async wrapper over [`httpx`](https://www.python-httpx.org/) with
typed responses for the top control-plane endpoints.

## Install

```bash
pip install carbon-client
```

Requires Python 3.9+.

## Quickstart (sync)

```python
from carbon_client import CarbonClient, CarbonError

carbon = CarbonClient(
    base_url="http://localhost:4000",
    api_key="ck_live_xxx",  # optional; sent as `Authorization: Bearer <key>`
)

try:
    projects = carbon.list_projects()
    for p in projects:
        print(p.id, p.slug)
except CarbonError as err:
    print(f"[{err.status}] {err.code}: {err.message}")
```

## Quickstart (async)

```python
import asyncio
from carbon_client import CarbonClient

async def main() -> None:
    async with CarbonClient(base_url="http://localhost:4000") as carbon:
        health = await carbon.aget_health()
        print(health.status)

asyncio.run(main())
```

## Methods

The hand-written surface covers the top 10 control-plane endpoints:

| Method           | Endpoint                |
| ---------------- | ----------------------- |
| `list_projects`  | `GET /v1/projects`      |
| `create_project` | `POST /v1/projects`     |
| `get_project`    | `GET /v1/projects/{id}` |
| `list_snapshots` | `GET /v1/snapshots`     |
| `list_emulators` | `GET /v1/emulators`     |
| `list_events`    | `GET /v1/events`        |
| `list_api_keys`  | `GET /v1/api-keys`      |
| `create_api_key` | `POST /v1/api-keys`     |
| `list_usage`     | `GET /v1/usage`         |
| `get_health`     | `GET /v1/health/live`   |

Each has an `a`-prefixed async twin (`alist_projects`, `acreate_project`, …)
usable via `async with CarbonClient(...)`.

For endpoints not in the hand-written surface, use
`carbon.request("GET", "/v1/anything", params={...})` — it returns the parsed
JSON body directly.

## Errors

All non-2xx responses raise `CarbonError(status, code, message, details)`.

## Regenerating (aspirational)

A regeneration stub lives at `scripts/codegen.py` — it reads
`apps/dashboard/lib/openapi.snapshot.json` from the Carbon monorepo and
prints per-endpoint method stubs. Not run on install.

## License

MIT
