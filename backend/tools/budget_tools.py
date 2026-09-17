"""Hermes Agent tools for construction budgeting.

Each tool follows the Hermes tool contract:

* the handler receives ``(args: dict, **kwargs)``;
* it returns a JSON **string**, never a dict;
* failures are returned as ``{"error": "message"}`` instead of raised.

The module exposes `TOOL_SCHEMAS` (JSON schemas describing every tool) and
`dispatch_tool()` (name + arguments -> JSON string). `mcp_server.py` serves
both to Hermes Agent over MCP; the same registry can be reused by any other
agent runtime.
"""

from __future__ import annotations

import json
import logging
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any, Callable, Optional

from config import settings
from services import supabase_service
from services.supabase_service import SupabaseServiceError

logger = logging.getLogger(__name__)

CENTS = Decimal("0.01")
QUANTITY_PRECISION = Decimal("0.001")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _ok(payload: Any) -> str:
    """Serialize a successful result."""
    return json.dumps(payload, ensure_ascii=False, default=str)


def _error(message: str) -> str:
    """Serialize an error result the way Hermes expects."""
    return json.dumps({"error": message}, ensure_ascii=False)


def _to_decimal(value: Any, field: str) -> Decimal:
    """Convert a tool argument to Decimal, raising ValueError when invalid."""
    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise ValueError(f"'{field}' must be a number, got {value!r}") from exc


def _money(value: Decimal) -> Decimal:
    """Round a monetary amount to two decimals."""
    return value.quantize(CENTS, rounding=ROUND_HALF_UP)


def _quantity(value: Decimal) -> Decimal:
    """Round a quantity to three decimals, matching the database column."""
    return value.quantize(QUANTITY_PRECISION, rounding=ROUND_HALF_UP)


def _build_estimate_lines(raw_items: Any) -> list[dict[str, Any]]:
    """Resolve catalog prices and compute the total for every line.

    Each incoming item must carry a quantity plus one of:

    * ``material_code`` — priced from the materials catalog;
    * ``task_code``     — priced from the standard tasks catalog;
    * ``description`` + ``unit`` + ``unit_price`` — a free line.

    Materials also accept ``waste_percent``, which increases the quantity.

    Raises ValueError when an item is malformed or a code does not exist.
    """
    if not isinstance(raw_items, list) or not raw_items:
        raise ValueError("'items' must be a non-empty list")

    lines: list[dict[str, Any]] = []

    for index, raw in enumerate(raw_items):
        if not isinstance(raw, dict):
            raise ValueError(f"item {index} must be an object")

        quantity = _to_decimal(raw.get("quantity"), f"items[{index}].quantity")
        if quantity <= 0:
            raise ValueError(f"items[{index}].quantity must be greater than zero")

        material_code = (raw.get("material_code") or "").strip()
        task_code = (raw.get("task_code") or "").strip()

        if material_code and task_code:
            raise ValueError(f"item {index} cannot carry both 'material_code' and 'task_code'")

        if material_code:
            material = supabase_service.get_material_by_code(material_code)
            if material is None:
                raise ValueError(f"material code '{material_code}' does not exist")

            waste_percent = _to_decimal(raw.get("waste_percent", 0), f"items[{index}].waste_percent")
            if waste_percent < 0:
                raise ValueError(f"items[{index}].waste_percent cannot be negative")

            effective_quantity = _quantity(quantity * (Decimal("1") + waste_percent / Decimal("100")))
            unit_price = _money(_to_decimal(material["unit_price"], "unit_price"))

            lines.append(
                {
                    "item_type": "material",
                    "material_id": material["id"],
                    "standard_task_id": None,
                    "description": raw.get("description") or material["name"],
                    "unit": material["unit"],
                    "quantity": effective_quantity,
                    "unit_price": unit_price,
                    "line_total": _money(effective_quantity * unit_price),
                    "sort_order": index,
                    "source_code": material["code"],
                    "waste_percent": waste_percent,
                }
            )
            continue

        if task_code:
            task = supabase_service.get_standard_task_by_code(task_code)
            if task is None:
                raise ValueError(f"standard task code '{task_code}' does not exist")

            quantity = _quantity(quantity)
            unit_price = _money(_to_decimal(task["labor_unit_price"], "labor_unit_price"))

            lines.append(
                {
                    "item_type": "task",
                    "material_id": None,
                    "standard_task_id": task["id"],
                    "description": raw.get("description") or task["name"],
                    "unit": task["unit"],
                    "quantity": quantity,
                    "unit_price": unit_price,
                    "line_total": _money(quantity * unit_price),
                    "sort_order": index,
                    "source_code": task["code"],
                    "waste_percent": Decimal("0"),
                }
            )
            continue

        # Free line: the caller supplies description, unit and price.
        description = (raw.get("description") or "").strip()
        unit = (raw.get("unit") or "").strip()
        if not description or not unit or raw.get("unit_price") is None:
            raise ValueError(
                f"item {index} needs 'material_code', 'task_code', or "
                "'description' + 'unit' + 'unit_price'"
            )

        quantity = _quantity(quantity)
        unit_price = _money(_to_decimal(raw.get("unit_price"), f"items[{index}].unit_price"))
        if unit_price < 0:
            raise ValueError(f"items[{index}].unit_price cannot be negative")

        lines.append(
            {
                "item_type": "custom",
                "material_id": None,
                "standard_task_id": None,
                "description": description,
                "unit": unit,
                "quantity": quantity,
                "unit_price": unit_price,
                "line_total": _money(quantity * unit_price),
                "sort_order": index,
                "source_code": None,
                "waste_percent": Decimal("0"),
            }
        )

    return lines


