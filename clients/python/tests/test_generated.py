"""Tests for the auto-generated full-surface client + pagination helper."""

from __future__ import annotations

import httpx
import respx

from carbon_client import Carbon, CarbonClient

BASE = "http://carbon.test"


@respx.mock
def test_generated_list_unwraps_data_envelope() -> None:
    respx.get(f"{BASE}/v1/projects").mock(
        return_value=httpx.Response(
            200,
            json={
                "data": [{"id": "proj_1", "orgId": "org_1", "slug": "demo", "name": "Demo"}],
                "nextCursor": None,
                "hasMore": False,
            },
        )
    )
    carbon = Carbon(base_url=BASE)
    try:
        rows = carbon.get_projects()
        assert rows == [{"id": "proj_1", "orgId": "org_1", "slug": "demo", "name": "Demo"}]
    finally:
        carbon.close()


@respx.mock
def test_generated_path_param_and_body() -> None:
    post = respx.post(f"{BASE}/v1/projects").mock(
        return_value=httpx.Response(
            201, json={"id": "proj_2", "orgId": "org_1", "slug": "new", "name": "New"}
        )
    )
    get = respx.get(f"{BASE}/v1/projects/proj_2").mock(
        return_value=httpx.Response(
            200, json={"id": "proj_2", "orgId": "org_1", "slug": "new", "name": "New"}
        )
    )
    carbon = Carbon(base_url=BASE)
    try:
        created = carbon.post_projects(body={"name": "New", "slug": "new"})
        fetched = carbon.get_projects_id(id="proj_2")
        assert post.called and get.called
        assert created["slug"] == "new"
        assert fetched["id"] == "proj_2"
    finally:
        carbon.close()


@respx.mock
def test_paginate_walks_cursor() -> None:
    respx.get(f"{BASE}/v1/events").mock(
        side_effect=[
            httpx.Response(
                200,
                json={
                    "data": [{"id": "evt_1", "action": "a"}],
                    "nextCursor": "cur_2",
                    "hasMore": True,
                },
            ),
            httpx.Response(
                200,
                json={
                    "data": [{"id": "evt_2", "action": "b"}],
                    "nextCursor": None,
                    "hasMore": False,
                },
            ),
        ]
    )
    carbon = CarbonClient(base_url=BASE)
    try:
        rows = list(carbon.paginate("GET", "/v1/events"))
        assert [r["id"] for r in rows] == ["evt_1", "evt_2"]
    finally:
        carbon.close()


@respx.mock
def test_async_generated_twin() -> None:
    respx.get(f"{BASE}/v1/health/live").mock(
        return_value=httpx.Response(200, json={"ok": True, "service": "api", "version": "v1"})
    )
    import asyncio

    async def run() -> None:
        async with Carbon(base_url=BASE) as carbon:
            data = await carbon.aget_health_live()
            assert data["ok"] is True

    asyncio.run(run())
