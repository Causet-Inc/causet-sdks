"""Causet Python SDK — submit intents, read state, and query projections."""

from causet_sdk.client import CausetClient
from causet_sdk._sync import CausetClientSync
from causet_sdk.errors import CausetError, CausetAuthError, CausetApiError
from causet_sdk.query_projection import flatten_projection_items, flatten_projection_row

__all__ = [
    "CausetClient",
    "CausetClientSync",
    "CausetError",
    "CausetAuthError",
    "CausetApiError",
    "flatten_projection_items",
    "flatten_projection_row",
]
