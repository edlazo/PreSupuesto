"""Supabase access layer.

Every read and write against the PreSupuesto database goes through this
module, as required by the project conventions. Functions are synchronous
because the Supabase Python client is synchronous; FastAPI runs the
synchronous endpoints in a thread pool.
"""

from __future__ import annotations

import logging
import threading
from typing import Any, Optional

from supabase import Client, create_client

from config import settings

logger = logging.getLogger(__name__)

_client: Optional[Client] = None
_client_lock = threading.Lock()

MATERIALS_TABLE = "materials"
STANDARD_TASKS_TABLE = "standard_tasks"
CLIENTS_TABLE = "clients"
BUDGETS_TABLE = "budgets"
BUDGET_ITEMS_TABLE = "budget_items"


class SupabaseServiceError(Exception):
    """Raised when a Supabase operation fails.

    `code` carries the PostgreSQL error code when available, so callers can
    tell a unique-violation (23505) from a generic failure.
    """

    def __init__(self, message: str, *, code: Optional[str] = None) -> None:
        super().__init__(message)
        self.message = message
        self.code = code


class NotConfiguredError(SupabaseServiceError):
    """Raised when the Supabase credentials are missing."""


def get_client() -> Client:
    """Return the shared Supabase client, creating it on first use."""
    global _client

    if _client is not None:
        return _client

    with _client_lock:
        if _client is None:
            if not settings.supabase_configured:
                raise NotConfiguredError(
                    "SUPABASE_URL and SUPABASE_KEY must be set in backend/.env"
                )
            _client = create_client(settings.supabase_url, settings.supabase_key)
    return _client


def _execute(query: Any, *, action: str) -> list[dict[str, Any]]:
    """Run a PostgREST query and return its rows, normalizing failures."""
    try:
        response = query.execute()
    except Exception as exc:  # postgrest raises APIError and httpx errors
        code = getattr(exc, "code", None)
        message = getattr(exc, "message", None) or str(exc)
        logger.error("Supabase %s failed: %s", action, message)
        raise SupabaseServiceError(f"{action} failed: {message}", code=code) from exc

    data = getattr(response, "data", None)
    if data is None:
        return []
    if isinstance(data, dict):
        return [data]
    return list(data)


def _first(rows: list[dict[str, Any]]) -> Optional[dict[str, Any]]:
    """Return the first row, or None when the result set is empty."""
    return rows[0] if rows else None


# ---------------------------------------------------------------------------
# Materials
# ---------------------------------------------------------------------------
def list_materials(
    *,
    search: Optional[str] = None,
    category: Optional[str] = None,
    is_active: Optional[bool] = None,
    limit: int = 100,
    offset: int = 0,
) -> list[dict[str, Any]]:
    """List materials, optionally filtered by name, category or active flag."""
    query = get_client().table(MATERIALS_TABLE).select("*")

    if search:
        query = query.ilike("name", f"%{search}%")
    if category:
        query = query.eq("category", category)
    if is_active is not None:
        query = query.eq("is_active", is_active)

    query = query.order("name").range(offset, offset + limit - 1)
    return _execute(query, action="list materials")


def get_material(material_id: str) -> Optional[dict[str, Any]]:
    """Return a material by id, or None when it does not exist."""
    query = get_client().table(MATERIALS_TABLE).select("*").eq("id", material_id).limit(1)
    return _first(_execute(query, action="get material"))


def get_material_by_code(code: str) -> Optional[dict[str, Any]]:
    """Return a material by its catalog code, or None when it does not exist."""
    query = get_client().table(MATERIALS_TABLE).select("*").eq("code", code).limit(1)
    return _first(_execute(query, action="get material by code"))


def create_material(payload: dict[str, Any]) -> dict[str, Any]:
    """Insert a material and return the stored row."""
    query = get_client().table(MATERIALS_TABLE).insert(payload)
    row = _first(_execute(query, action="create material"))
    if row is None:
        raise SupabaseServiceError("create material returned no row")
    return row


def update_material(material_id: str, payload: dict[str, Any]) -> Optional[dict[str, Any]]:
    """Update a material and return the stored row, or None when not found."""
    if not payload:
        return get_material(material_id)

    query = get_client().table(MATERIALS_TABLE).update(payload).eq("id", material_id)
    return _first(_execute(query, action="update material"))


def delete_material(material_id: str) -> bool:
    """Delete a material. Returns False when the material does not exist."""
    query = get_client().table(MATERIALS_TABLE).delete().eq("id", material_id)
    return bool(_execute(query, action="delete material"))


