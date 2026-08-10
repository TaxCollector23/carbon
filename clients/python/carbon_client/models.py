"""Dataclass models mirroring the Carbon API response shapes.

These are hand-derived from `apps/dashboard/lib/openapi.snapshot.json` for
the top-10 endpoints. Each dataclass exposes a permissive `from_dict`
constructor that ignores unknown fields, so a server that adds new
attributes never breaks the client.
"""

from __future__ import annotations

from dataclasses import dataclass, field, fields
from typing import Any, Dict, List, Optional, Type, TypeVar

T = TypeVar("T", bound="_Base")


class _Base:
    """Shared `from_dict` that tolerates unknown/missing keys."""

    @classmethod
    def from_dict(cls: Type[T], data: Any) -> T:
        if not isinstance(data, dict):
            raise TypeError(f"{cls.__name__}.from_dict expected dict, got {type(data)!r}")
        allowed = {f.name for f in fields(cls)}  # type: ignore[arg-type]
        return cls(**{k: v for k, v in data.items() if k in allowed})  # type: ignore[call-arg]


@dataclass
class Project(_Base):
    id: str = ""
    slug: str = ""
    name: str = ""
    orgId: Optional[str] = None
    createdAt: Optional[str] = None
    updatedAt: Optional[str] = None


@dataclass
class Snapshot(_Base):
    id: str = ""
    name: str = ""
    projectId: Optional[str] = None
    projectSlug: Optional[str] = None
    createdAt: Optional[str] = None
    size: Optional[int] = None


@dataclass
class Emulator(_Base):
    id: str = ""
    name: str = ""
    projectId: Optional[str] = None
    status: Optional[str] = None
    createdAt: Optional[str] = None


@dataclass
class Event(_Base):
    id: str = ""
    type: str = ""
    projectId: Optional[str] = None
    orgId: Optional[str] = None
    payload: Any = None
    createdAt: Optional[str] = None


@dataclass
class ApiKey(_Base):
    id: str = ""
    name: str = ""
    prefix: Optional[str] = None
    lastUsedAt: Optional[str] = None
    createdAt: Optional[str] = None
    # Only present in create responses:
    key: Optional[str] = None


@dataclass
class UsageBucket(_Base):
    period: str = ""
    requests: int = 0
    ingested: int = 0
    egress: int = 0


@dataclass
class UsageResponse(_Base):
    total: Dict[str, int] = field(default_factory=dict)
    buckets: List[UsageBucket] = field(default_factory=list)

    @classmethod
    def from_dict(cls, data: Any) -> "UsageResponse":  # type: ignore[override]
        if not isinstance(data, dict):
            raise TypeError("UsageResponse.from_dict expected dict")
        buckets = [UsageBucket.from_dict(b) for b in data.get("buckets", []) or []]
        total = data.get("total") or {}
        return cls(total=dict(total), buckets=buckets)


@dataclass
class HealthResponse(_Base):
    status: str = "unknown"
    version: Optional[str] = None
    uptime: Optional[float] = None
