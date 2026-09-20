"""Supabase access layer.

Every read and write against the PreSupuesto database goes through this
module, as required by the project conventions. Functions are synchronous
because the Supabase Python client is synchronous; FastAPI runs the
synchronous endpoints in a thread pool.
"""

from __future__ import annotations

import logging
import re
import threading
import unicodedata
from decimal import Decimal, ROUND_HALF_UP
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

# PostgreSQL's unique_violation, raised when a code is already taken.
UNIQUE_VIOLATION = "23505"

# --- Generated material codes ------------------------------------------------
# Codes read MAT-<CATEGORY>-<NUMBER>, e.g. MAT-ALB-004.
CODE_NAMESPACE = "MAT"
FALLBACK_PREFIX = "GEN"
CODE_GENERATION_ATTEMPTS = 5

# Chosen prefixes for the categories the catalog ships with. Keys are accent
# free and lowercase, which is how `build_category_prefix` looks them up.
CATEGORY_PREFIXES = {
    "albanileria": "ALB",
    "pintura": "PIN",
    "materiales de agarre": "AGA",
    "aridos": "ARI",
    "hormigon": "HOR",
    "hierros": "HIE",
    "durlock": "DUR",
    "pisos y revestimientos": "PIS",
    "aislaciones": "AIS",
    "impermeabilizacion": "IMP",
    "sanitarios": "SAN",
    "electricidad": "ELE",
    "plomeria": "PLO",
    "carpinteria": "CAR",
    "herramientas": "HER",
}

# Stand-in client for budgets started before the customer is known.
DEFAULT_CLIENT_NAME = "Consumidor final"

# Words that never start a prefix when one has to be derived.
PREFIX_STOPWORDS = {"de", "del", "la", "las", "el", "los", "y", "para", "con"}


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


def _strip_accents(text: str) -> str:
    """Fold "Albañilería" to "Albanileria", so lookups are accent free."""
    return "".join(
        character
        for character in unicodedata.normalize("NFKD", text)
        if not unicodedata.combining(character)
    )


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


def build_category_prefix(category: str) -> str:
    """Return the three-letter code for a category, e.g. "Albañilería" -> "ALB".

    Known categories have a chosen prefix; anything else falls back to the
    first letters of the first meaningful word, so a category invented later
    still produces a usable code.
    """
    normalized = _strip_accents(str(category or "")).strip().lower()

    if normalized in CATEGORY_PREFIXES:
        return CATEGORY_PREFIXES[normalized]

    words = [word for word in re.split(r"[^a-z0-9]+", normalized) if word and word not in PREFIX_STOPWORDS]
    if not words:
        return FALLBACK_PREFIX

    # Pad short words so the prefix is always three characters wide.
    return words[0][:3].upper().ljust(3, "X")


def generate_material_code(category: str) -> str:
    """Return the next free code for a category, e.g. "MAT-ALB-004".

    Numbering is per category and continues after the highest number in use,
    so a deleted material never has its code handed to a different one.
    """
    prefix = build_category_prefix(category)
    pattern = f"{CODE_NAMESPACE}-{prefix}-"

    query = get_client().table(MATERIALS_TABLE).select("code").like("code", f"{pattern}%")
    rows = _execute(query, action="list codes for a category")

    matcher = re.compile(rf"^{re.escape(pattern)}(\d+)$")
    numbers = [
        int(match.group(1))
        for row in rows
        if (match := matcher.match(str(row.get("code") or "")))
    ]

    return f"{pattern}{max(numbers, default=0) + 1:03d}"


def create_material(payload: dict[str, Any]) -> dict[str, Any]:
    """Insert a material and return the stored row.

    A missing or empty code is generated from the category. Two people adding
    a material at the same moment can pick the same number, so a rejected code
    is regenerated and retried rather than surfacing as a conflict.
    """
    payload = dict(payload)
    code = str(payload.get("code") or "").strip()

    if code:
        payload["code"] = code
        return _insert_material(payload)

    for attempt in range(CODE_GENERATION_ATTEMPTS):
        payload["code"] = generate_material_code(payload.get("category", ""))

        try:
            return _insert_material(payload)
        except SupabaseServiceError as exc:
            is_last_attempt = attempt + 1 >= CODE_GENERATION_ATTEMPTS
            if exc.code != UNIQUE_VIOLATION or is_last_attempt:
                raise
            logger.warning("Generated code %s was taken, retrying", payload["code"])

    # Unreachable: the loop either returns or raises.
    raise SupabaseServiceError("create material exhausted its code attempts")


