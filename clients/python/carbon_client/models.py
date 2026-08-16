"""Dataclass models mirroring the Carbon API response shapes.

These are hand-derived from `apps/dashboard/lib/openapi.snapshot.json` for
the top-10 endpoints. Each dataclass exposes a permissive `from_dict`
constructor that ignores unknown fields, so a server that adds new
attributes never breaks the client.
"""

from __future__ import annotations

from dataclasses import dataclass, field, fields
from typing import Any, TypeVar

from typing_extensions import Self

T = TypeVar("T", bound="_Base")


class _Base:
    """Shared `from_dict` that tolerates unknown/missing keys."""

    @classmethod
    def from_dict(cls, data: Any) -> Self:
        if not isinstance(data, dict):
            raise TypeError(f"{cls.__name__}.from_dict expected dict, got {type(data)!r}")
        allowed = {f.name for f in fields(cls)}  # type: ignore[arg-type]
        return cls(**{k: v for k, v in data.items() if k in allowed})  # type: ignore[call-arg]


@dataclass
class Project(_Base):
    id: str = ""
    slug: str = ""
    name: str = ""
    orgId: str | None = None
    createdAt: str | None = None
    updatedAt: str | None = None


@dataclass
class Snapshot(_Base):
    id: str = ""
    name: str = ""
    projectId: str | None = None
    projectSlug: str | None = None
    createdAt: str | None = None
    size: int | None = None


@dataclass
class Emulator(_Base):
    id: str = ""
    name: str = ""
    projectId: str | None = None
    status: str | None = None
    createdAt: str | None = None


@dataclass
class Event(_Base):
    id: str = ""
    type: str = ""
    projectId: str | None = None
    orgId: str | None = None
    payload: Any = None
    createdAt: str | None = None


@dataclass
class ApiKey(_Base):
    id: str = ""
    name: str = ""
    prefix: str | None = None
    lastUsedAt: str | None = None
    createdAt: str | None = None
    # Only present in create responses:
    key: str | None = None


@dataclass
class UsageBucket(_Base):
    period: str = ""
    requests: int = 0
    ingested: int = 0
    egress: int = 0


@dataclass
class UsageResponse(_Base):
    total: dict[str, int] = field(default_factory=dict)
    buckets: list[UsageBucket] = field(default_factory=list)

    @classmethod
    def from_dict(cls, data: Any) -> UsageResponse:  # type: ignore[override]
        if not isinstance(data, dict):
            raise TypeError("UsageResponse.from_dict expected dict")
        buckets = [UsageBucket.from_dict(b) for b in data.get("buckets", []) or []]
        total = data.get("total") or {}
        return cls(total=dict(total), buckets=buckets)


@dataclass
class HealthResponse(_Base):
    status: str = "unknown"
    version: str | None = None
    uptime: float | None = None
