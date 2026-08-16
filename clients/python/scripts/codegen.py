#!/usr/bin/env python3
"""Generate ``carbon_client/generated.py`` from the Carbon OpenAPI snapshot.

Run from the repo root:

    python clients/python/scripts/codegen.py \\
        apps/dashboard/lib/openapi.snapshot.json \\
        > clients/python/carbon_client/generated.py

The output is a full, committed client surface — one sync method and one
``a``-prefixed async method per (verb, path) pair — layered on top of
``CarbonClient``. List endpoints whose 200 response declares a top-level
``data`` array are unwrapped to that list; everything else returns the parsed
JSON as-is. Path parameters become required keyword arguments, the request
body becomes ``body``, and every method accepts optional ``org_id`` and
``params`` kwargs so org-scoped routes resolve without callers hand-building
query strings.
"""

from __future__ import annotations

import json
import re
import sys
from collections.abc import Iterable
from pathlib import Path
from typing import Any

METHOD_HEADER = '''"""AUTO-GENERATED — do not edit.

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
'''


def _snake(s: str) -> str:
    s = re.sub(r"[{}]", "", s)
    s = re.sub(r"[^a-zA-Z0-9]+", "_", s).strip("_")
    return re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", s).lower()


def _method_name(verb: str, path: str) -> str:
    tail = path.replace("/v1/", "").replace("/v1", "").strip("/")
    return f"{verb.lower()}_{_snake(tail)}" if tail else verb.lower()


def _path_params(path: str) -> list[str]:
    return re.findall(r"\{([^}]+)\}", path)


def _py_path(path: str) -> str:
    out = path
    for p in _path_params(path):
        out = out.replace("{" + p + "}", "{" + _snake(p) + "}")
    return out


def _docstring(summary: str) -> str:
    one_line = " ".join(summary.split())
    return one_line.replace('"', '\\"').replace("\\", "\\\\")


def _returns_unwrapped_list(op: dict[str, Any]) -> bool:
    """True when the 200/201 response schema has a top-level list ``data``."""
    for code in ("200", "201"):
        resp = (op.get("responses") or {}).get(code) or {}
        content = (resp.get("content") or {}).get("application/json") or {}
        schema = content.get("schema") or {}
        if isinstance(schema, dict) and schema.get("type") == "object":
            props = schema.get("properties") or {}
            data = props.get("data") or {}
            if isinstance(data, dict) and data.get("type") == "array":
                return True
    return False


def iter_operations(spec: dict[str, Any]) -> Iterable[tuple[str, str, dict[str, Any]]]:
    for path, item in (spec.get("paths") or {}).items():
        if not isinstance(item, dict):
            continue
        for verb, op in item.items():
            if verb.lower() in {"get", "post", "put", "patch", "delete"} and isinstance(op, dict):
                yield verb.upper(), path, op


def _signature(verb: str, path: str, async_: bool) -> tuple[str, list[str], str]:
    params = _path_params(path)
    args = ["self"]
    for p in params:
        args.append(f"{_snake(p)}: str")
    if verb in {"POST", "PUT", "PATCH"}:
        args.append("body: dict | None = None")
    args.append("*")
    args.append("org_id: str | None = None")
    args.append("params: dict[str, Any] | None = None")
    name = _method_name(verb, path)
    if async_:
        name = "a" + name
    return name, args, _py_path(path)


def render(spec: dict[str, Any]) -> str:
    lines: list[str] = [METHOD_HEADER]
    seen: set = set()
    for verb, path, op in iter_operations(spec):
        summary = op.get("summary") or op.get("operationId") or f"{verb} {path}"
        unwrap = _returns_unwrapped_list(op)
        doc = _docstring(summary)
        body_arg = "body" if verb in {"POST", "PUT", "PATCH"} else "None"

        for async_ in (False, True):
            name, args, py_path = _signature(verb, path, async_)
            if name in seen:
                name = f"{name}_{verb.lower()}"
            seen.add(name)
            call = "await self.arequest" if async_ else "self.request"
            lines.append("")
            lines.append(f"    {'async ' if async_ else ''}def {name}({', '.join(args)}) -> Any:")
            lines.append(f'        """{doc}"""')
            lines.append("        merged = _merge_params(params, org_id)")
            path_literal = f'f"{py_path}"' if "{" in py_path else f'"{py_path}"'
            result = f'{call}("{verb}", {path_literal}, params=merged, json={body_arg})'
            if unwrap:
                result = f"_unwrap_list({result})"
            lines.append(f"        return {result}")

    return "\n".join(lines) + "\n"


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print("usage: codegen.py <openapi.json>", file=sys.stderr)
        return 2
    spec_path = Path(argv[1])
    if not spec_path.exists() or spec_path.stat().st_size == 0:
        print(f"error: {spec_path} is missing or empty", file=sys.stderr)
        return 1
    spec = json.loads(spec_path.read_text())
    sys.stdout.write(render(spec))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