def _summarize(lines: list[dict[str, Any]], tax_rate: Decimal) -> dict[str, Any]:
    """Compute subtotal, tax and total for a set of lines."""
    subtotal = _money(sum((line["line_total"] for line in lines), Decimal("0")))
    tax_amount = _money(subtotal * tax_rate / Decimal("100"))
    return {
        "subtotal": float(subtotal),
        "tax_rate": float(tax_rate),
        "tax_amount": float(tax_amount),
        "total": float(subtotal + tax_amount),
        "currency": settings.default_currency,
    }


def _line_for_output(line: dict[str, Any]) -> dict[str, Any]:
    """Present a computed line as plain JSON types."""
    return {
        "item_type": line["item_type"],
        "code": line["source_code"],
        "description": line["description"],
        "unit": line["unit"],
        "quantity": float(line["quantity"]),
        "unit_price": float(line["unit_price"]),
        "line_total": float(line["line_total"]),
    }


def _line_for_database(line: dict[str, Any]) -> dict[str, Any]:
    """Present a computed line as a `budget_items` row."""
    return {
        "item_type": line["item_type"],
        "material_id": line["material_id"],
        "standard_task_id": line["standard_task_id"],
        "description": line["description"],
        "unit": line["unit"],
        "quantity": float(line["quantity"]),
        "unit_price": float(line["unit_price"]),
        "sort_order": line["sort_order"],
    }


# ---------------------------------------------------------------------------
# Tool handlers
# ---------------------------------------------------------------------------
def list_materials_tool(args: dict[str, Any], **_: Any) -> str:
    """Search the materials catalog."""
    try:
        materials = supabase_service.list_materials(
            search=args.get("search"),
            category=args.get("category"),
            is_active=True,
            limit=int(args.get("limit", 25)),
        )
    except (SupabaseServiceError, ValueError, TypeError) as exc:
        return _error(str(exc))

    return _ok(
        {
            "count": len(materials),
            "materials": [
                {
                    "code": material["code"],
                    "name": material["name"],
                    "category": material["category"],
                    "unit": material["unit"],
                    "unit_price": float(material["unit_price"]),
                }
                for material in materials
            ],
            "currency": settings.default_currency,
        }
    )


