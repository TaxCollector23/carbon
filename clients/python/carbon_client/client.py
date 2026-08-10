"""Sync + async client for the Carbon control-plane API.

Mirrors the JS `@carbon/client` package (`packages/client/src/index.ts`) —
same constructor shape (`base_url`, `api_key`) and same auth semantics
(`Authorization: Bearer <key>` when `api_key` is provided).
"""

from __future__ import annotations

from types import TracebackType
from typing import Any, Dict, List, Mapping, Optional, Type, Union

import httpx

from .exceptions import CarbonError
from .models import (
    ApiKey,
    Emulator,
    Event,
    HealthResponse,
    Project,
    Snapshot,
    UsageResponse,
)

JSON = Union[Dict[str, Any], List[Any], str, int, float, bool, None]

DEFAULT_TIMEOUT = 30.0
_USER_AGENT = "carbon-client-python/0.1.0"


class CarbonClient:
    """Thin sync + async wrapper over `httpx.Client` / `httpx.AsyncClient`.

    Both surfaces are hosted on the same instance: synchronous methods use
    the underlying `httpx.Client`, and their `a`-prefixed twins use an
    `httpx.AsyncClient`. Use `with CarbonClient(...)` or
    `async with CarbonClient(...)` to close the underlying transports.
    """

    def __init__(
        self,
        base_url: str,
        api_key: Optional[str] = None,
        *,
        timeout: float = DEFAULT_TIMEOUT,
        headers: Optional[Mapping[str, str]] = None,
        transport: Optional[httpx.BaseTransport] = None,
        async_transport: Optional[httpx.AsyncBaseTransport] = None,
    ) -> None:
        if not base_url:
            raise ValueError("base_url is required")
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        base_headers: Dict[str, str] = {
            "accept": "application/json",
            "user-agent": _USER_AGENT,
        }
        if api_key:
            base_headers["authorization"] = f"Bearer {api_key}"
        if headers:
            base_headers.update({k.lower(): v for k, v in headers.items()})

        self._sync = httpx.Client(
            base_url=self.base_url,
            headers=base_headers,
            timeout=timeout,
            transport=transport,
        )
        self._async = httpx.AsyncClient(
            base_url=self.base_url,
            headers=base_headers,
            timeout=timeout,
            transport=async_transport,
        )

    # ---- lifecycle ------------------------------------------------------

    def close(self) -> None:
        self._sync.close()

    async def aclose(self) -> None:
        await self._async.aclose()

    def __enter__(self) -> "CarbonClient":
        return self

    def __exit__(
        self,
        exc_type: Optional[Type[BaseException]],
        exc: Optional[BaseException],
        tb: Optional[TracebackType],
    ) -> None:
        self.close()

    async def __aenter__(self) -> "CarbonClient":
        return self

    async def __aexit__(
        self,
        exc_type: Optional[Type[BaseException]],
        exc: Optional[BaseException],
        tb: Optional[TracebackType],
    ) -> None:
        await self.aclose()

    # ---- low-level ------------------------------------------------------

    def request(
        self,
        method: str,
        path: str,
        *,
        params: Optional[Mapping[str, Any]] = None,
        json: Any = None,
    ) -> JSON:
        """Send a request and return the parsed JSON body.

        Raises `CarbonError` for non-2xx responses.
        """
        resp = self._sync.request(method, path, params=params, json=json)
        return _parse(resp)

    async def arequest(
        self,
        method: str,
        path: str,
        *,
        params: Optional[Mapping[str, Any]] = None,
        json: Any = None,
    ) -> JSON:
        resp = await self._async.request(method, path, params=params, json=json)
        return _parse(resp)

    # ---- top-10 hand-written surface ------------------------------------

    # 1. GET /v1/projects
    def list_projects(self, *, org_id: Optional[str] = None) -> List[Project]:
        data = self.request("GET", "/v1/projects", params=_org_params(org_id))
        return [Project.from_dict(x) for x in _as_list(data, "projects")]

    async def alist_projects(self, *, org_id: Optional[str] = None) -> List[Project]:
        data = await self.arequest("GET", "/v1/projects", params=_org_params(org_id))
        return [Project.from_dict(x) for x in _as_list(data, "projects")]

    # 2. POST /v1/projects
    def create_project(
        self,
        *,
        name: str,
        slug: str,
        org_id: Optional[str] = None,
    ) -> Project:
        body: Dict[str, Any] = {"name": name, "slug": slug}
        if org_id is not None:
            body["orgId"] = org_id
        data = self.request("POST", "/v1/projects", json=body)
        return Project.from_dict(_unwrap(data, "project"))

    async def acreate_project(
        self,
        *,
        name: str,
        slug: str,
        org_id: Optional[str] = None,
    ) -> Project:
        body: Dict[str, Any] = {"name": name, "slug": slug}
        if org_id is not None:
            body["orgId"] = org_id
        data = await self.arequest("POST", "/v1/projects", json=body)
        return Project.from_dict(_unwrap(data, "project"))

    # 3. GET /v1/projects/{id}
    def get_project(self, project_id: str) -> Project:
        data = self.request("GET", f"/v1/projects/{project_id}")
        return Project.from_dict(_unwrap(data, "project"))

    async def aget_project(self, project_id: str) -> Project:
        data = await self.arequest("GET", f"/v1/projects/{project_id}")
        return Project.from_dict(_unwrap(data, "project"))

    # 4. GET /v1/snapshots
    def list_snapshots(self, *, project_id: Optional[str] = None) -> List[Snapshot]:
        params = {"projectId": project_id} if project_id else None
        data = self.request("GET", "/v1/snapshots", params=params)
        return [Snapshot.from_dict(x) for x in _as_list(data, "snapshots")]

    async def alist_snapshots(self, *, project_id: Optional[str] = None) -> List[Snapshot]:
        params = {"projectId": project_id} if project_id else None
        data = await self.arequest("GET", "/v1/snapshots", params=params)
        return [Snapshot.from_dict(x) for x in _as_list(data, "snapshots")]

    # 5. GET /v1/emulators
    def list_emulators(self, *, project_id: Optional[str] = None) -> List[Emulator]:
        params = {"projectId": project_id} if project_id else None
        data = self.request("GET", "/v1/emulators", params=params)
        return [Emulator.from_dict(x) for x in _as_list(data, "emulators")]

    async def alist_emulators(self, *, project_id: Optional[str] = None) -> List[Emulator]:
        params = {"projectId": project_id} if project_id else None
        data = await self.arequest("GET", "/v1/emulators", params=params)
        return [Emulator.from_dict(x) for x in _as_list(data, "emulators")]

    # 6. GET /v1/events
    def list_events(
        self,
        *,
        project_id: Optional[str] = None,
        limit: Optional[int] = None,
    ) -> List[Event]:
        params: Dict[str, Any] = {}
        if project_id:
            params["projectId"] = project_id
        if limit is not None:
            params["limit"] = limit
        data = self.request("GET", "/v1/events", params=params or None)
        return [Event.from_dict(x) for x in _as_list(data, "events")]

    async def alist_events(
        self,
        *,
        project_id: Optional[str] = None,
        limit: Optional[int] = None,
    ) -> List[Event]:
        params: Dict[str, Any] = {}
        if project_id:
            params["projectId"] = project_id
        if limit is not None:
            params["limit"] = limit
        data = await self.arequest("GET", "/v1/events", params=params or None)
        return [Event.from_dict(x) for x in _as_list(data, "events")]

    # 7. GET /v1/api-keys
    def list_api_keys(self) -> List[ApiKey]:
        data = self.request("GET", "/v1/api-keys")
        return [ApiKey.from_dict(x) for x in _as_list(data, "keys", "apiKeys")]

    async def alist_api_keys(self) -> List[ApiKey]:
        data = await self.arequest("GET", "/v1/api-keys")
        return [ApiKey.from_dict(x) for x in _as_list(data, "keys", "apiKeys")]

    # 8. POST /v1/api-keys
    def create_api_key(self, *, name: str) -> ApiKey:
        data = self.request("POST", "/v1/api-keys", json={"name": name})
        return ApiKey.from_dict(_unwrap(data, "key", "apiKey"))

    async def acreate_api_key(self, *, name: str) -> ApiKey:
        data = await self.arequest("POST", "/v1/api-keys", json={"name": name})
        return ApiKey.from_dict(_unwrap(data, "key", "apiKey"))

    # 9. GET /v1/usage
    def list_usage(
        self,
        *,
        org_id: Optional[str] = None,
        period: Optional[str] = None,
    ) -> UsageResponse:
        params = _org_params(org_id) or {}
        if period:
            params["period"] = period
        data = self.request("GET", "/v1/usage", params=params or None)
        return UsageResponse.from_dict(data if isinstance(data, dict) else {})

    async def alist_usage(
        self,
        *,
        org_id: Optional[str] = None,
        period: Optional[str] = None,
    ) -> UsageResponse:
        params = _org_params(org_id) or {}
        if period:
            params["period"] = period
        data = await self.arequest("GET", "/v1/usage", params=params or None)
        return UsageResponse.from_dict(data if isinstance(data, dict) else {})

    # 10. GET /v1/health/live
    def get_health(self) -> HealthResponse:
        data = self.request("GET", "/v1/health/live")
        return HealthResponse.from_dict(data if isinstance(data, dict) else {"status": "unknown"})

    async def aget_health(self) -> HealthResponse:
        data = await self.arequest("GET", "/v1/health/live")
        return HealthResponse.from_dict(data if isinstance(data, dict) else {"status": "unknown"})


# ---- helpers ------------------------------------------------------------


def _parse(resp: httpx.Response) -> JSON:
    """Turn an httpx response into parsed JSON or raise CarbonError."""
    body: Any = None
    if resp.content:
        try:
            body = resp.json()
        except ValueError:
            body = resp.text
    if resp.status_code >= 400:
        raise CarbonError.from_response(resp.status_code, body)
    return body


def _as_list(data: Any, *keys: str) -> List[Any]:
    """Extract a list from a response that may be `[...]` or `{"k": [...]}`."""
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        for k in keys:
            v = data.get(k)
            if isinstance(v, list):
                return v
        # Some Carbon list endpoints wrap results under `data`.
        v = data.get("data")
        if isinstance(v, list):
            return v
    return []


def _unwrap(data: Any, *keys: str) -> Any:
    """Return `data[key]` for the first matching key, else `data` itself."""
    if isinstance(data, dict):
        for k in keys:
            if k in data and isinstance(data[k], dict):
                return data[k]
    return data


def _org_params(org_id: Optional[str]) -> Optional[Dict[str, str]]:
    return {"orgId": org_id} if org_id else None
