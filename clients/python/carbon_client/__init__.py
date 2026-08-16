"""carbon-client — official Python client for the Carbon control-plane API."""

from . import models
from .client import CarbonClient
from .exceptions import CarbonError
from .generated import CarbonGenerated

# `Carbon` is the full-surface generated client; `CarbonClient` is its
# hand-written base (top-10 ergonomic methods + low-level `request`).
Carbon = CarbonGenerated

__all__ = ["Carbon", "CarbonClient", "CarbonError", "CarbonGenerated", "models"]
__version__ = "0.1.0"