def get_material_tool(args: dict[str, Any], **_: Any) -> str:
    """Read one material by its catalog code."""
    code = (args.get("code") or "").strip()
    if not code:
        return _error("'code' is required")

    try:
        material = supabase_service.get_material_by_code(code)
    except SupabaseServiceError as exc:
        return _error(str(exc))

    if material is None:
        return _error(f"material code '{code}' does not exist")

    return _ok(
        {
            "code": material["code"],
            "name": material["name"],
            "description": material["description"],
            "category": material["category"],
            "unit": material["unit"],
            "unit_price": float(material["unit_price"]),
            "is_active": material["is_active"],
            "currency": settings.default_currency,
        }
    )


def list_standard_tasks_tool(args: dict[str, Any], **_: Any) -> str:
    """Search the standard tasks catalog."""
    try:
        tasks = supabase_service.list_standard_tasks(
            search=args.get("search"),
            trade=args.get("trade"),
            is_active=True,
            limit=int(args.get("limit", 25)),
        )
    except (SupabaseServiceError, ValueError, TypeError) as exc:
        return _error(str(exc))

    return _ok(
        {
            "count": len(tasks),
            "tasks": [
                {
                    "code": task["code"],
                    "name": task["name"],
                    "trade": task["trade"],
                    "unit": task["unit"],
                    "labor_unit_price": float(task["labor_unit_price"]),
                    "estimated_hours_per_unit": (
                        float(task["estimated_hours_per_unit"])
                        if task.get("estimated_hours_per_unit") is not None
                        else None
                    ),
                }
                for task in tasks
            ],
            "currency": settings.default_currency,
        }
    )


def calculate_estimate_tool(args: dict[str, Any], **_: Any) -> str:
    """Price a list of lines without storing anything."""
    try:
        tax_rate = _to_decimal(args.get("tax_rate", settings.default_tax_rate), "tax_rate")
        if tax_rate < 0 or tax_rate > 100:
            return _error("'tax_rate' must be between 0 and 100")
        lines = _build_estimate_lines(args.get("items"))
    except ValueError as exc:
        return _error(str(exc))
    except SupabaseServiceError as exc:
        return _error(str(exc))

    result = _summarize(lines, tax_rate)
    result["lines"] = [_line_for_output(line) for line in lines]
    return _ok(result)


def list_clients_tool(args: dict[str, Any], **_: Any) -> str:
    """Search clients by name."""
    try:
        clients = supabase_service.list_clients(
            search=args.get("search"),
            limit=int(args.get("limit", 25)),
        )
    except (SupabaseServiceError, ValueError, TypeError) as exc:
        return _error(str(exc))

    return _ok(
        {
            "count": len(clients),
            "clients": [
                {
                    "id": client["id"],
                    "full_name": client["full_name"],
                    "company_name": client.get("company_name"),
                    "email": client.get("email"),
                    "phone": client.get("phone"),
                    "city": client.get("city"),
                }
                for client in clients
            ],
        }
    )


def create_client_tool(args: dict[str, Any], **_: Any) -> str:
    """Create a client."""
    full_name = (args.get("full_name") or "").strip()
    if not full_name:
        return _error("'full_name' is required")

    payload = {"full_name": full_name}
    for field in ("company_name", "tax_id", "email", "phone", "address", "city", "notes"):
        value = args.get(field)
        if value:
            payload[field] = value

    try:
        client = supabase_service.create_client_record(payload)
    except SupabaseServiceError as exc:
        return _error(str(exc))

    return _ok({"id": client["id"], "full_name": client["full_name"], "created": True})


