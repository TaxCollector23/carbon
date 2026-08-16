"""Exception types raised by the Carbon client."""

from __future__ import annotations

from typing import Any


class CarbonError(Exception):
    """Structured error raised for non-2xx responses from the Carbon API.

    Mirrors the JS `CarbonError`: exposes `status`, `code`, `message`, and
    `details`, all safe to log or serialize.
    """

    def __init__(
        self,
        status: int,
        code: str = "CARBON_ERROR",
        message: str | None = None,
        details: Any = None,
    ) -> None:
        self.status = int(status)
        self.code = code or "CARBON_ERROR"
        self.message = message or f"Carbon API error {self.status}"
        self.details = details
        super().__init__(self.message)

    @classmethod
    def from_response(cls, status: int, body: Any) -> CarbonError:
        """Best-effort parse of a JSON error body into a CarbonError."""
        if isinstance(body, dict):
            return cls(
                status=int(body.get("status", status)),
                code=str(body.get("code", "CARBON_ERROR")),
                message=body.get("message"),
                details=body.get("details", body),
            )
        return cls(status=status, details=body)

    def __repr__(self) -> str:  # pragma: no cover - trivial
        return (
            f"CarbonError(status={self.status!r}, code={self.code!r}, " f"message={self.message!r})"
        )
