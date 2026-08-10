#!/usr/bin/env python3
"""Aspirational codegen: read the Carbon OpenAPI snapshot and print a stub
module of per-endpoint methods.

Not invoked on install. Intended as a one-shot regeneration helper:

    python scripts/codegen.py \\
        ../../apps/dashboard/lib/openapi.snapshot.json \\
        > carbon_client/generated.py

The output is intentionally minimal — one method per (path, verb) pair,
each delegating to `self.request(...)`. Response shapes stay `Any`; the
hand-written surface in `client.py` remains the source of truth for
typed dataclass responses.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any, Dict, Iterable, List, Tuple

METHOD_HEADER = '''"""AUTO-GENERATED — do not edit.

Regenerate with `python scripts/codegen.py <openapi.json>`.
"""
from __future__ import annotations

from typing import Any, Optional

from .client import CarbonClient


class CarbonGenerated(CarbonClient):
    """Auto-generated per-endpoint methods layered on top of CarbonClient."""
'''


def _snake(s: str) -> str:
    s = re.sub(r"[{}]", "", s)
    s = re.sub(r"[^a-zA-Z0-9]+", "_", s).strip("_")
    return re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", s).lower()


def _method_name(verb: str, path: str) -> str:
    tail = path.replace("/v1/", "").replace("/v1", "")
    return f"{verb.lower()}_{_snake(tail)}" if tail else verb.lower()


def _path_params(path: str) -> List[str]:
    return re.findall(r"\{([^}]+)\}", path)


def iter_operations(spec: Dict[str, Any]) -> Iterable[Tuple[str, str, Dict[str, Any]]]:
    for path, item in (spec.get("paths") or {}).items():
        if not isinstance(item, dict):
            continue
        for verb, op in item.items():
            if verb.lower() in {"get", "post", "put", "patch", "delete"} and isinstance(op, dict):
                yield verb.upper(), path, op


def render(spec: Dict[str, Any]) -> str:
    lines: List[str] = [METHOD_HEADER]
    seen: set = set()
    for verb, path, op in iter_operations(spec):
        name = _method_name(verb, path)
        if name in seen:
            name = f"{name}_{verb.lower()}"
        seen.add(name)

        params = _path_params(path)
        py_path = path
        for p in params:
            py_path = py_path.replace("{" + p + "}", "{" + _snake(p) + "}")

        arg_list = ["self"] + [f"{_snake(p)}: str" for p in params]
        if verb in {"POST", "PUT", "PATCH"}:
            arg_list.append("body: Optional[dict] = None")
        arg_list.append("*")
        arg_list.append("params: Optional[dict] = None")

        summary = op.get("summary") or op.get("operationId") or f"{verb} {path}"

        body_arg = "body" if verb in {"POST", "PUT", "PATCH"} else "None"

        lines.append("")
        lines.append(f"    def {name}({', '.join(arg_list)}) -> Any:")
        lines.append(f'        """{summary}."""')
        lines.append(
            f'        return self.request("{verb}", f"{py_path}", params=params, json={body_arg})'
        )
    return "\n".join(lines) + "\n"


def main(argv: List[str]) -> int:
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