def create_budget_tool(args: dict[str, Any], **_: Any) -> str:
    """Create a budget with its lines and return the stored totals."""
    client_id = (args.get("client_id") or "").strip()
    title = (args.get("title") or "").strip()

    if not client_id:
        return _error("'client_id' is required — use list_clients or create_client first")
    if not title:
        return _error("'title' is required")

    try:
        tax_rate = _to_decimal(args.get("tax_rate", settings.default_tax_rate), "tax_rate")
        if tax_rate < 0 or tax_rate > 100:
            return _error("'tax_rate' must be between 0 and 100")
        lines = _build_estimate_lines(args.get("items"))
    except ValueError as exc:
        return _error(str(exc))
    except SupabaseServiceError as exc:
        return _error(str(exc))

    try:
        if supabase_service.get_client_record(client_id) is None:
            return _error(f"client '{client_id}' does not exist")
    except SupabaseServiceError as exc:
        return _error(str(exc))

    header = {
        "client_id": client_id,
        "title": title,
        "status": "draft",
        "currency": settings.default_currency,
        "tax_rate": float(tax_rate),
    }
    for field in ("description", "site_address", "valid_until"):
        value = args.get(field)
        if value:
            header[field] = value

    try:
        budget = supabase_service.create_budget(header, [_line_for_database(line) for line in lines])
    except SupabaseServiceError as exc:
        return _error(str(exc))

    return _ok(
        {
            "id": budget["id"],
            "budget_number": budget["budget_number"],
            "title": budget["title"],
            "status": budget["status"],
            "currency": budget["currency"],
            "subtotal": float(budget["subtotal"]),
            "tax_rate": float(budget["tax_rate"]),
            "tax_amount": float(budget["tax_amount"]),
            "total": float(budget["total"]),
            "item_count": len(budget.get("items", [])),
            "created": True,
        }
    )


def get_budget_tool(args: dict[str, Any], **_: Any) -> str:
    """Read a stored budget with all of its lines."""
    budget_id = (args.get("budget_id") or "").strip()
    if not budget_id:
        return _error("'budget_id' is required")

    try:
        budget = supabase_service.get_budget(budget_id)
    except SupabaseServiceError as exc:
        return _error(str(exc))

    if budget is None:
        return _error(f"budget '{budget_id}' does not exist")

    return _ok(
        {
            "id": budget["id"],
            "budget_number": budget["budget_number"],
            "client_id": budget["client_id"],
            "title": budget["title"],
            "status": budget["status"],
            "currency": budget["currency"],
            "subtotal": float(budget["subtotal"]),
            "tax_rate": float(budget["tax_rate"]),
            "tax_amount": float(budget["tax_amount"]),
            "total": float(budget["total"]),
            "valid_until": budget.get("valid_until"),
            "items": [
                {
                    "item_type": item["item_type"],
                    "description": item["description"],
                    "unit": item["unit"],
                    "quantity": float(item["quantity"]),
                    "unit_price": float(item["unit_price"]),
                    "line_total": float(item["line_total"]),
                }
                for item in budget.get("items", [])
            ],
        }
    )


# ---------------------------------------------------------------------------
# Tool schemas
# ---------------------------------------------------------------------------
_ESTIMATE_ITEMS_SCHEMA = {
    "type": "array",
    "description": (
        "Budget lines. Each line carries a quantity plus either a material_code, "
        "a task_code, or a free description with unit and unit_price."
    ),
    "minItems": 1,
    "items": {
        "type": "object",
        "properties": {
            "material_code": {
                "type": "string",
                "description": "Catalog code of a material, e.g. 'MAT-CEM-001'",
            },
            "task_code": {
                "type": "string",
                "description": "Catalog code of a standard task, e.g. 'TSK-MAS-001'",
            },
            "description": {
                "type": "string",
                "description": "Line text. Required for free lines, optional otherwise",
            },
            "unit": {"type": "string", "description": "Unit of measure. Required for free lines"},
            "unit_price": {
                "type": "number",
                "minimum": 0,
                "description": "Price per unit. Required for free lines only",
            },
            "quantity": {"type": "number", "exclusiveMinimum": 0},
            "waste_percent": {
                "type": "number",
                "minimum": 0,
                "description": "Extra percentage added to the quantity of a material, e.g. 10 for 10%",
            },
        },
        "required": ["quantity"],
    },
}

