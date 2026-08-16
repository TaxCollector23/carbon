"""AUTO-GENERATED — do not edit.

Regenerate with:
    python clients/python/scripts/codegen.py <openapi.json>

Full-surface methods layered on top of :class:`carbon_client.CarbonClient`.
List endpoints whose response declares a top-level ``data`` array are
unwrapped to that list; everything else returns the parsed JSON as-is.
"""

from __future__ import annotations

from typing import Any

from .client import CarbonClient

LIST_KEY = "data"


def _unwrap_list(data: Any) -> Any:
    """Return ``data["data"]`` when it is a list, else ``data``."""
    if isinstance(data, dict):
        value = data.get(LIST_KEY)
        if isinstance(value, list):
            return value
    return data


def _merge_params(params: dict[str, Any] | None, org_id: str | None) -> dict[str, Any] | None:
    merged = dict(params or {})
    if org_id is not None:
        merged.setdefault("orgId", org_id)
    return merged or None


class CarbonGenerated(CarbonClient):
    """Auto-generated per-endpoint methods (sync + async)."""

    def get_openapi_json(
        self, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """GET /openapi.json"""
        merged = _merge_params(params, org_id)
        return self.request("GET", "/openapi.json", params=merged, json=None)

    async def aget_openapi_json(
        self, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """GET /openapi.json"""
        merged = _merge_params(params, org_id)
        return await self.arequest("GET", "/openapi.json", params=merged, json=None)

    def get_metrics(
        self, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """List /metrics"""
        merged = _merge_params(params, org_id)
        return self.request("GET", "/metrics", params=merged, json=None)

    async def aget_metrics(
        self, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """List /metrics"""
        merged = _merge_params(params, org_id)
        return await self.arequest("GET", "/metrics", params=merged, json=None)

    def get_health(self, *, org_id: str | None = None, params: dict[str, Any] | None = None) -> Any:
        """Liveness probe"""
        merged = _merge_params(params, org_id)
        return self.request("GET", "/health", params=merged, json=None)

    async def aget_health(
        self, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """Liveness probe"""
        merged = _merge_params(params, org_id)
        return await self.arequest("GET", "/health", params=merged, json=None)

    def get_health_live(
        self, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """Liveness probe (versioned)"""
        merged = _merge_params(params, org_id)
        return self.request("GET", "/v1/health/live", params=merged, json=None)

    async def aget_health_live(
        self, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """Liveness probe (versioned)"""
        merged = _merge_params(params, org_id)
        return await self.arequest("GET", "/v1/health/live", params=merged, json=None)

    def get_version(
        self, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """Server version and feature flags"""
        merged = _merge_params(params, org_id)
        return self.request("GET", "/v1/version", params=merged, json=None)

    async def aget_version(
        self, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """Server version and feature flags"""
        merged = _merge_params(params, org_id)
        return await self.arequest("GET", "/v1/version", params=merged, json=None)

    def get_ready(self, *, org_id: str | None = None, params: dict[str, Any] | None = None) -> Any:
        """List /ready"""
        merged = _merge_params(params, org_id)
        return self.request("GET", "/ready", params=merged, json=None)

    async def aget_ready(
        self, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """List /ready"""
        merged = _merge_params(params, org_id)
        return await self.arequest("GET", "/ready", params=merged, json=None)

    def get_health_deep(
        self, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """Deep dependency health probe"""
        merged = _merge_params(params, org_id)
        return self.request("GET", "/v1/health/deep", params=merged, json=None)

    async def aget_health_deep(
        self, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """Deep dependency health probe"""
        merged = _merge_params(params, org_id)
        return await self.arequest("GET", "/v1/health/deep", params=merged, json=None)

    def get_capabilities(
        self, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """Discover server capabilities"""
        merged = _merge_params(params, org_id)
        return self.request("GET", "/v1/capabilities", params=merged, json=None)

    async def aget_capabilities(
        self, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """Discover server capabilities"""
        merged = _merge_params(params, org_id)
        return await self.arequest("GET", "/v1/capabilities", params=merged, json=None)

    def get_projects(
        self, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """List projects"""
        merged = _merge_params(params, org_id)
        return _unwrap_list(self.request("GET", "/v1/projects", params=merged, json=None))

    async def aget_projects(
        self, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """List projects"""
        merged = _merge_params(params, org_id)
        return _unwrap_list(await self.arequest("GET", "/v1/projects", params=merged, json=None))

    def post_projects(
        self,
        body: dict | None = None,
        *,
        org_id: str | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Create a project"""
        merged = _merge_params(params, org_id)
        return self.request("POST", "/v1/projects", params=merged, json=body)

    async def apost_projects(
        self,
        body: dict | None = None,
        *,
        org_id: str | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Create a project"""
        merged = _merge_params(params, org_id)
        return await self.arequest("POST", "/v1/projects", params=merged, json=body)

    def get_projects_id(
        self, id: str, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """Get a project"""
        merged = _merge_params(params, org_id)
        return self.request("GET", f"/v1/projects/{id}", params=merged, json=None)

    async def aget_projects_id(
        self, id: str, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """Get a project"""
        merged = _merge_params(params, org_id)
        return await self.arequest("GET", f"/v1/projects/{id}", params=merged, json=None)

    def get_projects_id_members(
        self, id: str, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """List project members"""
        merged = _merge_params(params, org_id)
        return _unwrap_list(
            self.request("GET", f"/v1/projects/{id}/members", params=merged, json=None)
        )

    async def aget_projects_id_members(
        self, id: str, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """List project members"""
        merged = _merge_params(params, org_id)
        return _unwrap_list(
            await self.arequest("GET", f"/v1/projects/{id}/members", params=merged, json=None)
        )

    def post_projects_id_members(
        self,
        id: str,
        body: dict | None = None,
        *,
        org_id: str | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Add a project member"""
        merged = _merge_params(params, org_id)
        return self.request("POST", f"/v1/projects/{id}/members", params=merged, json=body)

    async def apost_projects_id_members(
        self,
        id: str,
        body: dict | None = None,
        *,
        org_id: str | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Add a project member"""
        merged = _merge_params(params, org_id)
        return await self.arequest("POST", f"/v1/projects/{id}/members", params=merged, json=body)

    def delete_projects_id_members_user_id(
        self,
        id: str,
        user_id: str,
        *,
        org_id: str | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Delete /v1/projects/:id/members/:userId"""
        merged = _merge_params(params, org_id)
        return self.request(
            "DELETE", f"/v1/projects/{id}/members/{user_id}", params=merged, json=None
        )

    async def adelete_projects_id_members_user_id(
        self,
        id: str,
        user_id: str,
        *,
        org_id: str | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Delete /v1/projects/:id/members/:userId"""
        merged = _merge_params(params, org_id)
        return await self.arequest(
            "DELETE", f"/v1/projects/{id}/members/{user_id}", params=merged, json=None
        )

    def post_projects_id_share_links(
        self,
        id: str,
        body: dict | None = None,
        *,
        org_id: str | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Create a share link for a project"""
        merged = _merge_params(params, org_id)
        return self.request("POST", f"/v1/projects/{id}/share-links", params=merged, json=body)

    async def apost_projects_id_share_links(
        self,
        id: str,
        body: dict | None = None,
        *,
        org_id: str | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Create a share link for a project"""
        merged = _merge_params(params, org_id)
        return await self.arequest(
            "POST", f"/v1/projects/{id}/share-links", params=merged, json=body
        )

    def get_share_links_token_state(
        self, token: str, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """Read a share link's current state"""
        merged = _merge_params(params, org_id)
        return self.request("GET", f"/v1/share-links/{token}/state", params=merged, json=None)

    async def aget_share_links_token_state(
        self, token: str, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """Read a share link's current state"""
        merged = _merge_params(params, org_id)
        return await self.arequest(
            "GET", f"/v1/share-links/{token}/state", params=merged, json=None
        )

    def delete_share_links_id(
        self, id: str, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """Revoke a share link"""
        merged = _merge_params(params, org_id)
        return self.request("DELETE", f"/v1/share-links/{id}", params=merged, json=None)

    async def adelete_share_links_id(
        self, id: str, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """Revoke a share link"""
        merged = _merge_params(params, org_id)
        return await self.arequest("DELETE", f"/v1/share-links/{id}", params=merged, json=None)

    def post_ingest(
        self,
        body: dict | None = None,
        *,
        org_id: str | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Ingest a spec into a project"""
        merged = _merge_params(params, org_id)
        return self.request("POST", "/v1/ingest", params=merged, json=body)

    async def apost_ingest(
        self,
        body: dict | None = None,
        *,
        org_id: str | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Ingest a spec into a project"""
        merged = _merge_params(params, org_id)
        return await self.arequest("POST", "/v1/ingest", params=merged, json=body)

    def post_ingest_postman(
        self,
        body: dict | None = None,
        *,
        org_id: str | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Ingest a raw Postman collection"""
        merged = _merge_params(params, org_id)
        return self.request("POST", "/v1/ingest/postman", params=merged, json=body)

    async def apost_ingest_postman(
        self,
        body: dict | None = None,
        *,
        org_id: str | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Ingest a raw Postman collection"""
        merged = _merge_params(params, org_id)
        return await self.arequest("POST", "/v1/ingest/postman", params=merged, json=body)

    def get_emulators(
        self, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """List running emulators"""
        merged = _merge_params(params, org_id)
        return _unwrap_list(self.request("GET", "/v1/emulators", params=merged, json=None))

    async def aget_emulators(
        self, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """List running emulators"""
        merged = _merge_params(params, org_id)
        return _unwrap_list(await self.arequest("GET", "/v1/emulators", params=merged, json=None))

    def post_emulators(
        self,
        body: dict | None = None,
        *,
        org_id: str | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Start an emulator"""
        merged = _merge_params(params, org_id)
        return self.request("POST", "/v1/emulators", params=merged, json=body)

    async def apost_emulators(
        self,
        body: dict | None = None,
        *,
        org_id: str | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Start an emulator"""
        merged = _merge_params(params, org_id)
        return await self.arequest("POST", "/v1/emulators", params=merged, json=body)

    def get_emulators_id(
        self, id: str, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """Get an emulator by id"""
        merged = _merge_params(params, org_id)
        return self.request("GET", f"/v1/emulators/{id}", params=merged, json=None)

    async def aget_emulators_id(
        self, id: str, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """Get an emulator by id"""
        merged = _merge_params(params, org_id)
        return await self.arequest("GET", f"/v1/emulators/{id}", params=merged, json=None)

    def delete_emulators_id(
        self, id: str, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """Stop an emulator"""
        merged = _merge_params(params, org_id)
        return self.request("DELETE", f"/v1/emulators/{id}", params=merged, json=None)

    async def adelete_emulators_id(
        self, id: str, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """Stop an emulator"""
        merged = _merge_params(params, org_id)
        return await self.arequest("DELETE", f"/v1/emulators/{id}", params=merged, json=None)

    def post_emulators_id_reset(
        self,
        id: str,
        body: dict | None = None,
        *,
        org_id: str | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Reset an emulator's state"""
        merged = _merge_params(params, org_id)
        return self.request("POST", f"/v1/emulators/{id}/reset", params=merged, json=body)

    async def apost_emulators_id_reset(
        self,
        id: str,
        body: dict | None = None,
        *,
        org_id: str | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Reset an emulator's state"""
        merged = _merge_params(params, org_id)
        return await self.arequest("POST", f"/v1/emulators/{id}/reset", params=merged, json=body)

    def post_emulators_id_snapshot(
        self,
        id: str,
        body: dict | None = None,
        *,
        org_id: str | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Snapshot an emulator"""
        merged = _merge_params(params, org_id)
        return self.request("POST", f"/v1/emulators/{id}/snapshot", params=merged, json=body)

    async def apost_emulators_id_snapshot(
        self,
        id: str,
        body: dict | None = None,
        *,
        org_id: str | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Snapshot an emulator"""
        merged = _merge_params(params, org_id)
        return await self.arequest("POST", f"/v1/emulators/{id}/snapshot", params=merged, json=body)

    def post_emulators_id_restore(
        self,
        id: str,
        body: dict | None = None,
        *,
        org_id: str | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Restore an emulator from a snapshot"""
        merged = _merge_params(params, org_id)
        return self.request("POST", f"/v1/emulators/{id}/restore", params=merged, json=body)

    async def apost_emulators_id_restore(
        self,
        id: str,
        body: dict | None = None,
        *,
        org_id: str | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Restore an emulator from a snapshot"""
        merged = _merge_params(params, org_id)
        return await self.arequest("POST", f"/v1/emulators/{id}/restore", params=merged, json=body)

    def post_emulators_id_apply_preset(
        self,
        id: str,
        body: dict | None = None,
        *,
        org_id: str | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Apply a chaos preset to an emulator"""
        merged = _merge_params(params, org_id)
        return self.request("POST", f"/v1/emulators/{id}/apply-preset", params=merged, json=body)

    async def apost_emulators_id_apply_preset(
        self,
        id: str,
        body: dict | None = None,
        *,
        org_id: str | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Apply a chaos preset to an emulator"""
        merged = _merge_params(params, org_id)
        return await self.arequest(
            "POST", f"/v1/emulators/{id}/apply-preset", params=merged, json=body
        )

    def post_emulators_id_load_test(
        self,
        id: str,
        body: dict | None = None,
        *,
        org_id: str | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Run a throughput load test"""
        merged = _merge_params(params, org_id)
        return self.request("POST", f"/v1/emulators/{id}/load-test", params=merged, json=body)

    async def apost_emulators_id_load_test(
        self,
        id: str,
        body: dict | None = None,
        *,
        org_id: str | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Run a throughput load test"""
        merged = _merge_params(params, org_id)
        return await self.arequest(
            "POST", f"/v1/emulators/{id}/load-test", params=merged, json=body
        )

    def get_projects_slug_snapshots(
        self, slug: str, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """List project snapshots"""
        merged = _merge_params(params, org_id)
        return _unwrap_list(
            self.request("GET", f"/v1/projects/{slug}/snapshots", params=merged, json=None)
        )

    async def aget_projects_slug_snapshots(
        self, slug: str, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """List project snapshots"""
        merged = _merge_params(params, org_id)
        return _unwrap_list(
            await self.arequest("GET", f"/v1/projects/{slug}/snapshots", params=merged, json=None)
        )

    def post_snapshots(
        self,
        body: dict | None = None,
        *,
        org_id: str | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Save a snapshot"""
        merged = _merge_params(params, org_id)
        return self.request("POST", "/v1/snapshots", params=merged, json=body)

    async def apost_snapshots(
        self,
        body: dict | None = None,
        *,
        org_id: str | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Save a snapshot"""
        merged = _merge_params(params, org_id)
        return await self.arequest("POST", "/v1/snapshots", params=merged, json=body)

    def get_projects_slug_snapshots_name(
        self,
        slug: str,
        name: str,
        *,
        org_id: str | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Get /v1/projects/:slug/snapshots/:name"""
        merged = _merge_params(params, org_id)
        return self.request(
            "GET", f"/v1/projects/{slug}/snapshots/{name}", params=merged, json=None
        )

    async def aget_projects_slug_snapshots_name(
        self,
        slug: str,
        name: str,
        *,
        org_id: str | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Get /v1/projects/:slug/snapshots/:name"""
        merged = _merge_params(params, org_id)
        return await self.arequest(
            "GET", f"/v1/projects/{slug}/snapshots/{name}", params=merged, json=None
        )

    def delete_projects_slug_snapshots_name(
        self,
        slug: str,
        name: str,
        *,
        org_id: str | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Delete /v1/projects/:slug/snapshots/:name"""
        merged = _merge_params(params, org_id)
        return self.request(
            "DELETE", f"/v1/projects/{slug}/snapshots/{name}", params=merged, json=None
        )

    async def adelete_projects_slug_snapshots_name(
        self,
        slug: str,
        name: str,
        *,
        org_id: str | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Delete /v1/projects/:slug/snapshots/:name"""
        merged = _merge_params(params, org_id)
        return await self.arequest(
            "DELETE", f"/v1/projects/{slug}/snapshots/{name}", params=merged, json=None
        )

    def get_snapshots_slug_diff(
        self, slug: str, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """Get /v1/snapshots/:slug/diff"""
        merged = _merge_params(params, org_id)
        return self.request("GET", f"/v1/snapshots/{slug}/diff", params=merged, json=None)

    async def aget_snapshots_slug_diff(
        self, slug: str, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """Get /v1/snapshots/:slug/diff"""
        merged = _merge_params(params, org_id)
        return await self.arequest("GET", f"/v1/snapshots/{slug}/diff", params=merged, json=None)

    def get_api_keys(
        self, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """List API keys"""
        merged = _merge_params(params, org_id)
        return _unwrap_list(self.request("GET", "/v1/api-keys", params=merged, json=None))

    async def aget_api_keys(
        self, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """List API keys"""
        merged = _merge_params(params, org_id)
        return _unwrap_list(await self.arequest("GET", "/v1/api-keys", params=merged, json=None))

    def post_api_keys(
        self,
        body: dict | None = None,
        *,
        org_id: str | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Mint an API key"""
        merged = _merge_params(params, org_id)
        return self.request("POST", "/v1/api-keys", params=merged, json=body)

    async def apost_api_keys(
        self,
        body: dict | None = None,
        *,
        org_id: str | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Mint an API key"""
        merged = _merge_params(params, org_id)
        return await self.arequest("POST", "/v1/api-keys", params=merged, json=body)

    def post_api_keys_id_rotate(
        self,
        id: str,
        body: dict | None = None,
        *,
        org_id: str | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Rotate an API key"""
        merged = _merge_params(params, org_id)
        return self.request("POST", f"/v1/api-keys/{id}/rotate", params=merged, json=body)

    async def apost_api_keys_id_rotate(
        self,
        id: str,
        body: dict | None = None,
        *,
        org_id: str | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Rotate an API key"""
        merged = _merge_params(params, org_id)
        return await self.arequest("POST", f"/v1/api-keys/{id}/rotate", params=merged, json=body)

    def delete_api_keys_id(
        self, id: str, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """Delete /v1/api-keys/:id"""
        merged = _merge_params(params, org_id)
        return self.request("DELETE", f"/v1/api-keys/{id}", params=merged, json=None)

    async def adelete_api_keys_id(
        self, id: str, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """Delete /v1/api-keys/:id"""
        merged = _merge_params(params, org_id)
        return await self.arequest("DELETE", f"/v1/api-keys/{id}", params=merged, json=None)

    def get_projects_slug_ir_id(
        self, slug: str, id: str, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """Fetch an IR artifact"""
        merged = _merge_params(params, org_id)
        return self.request("GET", f"/v1/projects/{slug}/ir/{id}", params=merged, json=None)

    async def aget_projects_slug_ir_id(
        self, slug: str, id: str, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """Fetch an IR artifact"""
        merged = _merge_params(params, org_id)
        return await self.arequest("GET", f"/v1/projects/{slug}/ir/{id}", params=merged, json=None)

    def get_projects_slug_graphs_id(
        self, slug: str, id: str, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """Fetch a behavior-graph artifact"""
        merged = _merge_params(params, org_id)
        return self.request("GET", f"/v1/projects/{slug}/graphs/{id}", params=merged, json=None)

    async def aget_projects_slug_graphs_id(
        self, slug: str, id: str, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """Fetch a behavior-graph artifact"""
        merged = _merge_params(params, org_id)
        return await self.arequest(
            "GET", f"/v1/projects/{slug}/graphs/{id}", params=merged, json=None
        )

    def get_projects_slug_artifacts(
        self, slug: str, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """List a project's artifacts"""
        merged = _merge_params(params, org_id)
        return _unwrap_list(
            self.request("GET", f"/v1/projects/{slug}/artifacts", params=merged, json=None)
        )

    async def aget_projects_slug_artifacts(
        self, slug: str, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """List a project's artifacts"""
        merged = _merge_params(params, org_id)
        return _unwrap_list(
            await self.arequest("GET", f"/v1/projects/{slug}/artifacts", params=merged, json=None)
        )

    def patch_artifacts_id(
        self,
        id: str,
        body: dict | None = None,
        *,
        org_id: str | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Set an artifact's tags"""
        merged = _merge_params(params, org_id)
        return self.request("PATCH", f"/v1/artifacts/{id}", params=merged, json=body)

    async def apatch_artifacts_id(
        self,
        id: str,
        body: dict | None = None,
        *,
        org_id: str | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Set an artifact's tags"""
        merged = _merge_params(params, org_id)
        return await self.arequest("PATCH", f"/v1/artifacts/{id}", params=merged, json=body)

    def get_artifacts_id_comments(
        self, id: str, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """List artifact comments"""
        merged = _merge_params(params, org_id)
        return _unwrap_list(
            self.request("GET", f"/v1/artifacts/{id}/comments", params=merged, json=None)
        )

    async def aget_artifacts_id_comments(
        self, id: str, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """List artifact comments"""
        merged = _merge_params(params, org_id)
        return _unwrap_list(
            await self.arequest("GET", f"/v1/artifacts/{id}/comments", params=merged, json=None)
        )

    def post_artifacts_id_comments(
        self,
        id: str,
        body: dict | None = None,
        *,
        org_id: str | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Post a comment on an artifact"""
        merged = _merge_params(params, org_id)
        return self.request("POST", f"/v1/artifacts/{id}/comments", params=merged, json=body)

    async def apost_artifacts_id_comments(
        self,
        id: str,
        body: dict | None = None,
        *,
        org_id: str | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Post a comment on an artifact"""
        merged = _merge_params(params, org_id)
        return await self.arequest("POST", f"/v1/artifacts/{id}/comments", params=merged, json=body)

    def get_projects_slug_recordings(
        self, slug: str, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """List a project's recordings"""
        merged = _merge_params(params, org_id)
        return _unwrap_list(
            self.request("GET", f"/v1/projects/{slug}/recordings", params=merged, json=None)
        )

    async def aget_projects_slug_recordings(
        self, slug: str, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """List a project's recordings"""
        merged = _merge_params(params, org_id)
        return _unwrap_list(
            await self.arequest("GET", f"/v1/projects/{slug}/recordings", params=merged, json=None)
        )

    def get_projects_slug_recordings_id_exchanges(
        self, slug: str, id: str, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """List a recording's exchanges"""
        merged = _merge_params(params, org_id)
        return self.request(
            "GET", f"/v1/projects/{slug}/recordings/{id}/exchanges", params=merged, json=None
        )

    async def aget_projects_slug_recordings_id_exchanges(
        self, slug: str, id: str, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """List a recording's exchanges"""
        merged = _merge_params(params, org_id)
        return await self.arequest(
            "GET", f"/v1/projects/{slug}/recordings/{id}/exchanges", params=merged, json=None
        )

    def post_projects_slug_recordings_id_replay(
        self,
        slug: str,
        id: str,
        body: dict | None = None,
        *,
        org_id: str | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Replay a recording against a target"""
        merged = _merge_params(params, org_id)
        return self.request(
            "POST", f"/v1/projects/{slug}/recordings/{id}/replay", params=merged, json=body
        )

    async def apost_projects_slug_recordings_id_replay(
        self,
        slug: str,
        id: str,
        body: dict | None = None,
        *,
        org_id: str | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Replay a recording against a target"""
        merged = _merge_params(params, org_id)
        return await self.arequest(
            "POST", f"/v1/projects/{slug}/recordings/{id}/replay", params=merged, json=body
        )

    def get_projects_slug_recordings_id_replays(
        self, slug: str, id: str, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """List past replays for a recording"""
        merged = _merge_params(params, org_id)
        return _unwrap_list(
            self.request(
                "GET", f"/v1/projects/{slug}/recordings/{id}/replays", params=merged, json=None
            )
        )

    async def aget_projects_slug_recordings_id_replays(
        self, slug: str, id: str, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """List past replays for a recording"""
        merged = _merge_params(params, org_id)
        return _unwrap_list(
            await self.arequest(
                "GET", f"/v1/projects/{slug}/recordings/{id}/replays", params=merged, json=None
            )
        )

    def get_projects_id_drift(
        self, id: str, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """List drift-check history for a project"""
        merged = _merge_params(params, org_id)
        return _unwrap_list(
            self.request("GET", f"/v1/projects/{id}/drift", params=merged, json=None)
        )

    async def aget_projects_id_drift(
        self, id: str, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """List drift-check history for a project"""
        merged = _merge_params(params, org_id)
        return _unwrap_list(
            await self.arequest("GET", f"/v1/projects/{id}/drift", params=merged, json=None)
        )

    def get_projects_id_drift_config(
        self, id: str, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """Get drift-check config"""
        merged = _merge_params(params, org_id)
        return self.request("GET", f"/v1/projects/{id}/drift/config", params=merged, json=None)

    async def aget_projects_id_drift_config(
        self, id: str, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """Get drift-check config"""
        merged = _merge_params(params, org_id)
        return await self.arequest(
            "GET", f"/v1/projects/{id}/drift/config", params=merged, json=None
        )

    def patch_projects_id_drift_config(
        self,
        id: str,
        body: dict | None = None,
        *,
        org_id: str | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Update drift-check config"""
        merged = _merge_params(params, org_id)
        return self.request("PATCH", f"/v1/projects/{id}/drift/config", params=merged, json=body)

    async def apatch_projects_id_drift_config(
        self,
        id: str,
        body: dict | None = None,
        *,
        org_id: str | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Update drift-check config"""
        merged = _merge_params(params, org_id)
        return await self.arequest(
            "PATCH", f"/v1/projects/{id}/drift/config", params=merged, json=body
        )

    def post_projects_id_drift_run(
        self,
        id: str,
        body: dict | None = None,
        *,
        org_id: str | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Enqueue a one-off drift check"""
        merged = _merge_params(params, org_id)
        return self.request("POST", f"/v1/projects/{id}/drift/run", params=merged, json=body)

    async def apost_projects_id_drift_run(
        self,
        id: str,
        body: dict | None = None,
        *,
        org_id: str | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Enqueue a one-off drift check"""
        merged = _merge_params(params, org_id)
        return await self.arequest("POST", f"/v1/projects/{id}/drift/run", params=merged, json=body)

    def get_jobs_id(
        self, id: str, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """Get async job status"""
        merged = _merge_params(params, org_id)
        return self.request("GET", f"/v1/jobs/{id}", params=merged, json=None)

    async def aget_jobs_id(
        self, id: str, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """Get async job status"""
        merged = _merge_params(params, org_id)
        return await self.arequest("GET", f"/v1/jobs/{id}", params=merged, json=None)

    def get_jobs(self, *, org_id: str | None = None, params: dict[str, Any] | None = None) -> Any:
        """List recent async jobs"""
        merged = _merge_params(params, org_id)
        return _unwrap_list(self.request("GET", "/v1/jobs", params=merged, json=None))

    async def aget_jobs(
        self, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """List recent async jobs"""
        merged = _merge_params(params, org_id)
        return _unwrap_list(await self.arequest("GET", "/v1/jobs", params=merged, json=None))

    def post_jobs_id_retry(
        self,
        id: str,
        body: dict | None = None,
        *,
        org_id: str | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Retry a failed async job"""
        merged = _merge_params(params, org_id)
        return self.request("POST", f"/v1/jobs/{id}/retry", params=merged, json=body)

    async def apost_jobs_id_retry(
        self,
        id: str,
        body: dict | None = None,
        *,
        org_id: str | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Retry a failed async job"""
        merged = _merge_params(params, org_id)
        return await self.arequest("POST", f"/v1/jobs/{id}/retry", params=merged, json=body)

    def get_events(self, *, org_id: str | None = None, params: dict[str, Any] | None = None) -> Any:
        """List audit events"""
        merged = _merge_params(params, org_id)
        return _unwrap_list(self.request("GET", "/v1/events", params=merged, json=None))

    async def aget_events(
        self, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """List audit events"""
        merged = _merge_params(params, org_id)
        return _unwrap_list(await self.arequest("GET", "/v1/events", params=merged, json=None))

    def get_events_stream(
        self, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """Server-Sent Events stream of audit events"""
        merged = _merge_params(params, org_id)
        return self.request("GET", "/v1/events/stream", params=merged, json=None)

    async def aget_events_stream(
        self, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """Server-Sent Events stream of audit events"""
        merged = _merge_params(params, org_id)
        return await self.arequest("GET", "/v1/events/stream", params=merged, json=None)

    def get_events_export(
        self, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """Export audit events as CSV"""
        merged = _merge_params(params, org_id)
        return self.request("GET", "/v1/events/export", params=merged, json=None)

    async def aget_events_export(
        self, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """Export audit events as CSV"""
        merged = _merge_params(params, org_id)
        return await self.arequest("GET", "/v1/events/export", params=merged, json=None)

    def get_organizations(
        self, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """List organizations for the caller"""
        merged = _merge_params(params, org_id)
        return _unwrap_list(self.request("GET", "/v1/organizations", params=merged, json=None))

    async def aget_organizations(
        self, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """List organizations for the caller"""
        merged = _merge_params(params, org_id)
        return _unwrap_list(
            await self.arequest("GET", "/v1/organizations", params=merged, json=None)
        )

    def get_organizations_current(
        self, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """Get the caller's current organization"""
        merged = _merge_params(params, org_id)
        return self.request("GET", "/v1/organizations/current", params=merged, json=None)

    async def aget_organizations_current(
        self, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """Get the caller's current organization"""
        merged = _merge_params(params, org_id)
        return await self.arequest("GET", "/v1/organizations/current", params=merged, json=None)

    def get_organizations_id(
        self, id: str, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """Get an organization by id"""
        merged = _merge_params(params, org_id)
        return self.request("GET", f"/v1/organizations/{id}", params=merged, json=None)

    async def aget_organizations_id(
        self, id: str, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """Get an organization by id"""
        merged = _merge_params(params, org_id)
        return await self.arequest("GET", f"/v1/organizations/{id}", params=merged, json=None)

    def patch_organizations_id(
        self,
        id: str,
        body: dict | None = None,
        *,
        org_id: str | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Update an organization"""
        merged = _merge_params(params, org_id)
        return self.request("PATCH", f"/v1/organizations/{id}", params=merged, json=body)

    async def apatch_organizations_id(
        self,
        id: str,
        body: dict | None = None,
        *,
        org_id: str | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Update an organization"""
        merged = _merge_params(params, org_id)
        return await self.arequest("PATCH", f"/v1/organizations/{id}", params=merged, json=body)

    def get_organizations_id_members(
        self, id: str, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """List organization members"""
        merged = _merge_params(params, org_id)
        return _unwrap_list(
            self.request("GET", f"/v1/organizations/{id}/members", params=merged, json=None)
        )

    async def aget_organizations_id_members(
        self, id: str, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """List organization members"""
        merged = _merge_params(params, org_id)
        return _unwrap_list(
            await self.arequest("GET", f"/v1/organizations/{id}/members", params=merged, json=None)
        )

    def post_organizations_id_members(
        self,
        id: str,
        body: dict | None = None,
        *,
        org_id: str | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Invite a user to the organization"""
        merged = _merge_params(params, org_id)
        return self.request("POST", f"/v1/organizations/{id}/members", params=merged, json=body)

    async def apost_organizations_id_members(
        self,
        id: str,
        body: dict | None = None,
        *,
        org_id: str | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Invite a user to the organization"""
        merged = _merge_params(params, org_id)
        return await self.arequest(
            "POST", f"/v1/organizations/{id}/members", params=merged, json=body
        )

    def patch_organizations_id_members_user_id(
        self,
        id: str,
        user_id: str,
        body: dict | None = None,
        *,
        org_id: str | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Change a member's role"""
        merged = _merge_params(params, org_id)
        return self.request(
            "PATCH", f"/v1/organizations/{id}/members/{user_id}", params=merged, json=body
        )

    async def apatch_organizations_id_members_user_id(
        self,
        id: str,
        user_id: str,
        body: dict | None = None,
        *,
        org_id: str | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Change a member's role"""
        merged = _merge_params(params, org_id)
        return await self.arequest(
            "PATCH", f"/v1/organizations/{id}/members/{user_id}", params=merged, json=body
        )

    def delete_organizations_id_members_user_id(
        self,
        id: str,
        user_id: str,
        *,
        org_id: str | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Remove an organization member"""
        merged = _merge_params(params, org_id)
        return self.request(
            "DELETE", f"/v1/organizations/{id}/members/{user_id}", params=merged, json=None
        )

    async def adelete_organizations_id_members_user_id(
        self,
        id: str,
        user_id: str,
        *,
        org_id: str | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Remove an organization member"""
        merged = _merge_params(params, org_id)
        return await self.arequest(
            "DELETE", f"/v1/organizations/{id}/members/{user_id}", params=merged, json=None
        )

    def post_invitations_accept(
        self,
        body: dict | None = None,
        *,
        org_id: str | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Accept an organization invitation"""
        merged = _merge_params(params, org_id)
        return self.request("POST", "/v1/invitations/accept", params=merged, json=body)

    async def apost_invitations_accept(
        self,
        body: dict | None = None,
        *,
        org_id: str | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Accept an organization invitation"""
        merged = _merge_params(params, org_id)
        return await self.arequest("POST", "/v1/invitations/accept", params=merged, json=body)

    def post_billing_checkout(
        self,
        body: dict | None = None,
        *,
        org_id: str | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Create a Stripe Checkout session"""
        merged = _merge_params(params, org_id)
        return self.request("POST", "/v1/billing/checkout", params=merged, json=body)

    async def apost_billing_checkout(
        self,
        body: dict | None = None,
        *,
        org_id: str | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Create a Stripe Checkout session"""
        merged = _merge_params(params, org_id)
        return await self.arequest("POST", "/v1/billing/checkout", params=merged, json=body)

    def post_billing_portal(
        self,
        body: dict | None = None,
        *,
        org_id: str | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Create a Stripe Billing Portal session"""
        merged = _merge_params(params, org_id)
        return self.request("POST", "/v1/billing/portal", params=merged, json=body)

    async def apost_billing_portal(
        self,
        body: dict | None = None,
        *,
        org_id: str | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Create a Stripe Billing Portal session"""
        merged = _merge_params(params, org_id)
        return await self.arequest("POST", "/v1/billing/portal", params=merged, json=body)

    def get_billing_subscription(
        self, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """Get the caller's current subscription"""
        merged = _merge_params(params, org_id)
        return self.request("GET", "/v1/billing/subscription", params=merged, json=None)

    async def aget_billing_subscription(
        self, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """Get the caller's current subscription"""
        merged = _merge_params(params, org_id)
        return await self.arequest("GET", "/v1/billing/subscription", params=merged, json=None)

    def post_billing_webhook(
        self,
        body: dict | None = None,
        *,
        org_id: str | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Create /v1/billing/webhook"""
        merged = _merge_params(params, org_id)
        return self.request("POST", "/v1/billing/webhook", params=merged, json=body)

    async def apost_billing_webhook(
        self,
        body: dict | None = None,
        *,
        org_id: str | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Create /v1/billing/webhook"""
        merged = _merge_params(params, org_id)
        return await self.arequest("POST", "/v1/billing/webhook", params=merged, json=body)

    def get_scim_v2_users(
        self, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """SCIM: list users"""
        merged = _merge_params(params, org_id)
        return self.request("GET", "/scim/v2/Users", params=merged, json=None)

    async def aget_scim_v2_users(
        self, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """SCIM: list users"""
        merged = _merge_params(params, org_id)
        return await self.arequest("GET", "/scim/v2/Users", params=merged, json=None)

    def post_scim_v2_users(
        self,
        body: dict | None = None,
        *,
        org_id: str | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """SCIM: create user"""
        merged = _merge_params(params, org_id)
        return self.request("POST", "/scim/v2/Users", params=merged, json=body)

    async def apost_scim_v2_users(
        self,
        body: dict | None = None,
        *,
        org_id: str | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """SCIM: create user"""
        merged = _merge_params(params, org_id)
        return await self.arequest("POST", "/scim/v2/Users", params=merged, json=body)

    def get_scim_v2_users_id(
        self, id: str, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """SCIM: get user by id"""
        merged = _merge_params(params, org_id)
        return self.request("GET", f"/scim/v2/Users/{id}", params=merged, json=None)

    async def aget_scim_v2_users_id(
        self, id: str, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """SCIM: get user by id"""
        merged = _merge_params(params, org_id)
        return await self.arequest("GET", f"/scim/v2/Users/{id}", params=merged, json=None)

    def patch_scim_v2_users_id(
        self,
        id: str,
        body: dict | None = None,
        *,
        org_id: str | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """SCIM: patch user"""
        merged = _merge_params(params, org_id)
        return self.request("PATCH", f"/scim/v2/Users/{id}", params=merged, json=body)

    async def apatch_scim_v2_users_id(
        self,
        id: str,
        body: dict | None = None,
        *,
        org_id: str | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """SCIM: patch user"""
        merged = _merge_params(params, org_id)
        return await self.arequest("PATCH", f"/scim/v2/Users/{id}", params=merged, json=body)

    def delete_scim_v2_users_id(
        self, id: str, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """SCIM: delete user"""
        merged = _merge_params(params, org_id)
        return self.request("DELETE", f"/scim/v2/Users/{id}", params=merged, json=None)

    async def adelete_scim_v2_users_id(
        self, id: str, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """SCIM: delete user"""
        merged = _merge_params(params, org_id)
        return await self.arequest("DELETE", f"/scim/v2/Users/{id}", params=merged, json=None)

    def get_scim_v2_groups(
        self, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """SCIM: list groups (by role)"""
        merged = _merge_params(params, org_id)
        return self.request("GET", "/scim/v2/Groups", params=merged, json=None)

    async def aget_scim_v2_groups(
        self, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """SCIM: list groups (by role)"""
        merged = _merge_params(params, org_id)
        return await self.arequest("GET", "/scim/v2/Groups", params=merged, json=None)

    def get_chaos_presets(
        self, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """List chaos presets"""
        merged = _merge_params(params, org_id)
        return _unwrap_list(self.request("GET", "/v1/chaos-presets", params=merged, json=None))

    async def aget_chaos_presets(
        self, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """List chaos presets"""
        merged = _merge_params(params, org_id)
        return _unwrap_list(
            await self.arequest("GET", "/v1/chaos-presets", params=merged, json=None)
        )

    def post_chaos_presets(
        self,
        body: dict | None = None,
        *,
        org_id: str | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Create a chaos preset"""
        merged = _merge_params(params, org_id)
        return self.request("POST", "/v1/chaos-presets", params=merged, json=body)

    async def apost_chaos_presets(
        self,
        body: dict | None = None,
        *,
        org_id: str | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Create a chaos preset"""
        merged = _merge_params(params, org_id)
        return await self.arequest("POST", "/v1/chaos-presets", params=merged, json=body)

    def delete_chaos_presets_id(
        self, id: str, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """Delete a chaos preset"""
        merged = _merge_params(params, org_id)
        return self.request("DELETE", f"/v1/chaos-presets/{id}", params=merged, json=None)

    async def adelete_chaos_presets_id(
        self, id: str, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """Delete a chaos preset"""
        merged = _merge_params(params, org_id)
        return await self.arequest("DELETE", f"/v1/chaos-presets/{id}", params=merged, json=None)

    def post_projects_id_contract_check(
        self,
        id: str,
        body: dict | None = None,
        *,
        org_id: str | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Run contract checks against a live URL"""
        merged = _merge_params(params, org_id)
        return self.request("POST", f"/v1/projects/{id}/contract-check", params=merged, json=body)

    async def apost_projects_id_contract_check(
        self,
        id: str,
        body: dict | None = None,
        *,
        org_id: str | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Run contract checks against a live URL"""
        merged = _merge_params(params, org_id)
        return await self.arequest(
            "POST", f"/v1/projects/{id}/contract-check", params=merged, json=body
        )

    def get_assertions(
        self, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """List assertion rules"""
        merged = _merge_params(params, org_id)
        return _unwrap_list(self.request("GET", "/v1/assertions", params=merged, json=None))

    async def aget_assertions(
        self, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """List assertion rules"""
        merged = _merge_params(params, org_id)
        return _unwrap_list(await self.arequest("GET", "/v1/assertions", params=merged, json=None))

    def post_assertions(
        self,
        body: dict | None = None,
        *,
        org_id: str | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Create an assertion rule"""
        merged = _merge_params(params, org_id)
        return self.request("POST", "/v1/assertions", params=merged, json=body)

    async def apost_assertions(
        self,
        body: dict | None = None,
        *,
        org_id: str | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Create an assertion rule"""
        merged = _merge_params(params, org_id)
        return await self.arequest("POST", "/v1/assertions", params=merged, json=body)

    def patch_assertions_id(
        self,
        id: str,
        body: dict | None = None,
        *,
        org_id: str | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Update an assertion rule"""
        merged = _merge_params(params, org_id)
        return self.request("PATCH", f"/v1/assertions/{id}", params=merged, json=body)

    async def apatch_assertions_id(
        self,
        id: str,
        body: dict | None = None,
        *,
        org_id: str | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Update an assertion rule"""
        merged = _merge_params(params, org_id)
        return await self.arequest("PATCH", f"/v1/assertions/{id}", params=merged, json=body)

    def delete_assertions_id(
        self, id: str, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """Delete an assertion rule"""
        merged = _merge_params(params, org_id)
        return self.request("DELETE", f"/v1/assertions/{id}", params=merged, json=None)

    async def adelete_assertions_id(
        self, id: str, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """Delete an assertion rule"""
        merged = _merge_params(params, org_id)
        return await self.arequest("DELETE", f"/v1/assertions/{id}", params=merged, json=None)

    def get_projects_id_graph(
        self, id: str, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """Get a project's current behavior graph"""
        merged = _merge_params(params, org_id)
        return self.request("GET", f"/v1/projects/{id}/graph", params=merged, json=None)

    async def aget_projects_id_graph(
        self, id: str, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """Get a project's current behavior graph"""
        merged = _merge_params(params, org_id)
        return await self.arequest("GET", f"/v1/projects/{id}/graph", params=merged, json=None)

    def post_cli_auth_start(
        self,
        body: dict | None = None,
        *,
        org_id: str | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Start a CLI device-authorization session"""
        merged = _merge_params(params, org_id)
        return self.request("POST", "/v1/cli-auth/start", params=merged, json=body)

    async def apost_cli_auth_start(
        self,
        body: dict | None = None,
        *,
        org_id: str | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Start a CLI device-authorization session"""
        merged = _merge_params(params, org_id)
        return await self.arequest("POST", "/v1/cli-auth/start", params=merged, json=body)

    def get_cli_auth_session_id(
        self, session_id: str, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """Poll a CLI auth session"""
        merged = _merge_params(params, org_id)
        return self.request("GET", f"/v1/cli-auth/{session_id}", params=merged, json=None)

    async def aget_cli_auth_session_id(
        self, session_id: str, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """Poll a CLI auth session"""
        merged = _merge_params(params, org_id)
        return await self.arequest("GET", f"/v1/cli-auth/{session_id}", params=merged, json=None)

    def post_cli_auth_session_id_approve(
        self,
        session_id: str,
        body: dict | None = None,
        *,
        org_id: str | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Approve a CLI auth session"""
        merged = _merge_params(params, org_id)
        return self.request("POST", f"/v1/cli-auth/{session_id}/approve", params=merged, json=body)

    async def apost_cli_auth_session_id_approve(
        self,
        session_id: str,
        body: dict | None = None,
        *,
        org_id: str | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Approve a CLI auth session"""
        merged = _merge_params(params, org_id)
        return await self.arequest(
            "POST", f"/v1/cli-auth/{session_id}/approve", params=merged, json=body
        )

    def post_cli_auth_session_id_deny(
        self,
        session_id: str,
        body: dict | None = None,
        *,
        org_id: str | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Deny a CLI auth session"""
        merged = _merge_params(params, org_id)
        return self.request("POST", f"/v1/cli-auth/{session_id}/deny", params=merged, json=body)

    async def apost_cli_auth_session_id_deny(
        self,
        session_id: str,
        body: dict | None = None,
        *,
        org_id: str | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Deny a CLI auth session"""
        merged = _merge_params(params, org_id)
        return await self.arequest(
            "POST", f"/v1/cli-auth/{session_id}/deny", params=merged, json=body
        )

    def get_me(self, *, org_id: str | None = None, params: dict[str, Any] | None = None) -> Any:
        """Identity introspection"""
        merged = _merge_params(params, org_id)
        return self.request("GET", "/v1/me", params=merged, json=None)

    async def aget_me(
        self, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """Identity introspection"""
        merged = _merge_params(params, org_id)
        return await self.arequest("GET", "/v1/me", params=merged, json=None)

    def get_projects_id_ai_quality(
        self, id: str, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """List AI-quality reports for a project"""
        merged = _merge_params(params, org_id)
        return _unwrap_list(
            self.request("GET", f"/v1/projects/{id}/ai-quality", params=merged, json=None)
        )

    async def aget_projects_id_ai_quality(
        self, id: str, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """List AI-quality reports for a project"""
        merged = _merge_params(params, org_id)
        return _unwrap_list(
            await self.arequest("GET", f"/v1/projects/{id}/ai-quality", params=merged, json=None)
        )

    def get_projects_id_ai_quality_latest(
        self, id: str, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """Get the latest AI-quality report for a project"""
        merged = _merge_params(params, org_id)
        return self.request("GET", f"/v1/projects/{id}/ai-quality/latest", params=merged, json=None)

    async def aget_projects_id_ai_quality_latest(
        self, id: str, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """Get the latest AI-quality report for a project"""
        merged = _merge_params(params, org_id)
        return await self.arequest(
            "GET", f"/v1/projects/{id}/ai-quality/latest", params=merged, json=None
        )

    def get_usage(self, *, org_id: str | None = None, params: dict[str, Any] | None = None) -> Any:
        """Aggregate usage totals for the caller's org"""
        merged = _merge_params(params, org_id)
        return self.request("GET", "/v1/usage", params=merged, json=None)

    async def aget_usage(
        self, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """Aggregate usage totals for the caller's org"""
        merged = _merge_params(params, org_id)
        return await self.arequest("GET", "/v1/usage", params=merged, json=None)

    def get_usage_events(
        self, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """List raw usage events"""
        merged = _merge_params(params, org_id)
        return _unwrap_list(self.request("GET", "/v1/usage/events", params=merged, json=None))

    async def aget_usage_events(
        self, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """List raw usage events"""
        merged = _merge_params(params, org_id)
        return _unwrap_list(
            await self.arequest("GET", "/v1/usage/events", params=merged, json=None)
        )

    def get_quota(self, *, org_id: str | None = None, params: dict[str, Any] | None = None) -> Any:
        """Per-org plan limits and current usage"""
        merged = _merge_params(params, org_id)
        return self.request("GET", "/v1/quota", params=merged, json=None)

    async def aget_quota(
        self, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """Per-org plan limits and current usage"""
        merged = _merge_params(params, org_id)
        return await self.arequest("GET", "/v1/quota", params=merged, json=None)

    def get_sso_providers(
        self, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """List SSO providers"""
        merged = _merge_params(params, org_id)
        return _unwrap_list(self.request("GET", "/v1/sso/providers", params=merged, json=None))

    async def aget_sso_providers(
        self, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """List SSO providers"""
        merged = _merge_params(params, org_id)
        return _unwrap_list(
            await self.arequest("GET", "/v1/sso/providers", params=merged, json=None)
        )

    def post_sso_providers(
        self,
        body: dict | None = None,
        *,
        org_id: str | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Configure an SSO provider"""
        merged = _merge_params(params, org_id)
        return self.request("POST", "/v1/sso/providers", params=merged, json=body)

    async def apost_sso_providers(
        self,
        body: dict | None = None,
        *,
        org_id: str | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Configure an SSO provider"""
        merged = _merge_params(params, org_id)
        return await self.arequest("POST", "/v1/sso/providers", params=merged, json=body)

    def delete_sso_providers_id(
        self, id: str, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """Remove an SSO provider"""
        merged = _merge_params(params, org_id)
        return self.request("DELETE", f"/v1/sso/providers/{id}", params=merged, json=None)

    async def adelete_sso_providers_id(
        self, id: str, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """Remove an SSO provider"""
        merged = _merge_params(params, org_id)
        return await self.arequest("DELETE", f"/v1/sso/providers/{id}", params=merged, json=None)

    def post_export(
        self,
        body: dict | None = None,
        *,
        org_id: str | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Export org data"""
        merged = _merge_params(params, org_id)
        return self.request("POST", "/v1/export", params=merged, json=body)

    async def apost_export(
        self,
        body: dict | None = None,
        *,
        org_id: str | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Export org data"""
        merged = _merge_params(params, org_id)
        return await self.arequest("POST", "/v1/export", params=merged, json=body)

    def get_search(self, *, org_id: str | None = None, params: dict[str, Any] | None = None) -> Any:
        """Full-text search across org history"""
        merged = _merge_params(params, org_id)
        return self.request("GET", "/v1/search", params=merged, json=None)

    async def aget_search(
        self, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """Full-text search across org history"""
        merged = _merge_params(params, org_id)
        return await self.arequest("GET", "/v1/search", params=merged, json=None)

    def get_feature_flags(
        self, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """List feature flags"""
        merged = _merge_params(params, org_id)
        return _unwrap_list(self.request("GET", "/v1/feature-flags", params=merged, json=None))

    async def aget_feature_flags(
        self, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """List feature flags"""
        merged = _merge_params(params, org_id)
        return _unwrap_list(
            await self.arequest("GET", "/v1/feature-flags", params=merged, json=None)
        )

    def patch_feature_flags_key(
        self,
        key: str,
        body: dict | None = None,
        *,
        org_id: str | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Set a feature flag override"""
        merged = _merge_params(params, org_id)
        return self.request("PATCH", f"/v1/feature-flags/{key}", params=merged, json=body)

    async def apatch_feature_flags_key(
        self,
        key: str,
        body: dict | None = None,
        *,
        org_id: str | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Set a feature flag override"""
        merged = _merge_params(params, org_id)
        return await self.arequest("PATCH", f"/v1/feature-flags/{key}", params=merged, json=body)

    def post_leads(
        self,
        body: dict | None = None,
        *,
        org_id: str | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Submit an Enterprise / sales lead"""
        merged = _merge_params(params, org_id)
        return self.request("POST", "/v1/leads", params=merged, json=body)

    async def apost_leads(
        self,
        body: dict | None = None,
        *,
        org_id: str | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Submit an Enterprise / sales lead"""
        merged = _merge_params(params, org_id)
        return await self.arequest("POST", "/v1/leads", params=merged, json=body)

    def get_samples(
        self, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """List curated samples"""
        merged = _merge_params(params, org_id)
        return _unwrap_list(self.request("GET", "/v1/samples", params=merged, json=None))

    async def aget_samples(
        self, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """List curated samples"""
        merged = _merge_params(params, org_id)
        return _unwrap_list(await self.arequest("GET", "/v1/samples", params=merged, json=None))

    def post_samples_instantiate(
        self,
        body: dict | None = None,
        *,
        org_id: str | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Instantiate a curated sample into a fresh project"""
        merged = _merge_params(params, org_id)
        return self.request("POST", "/v1/samples/instantiate", params=merged, json=body)

    async def apost_samples_instantiate(
        self,
        body: dict | None = None,
        *,
        org_id: str | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Instantiate a curated sample into a fresh project"""
        merged = _merge_params(params, org_id)
        return await self.arequest("POST", "/v1/samples/instantiate", params=merged, json=body)

    def get_slack_install(
        self, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """Begin Slack app installation"""
        merged = _merge_params(params, org_id)
        return self.request("GET", "/v1/slack/install", params=merged, json=None)

    async def aget_slack_install(
        self, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """Begin Slack app installation"""
        merged = _merge_params(params, org_id)
        return await self.arequest("GET", "/v1/slack/install", params=merged, json=None)

    def get_slack_oauth_callback(
        self, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """Slack OAuth callback"""
        merged = _merge_params(params, org_id)
        return self.request("GET", "/v1/slack/oauth-callback", params=merged, json=None)

    async def aget_slack_oauth_callback(
        self, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """Slack OAuth callback"""
        merged = _merge_params(params, org_id)
        return await self.arequest("GET", "/v1/slack/oauth-callback", params=merged, json=None)

    def get_slack_installations(
        self, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """List Slack installations for the caller's org"""
        merged = _merge_params(params, org_id)
        return _unwrap_list(
            self.request("GET", "/v1/slack/installations", params=merged, json=None)
        )

    async def aget_slack_installations(
        self, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """List Slack installations for the caller's org"""
        merged = _merge_params(params, org_id)
        return _unwrap_list(
            await self.arequest("GET", "/v1/slack/installations", params=merged, json=None)
        )

    def get_slack_subscriptions(
        self, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """List Slack channel subscriptions for the caller's org"""
        merged = _merge_params(params, org_id)
        return _unwrap_list(
            self.request("GET", "/v1/slack/subscriptions", params=merged, json=None)
        )

    async def aget_slack_subscriptions(
        self, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """List Slack channel subscriptions for the caller's org"""
        merged = _merge_params(params, org_id)
        return _unwrap_list(
            await self.arequest("GET", "/v1/slack/subscriptions", params=merged, json=None)
        )

    def post_slack_subscriptions(
        self,
        body: dict | None = None,
        *,
        org_id: str | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Subscribe a Slack channel to org events"""
        merged = _merge_params(params, org_id)
        return self.request("POST", "/v1/slack/subscriptions", params=merged, json=body)

    async def apost_slack_subscriptions(
        self,
        body: dict | None = None,
        *,
        org_id: str | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Subscribe a Slack channel to org events"""
        merged = _merge_params(params, org_id)
        return await self.arequest("POST", "/v1/slack/subscriptions", params=merged, json=body)

    def delete_slack_subscriptions_id(
        self, id: str, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """Remove a Slack channel subscription"""
        merged = _merge_params(params, org_id)
        return self.request("DELETE", f"/v1/slack/subscriptions/{id}", params=merged, json=None)

    async def adelete_slack_subscriptions_id(
        self, id: str, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """Remove a Slack channel subscription"""
        merged = _merge_params(params, org_id)
        return await self.arequest(
            "DELETE", f"/v1/slack/subscriptions/{id}", params=merged, json=None
        )

    def delete_slack_installations_id(
        self, id: str, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """Uninstall a Slack workspace integration"""
        merged = _merge_params(params, org_id)
        return self.request("DELETE", f"/v1/slack/installations/{id}", params=merged, json=None)

    async def adelete_slack_installations_id(
        self, id: str, *, org_id: str | None = None, params: dict[str, Any] | None = None
    ) -> Any:
        """Uninstall a Slack workspace integration"""
        merged = _merge_params(params, org_id)
        return await self.arequest(
            "DELETE", f"/v1/slack/installations/{id}", params=merged, json=None
        )