def _insert_material(payload: dict[str, Any]) -> dict[str, Any]:
    """Insert one material row and return it."""
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


def bulk_update_material_prices(
    *,
    percentage: float,
    category: Optional[str] = None,
    material_ids: Optional[list[str]] = None,
    only_active: bool = True,
) -> list[dict[str, Any]]:
    """Apply a percentage change to the unit price of the matching materials.

    PostgREST cannot express `unit_price = unit_price * factor`, so the rows are
    read, priced in Python and written back one by one. Returns the rows that
    changed, which is empty when nothing matches or no price moves.
    """
    query = get_client().table(MATERIALS_TABLE).select("*")

    if category:
        query = query.eq("category", category)
    if material_ids:
        query = query.in_("id", material_ids)
    if only_active:
        query = query.eq("is_active", True)

    materials = _execute(query.order("code"), action="list materials for bulk update")

    factor = Decimal("1") + Decimal(str(percentage)) / Decimal("100")
    updated: list[dict[str, Any]] = []

    for material in materials:
        current_price = Decimal(str(material["unit_price"]))
        new_price = (current_price * factor).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

        # The column is non-negative, and a price cannot be talked below zero.
        if new_price < 0:
            new_price = Decimal("0.00")
        if new_price == current_price:
            continue

        row = update_material(material["id"], {"unit_price": float(new_price)})
        if row is not None:
            updated.append(row)

    return updated


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


def get_standard_task(task_id: str) -> Optional[dict[str, Any]]:
    """Return a standard task by id, or None when it does not exist."""
    query = get_client().table(STANDARD_TASKS_TABLE).select("*").eq("id", task_id).limit(1)
    return _first(_execute(query, action="get standard task"))


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
def get_or_create_default_client() -> dict[str, Any]:
    """Return the fallback client a budget uses until a real one is chosen.

    `budgets.client_id` is not nullable, but a budget usually starts before
    anyone has asked the customer their name, so manual drafts hang off a
    single "Consumidor final" row.
    """
    query = (
        get_client()
        .table(CLIENTS_TABLE)
        .select("*")
        .eq("full_name", DEFAULT_CLIENT_NAME)
        .limit(1)
    )
    existing = _first(_execute(query, action="find the default client"))

    if existing is not None:
        return existing

    return create_client_record({"full_name": DEFAULT_CLIENT_NAME})


def add_budget_item(budget_id: str, item: dict[str, Any]) -> dict[str, Any]:
    """Append one line to a budget and return the stored row.

    The database recomputes the budget totals through its own trigger, so the
    caller only has to read the budget back.
    """
    payload = dict(item, budget_id=budget_id)

    if "sort_order" not in payload:
        payload["sort_order"] = next_budget_item_order(budget_id)

    query = get_client().table(BUDGET_ITEMS_TABLE).insert(payload)
    row = _first(_execute(query, action="add budget item"))
    if row is None:
        raise SupabaseServiceError("add budget item returned no row")
    return row


def next_budget_item_order(budget_id: str) -> int:
    """Return the sort order that puts a new line at the end of a budget."""
    query = (
        get_client()
        .table(BUDGET_ITEMS_TABLE)
        .select("sort_order")
        .eq("budget_id", budget_id)
        .order("sort_order", desc=True)
        .limit(1)
    )
    last = _first(_execute(query, action="read the last sort order"))

    return int(last["sort_order"]) + 1 if last else 0


def delete_budget_item(budget_id: str, item_id: str) -> bool:
    """Remove one line from a budget. False when the line does not exist."""
    query = (
        get_client()
        .table(BUDGET_ITEMS_TABLE)
        .delete()
        .eq("id", item_id)
        .eq("budget_id", budget_id)
    )
    return bool(_execute(query, action="delete budget item"))


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


def update_budget(budget_id: str, payload: dict[str, Any]) -> Optional[dict[str, Any]]:
    """Change a budget header and return the complete budget.

    Only the header fields are touched: the lines and the totals the database
    keeps for them stay exactly as they were.
    """
    if not payload:
        return get_budget(budget_id)

    query = get_client().table(BUDGETS_TABLE).update(payload).eq("id", budget_id)
    updated = _first(_execute(query, action="update budget"))

    if updated is None:
        return None

    return get_budget(budget_id)


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
