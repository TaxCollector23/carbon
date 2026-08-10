"""One round-trip per top-10 hand-written method, mocked with respx."""

from __future__ import annotations

import httpx
import pytest
import respx

from carbon_client import CarbonClient, CarbonError
from carbon_client.models import (
    ApiKey,
    Emulator,
    Event,
    HealthResponse,
    Project,
    Snapshot,
    UsageResponse,
)

BASE = "http://carbon.test"


@pytest.fixture
def client():
    c = CarbonClient(base_url=BASE, api_key="ck_test_123")
    yield c
    c.close()


# ---- 1. list_projects ---------------------------------------------------

@respx.mock
def test_list_projects(client: CarbonClient) -> None:
    route = respx.get(f"{BASE}/v1/projects").mock(
        return_value=httpx.Response(
            200,
            json={"projects": [{"id": "proj_1", "slug": "demo", "name": "Demo"}]},
        )
    )
    projects = client.list_projects()
    assert route.called
    assert projects == [Project(id="proj_1", slug="demo", name="Demo")]
    # auth header propagates
    assert route.calls.last.request.headers["authorization"] == "Bearer ck_test_123"


# ---- 2. create_project --------------------------------------------------

@respx.mock
def test_create_project(client: CarbonClient) -> None:
    route = respx.post(f"{BASE}/v1/projects").mock(
        return_value=httpx.Response(
            201,
            json={"project": {"id": "proj_2", "slug": "new", "name": "New"}},
        )
    )
    proj = client.create_project(name="New", slug="new")
    assert route.called
    assert proj.id == "proj_2"
    assert proj.slug == "new"


# ---- 3. get_project -----------------------------------------------------

@respx.mock
def test_get_project(client: CarbonClient) -> None:
    respx.get(f"{BASE}/v1/projects/proj_1").mock(
        return_value=httpx.Response(200, json={"id": "proj_1", "slug": "demo", "name": "Demo"})
    )
    proj = client.get_project("proj_1")
    assert proj == Project(id="proj_1", slug="demo", name="Demo")


# ---- 4. list_snapshots --------------------------------------------------

@respx.mock
def test_list_snapshots(client: CarbonClient) -> None:
    respx.get(f"{BASE}/v1/snapshots").mock(
        return_value=httpx.Response(
            200,
            json={"snapshots": [{"id": "snap_1", "name": "nightly", "projectSlug": "demo"}]},
        )
    )
    snaps = client.list_snapshots(project_id="proj_1")
    assert snaps == [Snapshot(id="snap_1", name="nightly", projectSlug="demo")]


# ---- 5. list_emulators --------------------------------------------------

@respx.mock
def test_list_emulators(client: CarbonClient) -> None:
    respx.get(f"{BASE}/v1/emulators").mock(
        return_value=httpx.Response(
            200,
            json={"emulators": [{"id": "emu_1", "name": "e1", "status": "running"}]},
        )
    )
    emus = client.list_emulators()
    assert emus == [Emulator(id="emu_1", name="e1", status="running")]


# ---- 6. list_events -----------------------------------------------------

@respx.mock
def test_list_events(client: CarbonClient) -> None:
    respx.get(f"{BASE}/v1/events").mock(
        return_value=httpx.Response(
            200,
            json={
                "events": [
                    {"id": "evt_1", "type": "project.created", "payload": {"a": 1}},
                ]
            },
        )
    )
    events = client.list_events(project_id="proj_1", limit=25)
    assert events == [Event(id="evt_1", type="project.created", payload={"a": 1})]


# ---- 7. list_api_keys ---------------------------------------------------

@respx.mock
def test_list_api_keys(client: CarbonClient) -> None:
    respx.get(f"{BASE}/v1/api-keys").mock(
        return_value=httpx.Response(
            200,
            json={"keys": [{"id": "ak_1", "name": "ci", "prefix": "ck_live_abc"}]},
        )
    )
    keys = client.list_api_keys()
    assert keys == [ApiKey(id="ak_1", name="ci", prefix="ck_live_abc")]


# ---- 8. create_api_key --------------------------------------------------

@respx.mock
def test_create_api_key(client: CarbonClient) -> None:
    respx.post(f"{BASE}/v1/api-keys").mock(
        return_value=httpx.Response(
            201,
            json={
                "key": {
                    "id": "ak_2",
                    "name": "new",
                    "prefix": "ck_live_xyz",
                    "key": "ck_live_xyz_secret",
                }
            },
        )
    )
    key = client.create_api_key(name="new")
    assert key.id == "ak_2"
    assert key.key == "ck_live_xyz_secret"


# ---- 9. list_usage ------------------------------------------------------

@respx.mock
def test_list_usage(client: CarbonClient) -> None:
    respx.get(f"{BASE}/v1/usage").mock(
        return_value=httpx.Response(
            200,
            json={
                "total": {"requests": 42, "ingested": 100, "egress": 7},
                "buckets": [
                    {"period": "2026-08", "requests": 42, "ingested": 100, "egress": 7}
                ],
            },
        )
    )
    usage = client.list_usage(org_id="org_1", period="2026-08")
    assert isinstance(usage, UsageResponse)
    assert usage.total["requests"] == 42
    assert usage.buckets[0].period == "2026-08"


# ---- 10. get_health -----------------------------------------------------

@respx.mock
def test_get_health(client: CarbonClient) -> None:
    respx.get(f"{BASE}/v1/health/live").mock(
        return_value=httpx.Response(200, json={"status": "ok", "version": "1.2.3"})
    )
    health = client.get_health()
    assert health == HealthResponse(status="ok", version="1.2.3")


# ---- error handling -----------------------------------------------------

@respx.mock
def test_carbon_error_raised(client: CarbonClient) -> None:
    respx.get(f"{BASE}/v1/projects/missing").mock(
        return_value=httpx.Response(
            404,
            json={"code": "CARBON_NOT_FOUND", "message": "no such project", "status": 404},
        )
    )
    with pytest.raises(CarbonError) as excinfo:
        client.get_project("missing")
    assert excinfo.value.status == 404
    assert excinfo.value.code == "CARBON_NOT_FOUND"
    assert "no such project" in excinfo.value.message


# ---- async smoke --------------------------------------------------------

@pytest.mark.asyncio
@respx.mock
async def test_async_get_health() -> None:
    respx.get(f"{BASE}/v1/health/live").mock(
        return_value=httpx.Response(200, json={"status": "ok"})
    )
    async with CarbonClient(base_url=BASE) as carbon:
        health = await carbon.aget_health()
    assert health.status == "ok"