TOOL_SCHEMAS: list[dict[str, Any]] = [
    {
        "name": "list_materials",
        "description": (
            "Search the construction materials catalog and return the current unit prices. "
            "Use it before pricing anything, to find the right material codes."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "search": {"type": "string", "description": "Text to look for in the material name"},
                "category": {
                    "type": "string",
                    "description": "Exact category, e.g. 'masonry', 'binders', 'finishes'",
                },
                "limit": {"type": "integer", "minimum": 1, "maximum": 100, "default": 25},
            },
            "required": [],
        },
    },
    {
        "name": "get_material",
        "description": "Read one material from the catalog by its exact code.",
        "parameters": {
            "type": "object",
            "properties": {"code": {"type": "string", "description": "Material code, e.g. 'MAT-BRK-001'"}},
            "required": ["code"],
        },
    },
    {
        "name": "list_standard_tasks",
        "description": (
            "Search the standard labor tasks catalog and return their unit prices. "
            "Use it to price labor alongside materials."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "search": {"type": "string", "description": "Text to look for in the task name"},
                "trade": {"type": "string", "description": "Exact trade, e.g. 'masonry', 'painting'"},
                "limit": {"type": "integer", "minimum": 1, "maximum": 100, "default": 25},
            },
            "required": [],
        },
    },
    {
        "name": "calculate_estimate",
        "description": (
            "Price a list of lines using current catalog prices and return subtotal, tax and total. "
            "Nothing is stored — use it to show the customer a figure before committing to a budget."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "items": _ESTIMATE_ITEMS_SCHEMA,
                "tax_rate": {
                    "type": "number",
                    "minimum": 0,
                    "maximum": 100,
                    "description": "Tax percentage to apply to the subtotal",
                },
            },
            "required": ["items"],
        },
    },
    {
        "name": "list_clients",
        "description": "Search existing clients by name. Use it to find the client_id a budget needs.",
        "parameters": {
            "type": "object",
            "properties": {
                "search": {"type": "string", "description": "Text to look for in the client name"},
                "limit": {"type": "integer", "minimum": 1, "maximum": 100, "default": 25},
            },
            "required": [],
        },
    },
    {
        "name": "create_client",
        "description": "Create a client. Call it only when list_clients finds no match.",
        "parameters": {
            "type": "object",
            "properties": {
                "full_name": {"type": "string", "description": "Client full name"},
                "company_name": {"type": "string"},
                "tax_id": {"type": "string"},
                "email": {"type": "string"},
                "phone": {"type": "string"},
                "address": {"type": "string"},
                "city": {"type": "string"},
                "notes": {"type": "string"},
            },
            "required": ["full_name"],
        },
    },
    {
        "name": "create_budget",
        "description": (
            "Store a budget for a client with all of its lines. The database computes the totals. "
            "The budget is created with status 'draft'."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "client_id": {"type": "string", "description": "Client UUID from list_clients or create_client"},
                "title": {"type": "string", "description": "Short title, e.g. 'Kitchen renovation'"},
                "description": {"type": "string", "description": "Longer description of the work"},
                "site_address": {"type": "string", "description": "Where the work takes place"},
                "items": _ESTIMATE_ITEMS_SCHEMA,
                "tax_rate": {"type": "number", "minimum": 0, "maximum": 100},
                "valid_until": {"type": "string", "description": "Expiry date as YYYY-MM-DD"},
            },
            "required": ["client_id", "title", "items"],
        },
    },
    {
        "name": "get_budget",
        "description": "Read a stored budget with all of its lines and totals.",
        "parameters": {
            "type": "object",
            "properties": {"budget_id": {"type": "string", "description": "Budget UUID"}},
            "required": ["budget_id"],
        },
    },
]

TOOL_HANDLERS: dict[str, Callable[..., str]] = {
    "list_materials": list_materials_tool,
    "get_material": get_material_tool,
    "list_standard_tasks": list_standard_tasks_tool,
    "calculate_estimate": calculate_estimate_tool,
    "list_clients": list_clients_tool,
    "create_client": create_client_tool,
    "create_budget": create_budget_tool,
    "get_budget": get_budget_tool,
}


def dispatch_tool(name: str, arguments: Optional[dict[str, Any]] = None, **kwargs: Any) -> str:
    """Run a tool by name and return its JSON string result."""
    handler = TOOL_HANDLERS.get(name)
    if handler is None:
        return _error(f"unknown tool '{name}'")

    try:
        return handler(arguments or {}, **kwargs)
    except Exception as exc:  # a tool must never raise into the agent loop
        logger.exception("Tool '%s' raised", name)
        return _error(f"tool '{name}' failed: {exc}")