def count_materials(
    *,
    search: Optional[str] = None,
    category: Optional[str] = None,
    is_active: Optional[bool] = None,
) -> int:
    """Return how many materials match the given filters."""
    query = get_client().table(MATERIALS_TABLE).select("id", count="exact")

    if search:
        query = query.ilike("name", f"%{search}%")
    if category:
        query = query.eq("category", category)
    if is_active is not None:
        query = query.eq("is_active", is_active)

    try:
        response = query.limit(1).execute()
    except Exception as exc:
        message = getattr(exc, "message", None) or str(exc)
        raise SupabaseServiceError(f"count materials failed: {message}") from exc

    return int(getattr(response, "count", 0) or 0)


# ---------------------------------------------------------------------------
# Standard tasks
# ---------------------------------------------------------------------------
def list_standard_tasks(
    *,
    search: Optional[str] = None,
    trade: Optional[str] = None,
    is_active: Optional[bool] = None,
    limit: int = 100,
) -> list[dict[str, Any]]:
    """List standard tasks, optionally filtered by name, trade or active flag."""
    query = get_client().table(STANDARD_TASKS_TABLE).select("*")

    if search:
        query = query.ilike("name", f"%{search}%")
    if trade:
        query = query.eq("trade", trade)
    if is_active is not None:
        query = query.eq("is_active", is_active)

    query = query.order("name").limit(limit)
    return _execute(query, action="list standard tasks")


def get_standard_task_by_code(code: str) -> Optional[dict[str, Any]]:
    """Return a standard task by its code, or None when it does not exist."""
    query = get_client().table(STANDARD_TASKS_TABLE).select("*").eq("code", code).limit(1)
    return _first(_execute(query, action="get standard task by code"))


# ---------------------------------------------------------------------------
# Clients
# ---------------------------------------------------------------------------
def list_clients(*, search: Optional[str] = None, limit: int = 50) -> list[dict[str, Any]]:
    """List clients, optionally filtered by name."""
    query = get_client().table(CLIENTS_TABLE).select("*")

    if search:
        query = query.ilike("full_name", f"%{search}%")

    query = query.order("full_name").limit(limit)
    return _execute(query, action="list clients")


def get_client_record(client_id: str) -> Optional[dict[str, Any]]:
    """Return a client by id, or None when it does not exist."""
    query = get_client().table(CLIENTS_TABLE).select("*").eq("id", client_id).limit(1)
    return _first(_execute(query, action="get client"))


def create_client_record(payload: dict[str, Any]) -> dict[str, Any]:
    """Insert a client and return the stored row."""
    query = get_client().table(CLIENTS_TABLE).insert(payload)
    row = _first(_execute(query, action="create client"))
    if row is None:
        raise SupabaseServiceError("create client returned no row")
    return row


# ---------------------------------------------------------------------------
# Budgets
# ---------------------------------------------------------------------------
def create_budget(budget: dict[str, Any], items: list[dict[str, Any]]) -> dict[str, Any]:
    """Create a budget with its lines and return the complete budget.

    PostgREST has no multi-statement transaction, so the header is inserted
    first and the lines second. If the lines fail, the header is deleted so no
    empty budget is left behind.
    """
    header = _first(_execute(get_client().table(BUDGETS_TABLE).insert(budget), action="create budget"))
    if header is None:
        raise SupabaseServiceError("create budget returned no row")

    budget_id = header["id"]

    if items:
        rows = [dict(item, budget_id=budget_id) for item in items]
        try:
            _execute(get_client().table(BUDGET_ITEMS_TABLE).insert(rows), action="create budget items")
        except SupabaseServiceError:
            # Roll back the header so a failed insert leaves nothing behind.
            try:
                _execute(
                    get_client().table(BUDGETS_TABLE).delete().eq("id", budget_id),
                    action="rollback budget",
                )
            except SupabaseServiceError:
                logger.error("Could not roll back budget %s after a failed item insert", budget_id)
            raise

    stored = get_budget(budget_id)
    if stored is None:
        raise SupabaseServiceError("budget disappeared right after creation")
    return stored


def get_budget(budget_id: str) -> Optional[dict[str, Any]]:
    """Return a budget with its lines, or None when it does not exist."""
    header_query = get_client().table(BUDGETS_TABLE).select("*").eq("id", budget_id).limit(1)
    header = _first(_execute(header_query, action="get budget"))
    if header is None:
        return None

    items_query = (
        get_client()
        .table(BUDGET_ITEMS_TABLE)
        .select("*")
        .eq("budget_id", budget_id)
        .order("sort_order")
    )
    header["items"] = _execute(items_query, action="get budget items")
    return header


def list_budgets(
    *,
    client_id: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = 50,
) -> list[dict[str, Any]]:
    """List budget headers, optionally filtered by client or status."""
    query = get_client().table(BUDGETS_TABLE).select("*")

    if client_id:
        query = query.eq("client_id", client_id)
    if status:
        query = query.eq("status", status)

    query = query.order("created_at", desc=True).limit(limit)
    return _execute(query, action="list budgets")
