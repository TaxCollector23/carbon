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

The package ships two surfaces on the same class hierarchy:

- **`Carbon`** (`CarbonGenerated`) — a full-surface client with one method per
  API route, generated from the committed OpenAPI snapshot. List endpoints are
  unwrapped from their `{"data": [...]}` envelope for you.
- **`CarbonClient`** — the hand-written base with the 10 most common,
  ergonomically-typed methods (`list_projects`, `create_project`, `get_project`,
  `list_snapshots`, `list_emulators`, `list_events`, `list_api_keys`,
  `create_api_key`, `list_usage`, `get_health`) plus the low-level `request`.

Every method has an `a`-prefixed async twin (`aget_health_live`,
`alist_projects`, …) usable via `async with Carbon(...)`.

```python
from carbon_client import Carbon

carbon = Carbon(base_url="http://localhost:4000", api_key="ck_live_xxx")
projects = carbon.get_projects()          # GET /v1/projects -> [Project, ...]
health = await carbon.aget_health_live()  # async twin
```

For cursor-paginated lists, use `paginate`/`apaginate`, which walk
`nextCursor` for you:

```python
for event in carbon.paginate("GET", "/v1/events"):
    print(event["action"])
```

## Errors

All non-2xx responses raise `CarbonError(status, code, message, details)`.

## Regenerating

`carbon_client/generated.py` is committed and kept in sync with the API schema
by CI. To regenerate it after the schema changes:

```bash
cd clients/python
make codegen        # or: python scripts/codegen.py ../../apps/dashboard/lib/openapi.snapshot.json > carbon_client/generated.py
```

Run `make lint` and `make test` before committing.

## License

MIT
