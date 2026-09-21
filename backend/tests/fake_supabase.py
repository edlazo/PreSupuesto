"""An in-memory stand-in for the Supabase client.

It answers the PostgREST query builder calls `supabase_service` makes —
`table().select().eq()...execute()` — so the tests run the real access layer
without a network or a database.

What the database does on its own is reproduced here too, because the code
relies on it: generated columns (`line_total`, `tax_amount`, `total`), the
trigger that keeps a budget's subtotal in step with its lines, defaults, and
the constraints that reject bad rows (unique codes, foreign keys, the rule
tying a line's type to what it points at). A test that writes a row the real
schema would refuse fails here as well.
"""

from __future__ import annotations

import copy
import re
import uuid
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Callable, Optional

CENTS = Decimal("0.01")

UNIQUE_VIOLATION = "23505"
FOREIGN_KEY_VIOLATION = "23503"
CHECK_VIOLATION = "23514"
NOT_NULL_VIOLATION = "23502"

TABLES = (
    "materials",
    "standard_tasks",
    "clients",
    "budgets",
    "budget_items",
    "pricing_factors",
)

# Columns every row of a table gets when the insert leaves them out.
DEFAULTS: dict[str, dict[str, Any]] = {
    "materials": {"description": None, "is_active": True},
    "standard_tasks": {
        "description": None,
        "estimated_hours_per_unit": None,
        "is_active": True,
    },
    "clients": {
        "company_name": None,
        "tax_id": None,
        "email": None,
        "phone": None,
        "address": None,
        "city": None,
        "notes": None,
    },
    "budgets": {
        "description": None,
        "site_address": None,
        "status": "draft",
        "currency": "ARS",
        "tax_rate": 0.0,
        "subtotal": 0.0,
        "valid_until": None,
        "site_factors": [],
    },
    "budget_items": {
        "material_id": None,
        "standard_task_id": None,
        "detail": None,
        "note": None,
        "is_quoted": True,
        "sort_order": 0,
    },
    "pricing_factors": {
        "description": None,
        "clause": None,
        "exclusive_group": None,
        "is_active": True,
        "sort_order": 0,
    },
}

# Columns the database computes: writing them is an error, as in Postgres.
GENERATED = {
    "budgets": {"budget_number", "tax_amount", "total"},
    "budget_items": {"line_total"},
}

UNIQUE = {
    "materials": ("code",),
    "standard_tasks": ("code",),
    "pricing_factors": ("code",),
}

# (table, column) -> (referenced table, what happens when the parent goes).
FOREIGN_KEYS = {
    ("budgets", "client_id"): ("clients", "restrict"),
    ("budget_items", "budget_id"): ("budgets", "cascade"),
    ("budget_items", "material_id"): ("materials", "restrict"),
    ("budget_items", "standard_task_id"): ("standard_tasks", "restrict"),
}

BUDGET_STATUSES = {"draft", "sent", "accepted", "rejected", "expired"}
FACTOR_BASES = {"labor", "materials", "note"}


class FakeAPIError(Exception):
    """Mirrors postgrest's APIError: a message plus the Postgres error code."""

    def __init__(self, message: str, code: str) -> None:
        super().__init__(message)
        self.message = message
        self.code = code


class FakeResponse:
    def __init__(self, data: list[dict[str, Any]], count: Optional[int] = None) -> None:
        self.data = data
        self.count = count


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _money(value: Decimal) -> float:
    return float(value.quantize(CENTS, rounding=ROUND_HALF_UP))


def _like_to_regex(pattern: str) -> re.Pattern[str]:
    parts = (re.escape(part) for part in pattern.split("%"))
    return re.compile("^" + ".*".join(parts) + "$", re.DOTALL)


class FakeDatabase:
    """The whole database: one list of rows per table."""

    def __init__(self) -> None:
        self.rows: dict[str, list[dict[str, Any]]] = {name: [] for name in TABLES}
        self._next_budget_number = 1
        # Every query that ran, as (table, operation) — handy for asserting
        # that something was *not* written.
        self.log: list[tuple[str, str]] = []

    # -- the client surface -------------------------------------------------
    def table(self, name: str) -> "FakeQuery":
        if name not in self.rows:
            raise FakeAPIError(f'relation "public.{name}" does not exist', "42P01")
        return FakeQuery(self, name)

    # -- helpers for tests ---------------------------------------------------
    def seed(self, table: str, **values: Any) -> dict[str, Any]:
        """Insert one row directly and return it, as the database stores it."""
        return copy.deepcopy(self._insert(table, [values])[0])

    def all(self, table: str) -> list[dict[str, Any]]:
        return copy.deepcopy(self.rows[table])

    def find(self, table: str, **match: Any) -> Optional[dict[str, Any]]:
        for row in self.rows[table]:
            if all(row.get(key) == value for key, value in match.items()):
                return copy.deepcopy(row)
        return None

    # -- writes --------------------------------------------------------------
    def _insert(self, table: str, payloads: list[dict[str, Any]]) -> list[dict[str, Any]]:
        stored = []
        for payload in payloads:
            generated = GENERATED.get(table, set()) & set(payload)
            if generated:
                raise FakeAPIError(
                    f'cannot insert a non-DEFAULT value into column "{sorted(generated)[0]}"',
                    "428C9",
                )

            row = dict(copy.deepcopy(DEFAULTS.get(table, {})))
            row.update(copy.deepcopy(payload))
            row.setdefault("id", str(uuid.uuid4()))
            now = _now()
            row.setdefault("created_at", now)
            row.setdefault("updated_at", now)

            if table == "budgets":
                row["budget_number"] = self._next_budget_number

            self._check(table, row, ignore_id=None)
            if table == "budgets":
                self._next_budget_number += 1

            self.rows[table].append(row)
            self._compute(table, row)
            stored.append(row)

        if table == "budget_items":
            self._refresh_subtotals({row["budget_id"] for row in stored})
        return stored

    def _update(self, table: str, matched: list[dict[str, Any]], payload: dict[str, Any]) -> list[dict[str, Any]]:
        generated = GENERATED.get(table, set()) & set(payload)
        if generated:
            raise FakeAPIError(
                f'column "{sorted(generated)[0]}" can only be updated to DEFAULT', "428C9"
            )

        touched_budgets = set()
        for row in matched:
            candidate = dict(row)
            candidate.update(copy.deepcopy(payload))
            self._check(table, candidate, ignore_id=row["id"])
            if table == "budget_items":
                touched_budgets.update({row["budget_id"], candidate["budget_id"]})
            row.update(copy.deepcopy(payload))
            row["updated_at"] = _now()
            self._compute(table, row)

        if touched_budgets:
            self._refresh_subtotals(touched_budgets)
        return matched

    def _delete(self, table: str, matched: list[dict[str, Any]]) -> list[dict[str, Any]]:
        ids = {row["id"] for row in matched}

        for (child, column), (parent, action) in FOREIGN_KEYS.items():
            if parent != table:
                continue
            children = [row for row in self.rows[child] if row.get(column) in ids]
            if not children:
                continue
            if action == "restrict":
                raise FakeAPIError(
                    f'update or delete on table "{table}" violates foreign key constraint on "{child}"',
                    FOREIGN_KEY_VIOLATION,
                )
            self._delete(child, children)

        self.rows[table] = [row for row in self.rows[table] if row["id"] not in ids]

        if table == "budget_items":
            self._refresh_subtotals({row["budget_id"] for row in matched})
        return matched

    # -- what the schema does by itself -------------------------------------
    def _compute(self, table: str, row: dict[str, Any]) -> None:
        if table == "budget_items":
            quantity = Decimal(str(row["quantity"]))
            price = Decimal(str(row["unit_price"]))
            row["line_total"] = _money(quantity * price) if row["is_quoted"] else 0.0
        elif table == "budgets":
            subtotal = Decimal(str(row["subtotal"]))
            tax = (subtotal * Decimal(str(row["tax_rate"])) / Decimal("100")).quantize(
                CENTS, rounding=ROUND_HALF_UP
            )
            row["tax_amount"] = float(tax)
            row["total"] = float(subtotal + tax)

    def _refresh_subtotals(self, budget_ids: set[str]) -> None:
        """The `refresh_budget_subtotal` trigger."""
        for budget in self.rows["budgets"]:
            if budget["id"] not in budget_ids:
                continue
            lines = [row for row in self.rows["budget_items"] if row["budget_id"] == budget["id"]]
            budget["subtotal"] = _money(
                sum((Decimal(str(row["line_total"])) for row in lines), Decimal("0"))
            )
            self._compute("budgets", budget)

    def _check(self, table: str, row: dict[str, Any], *, ignore_id: Optional[str]) -> None:
        for column in UNIQUE.get(table, ()):
            for other in self.rows[table]:
                if other["id"] != ignore_id and other.get(column) == row.get(column):
                    raise FakeAPIError(
                        f'duplicate key value violates unique constraint "{table}_{column}_key"',
                        UNIQUE_VIOLATION,
                    )

        for (child, column), (parent, _) in FOREIGN_KEYS.items():
            if child != table or row.get(column) is None:
                continue
            if not any(parent_row["id"] == row[column] for parent_row in self.rows[parent]):
                raise FakeAPIError(
                    f'insert or update on table "{table}" violates foreign key constraint "{table}_{column}_fkey"',
                    FOREIGN_KEY_VIOLATION,
                )

        if table == "budgets":
            if row.get("client_id") is None:
                raise FakeAPIError('null value in column "client_id"', NOT_NULL_VIOLATION)
            if row["status"] not in BUDGET_STATUSES:
                raise FakeAPIError("budgets_status_check", CHECK_VIOLATION)
            if not 0 <= float(row["tax_rate"]) <= 100:
                raise FakeAPIError("budgets_tax_rate_check", CHECK_VIOLATION)

        if table == "budget_items":
            if float(row["quantity"]) <= 0:
                raise FakeAPIError("budget_items_quantity_check", CHECK_VIOLATION)
            if float(row["unit_price"]) < 0:
                raise FakeAPIError("budget_items_unit_price_check", CHECK_VIOLATION)
            kind = row.get("item_type")
            material, task = row.get("material_id"), row.get("standard_task_id")
            matches = (
                (kind == "material" and material is not None and task is None)
                or (kind == "task" and task is not None and material is None)
                or (kind == "custom" and material is None and task is None)
            )
            if not matches:
                raise FakeAPIError(
                    'new row for relation "budget_items" violates check constraint '
                    '"budget_items_reference_matches_type"',
                    CHECK_VIOLATION,
                )

        if table == "materials" and float(row["unit_price"]) < 0:
            raise FakeAPIError("materials_unit_price_check", CHECK_VIOLATION)

        if table == "pricing_factors":
            if row.get("applies_to") not in FACTOR_BASES:
                raise FakeAPIError("pricing_factors_applies_to_check", CHECK_VIOLATION)
            if not -100 <= float(row["percent"]) <= 500:
                raise FakeAPIError("pricing_factors_percent_check", CHECK_VIOLATION)


class FakeQuery:
    """One PostgREST request being built, run by `execute()`."""

    def __init__(self, db: FakeDatabase, table: str) -> None:
        self._db = db
        self._table = table
        self._operation = "select"
        self._payload: Any = None
        self._columns = "*"
        self._count: Optional[str] = None
        self._filters: list[Callable[[dict[str, Any]], bool]] = []
        self._orders: list[tuple[str, bool]] = []
        self._limit: Optional[int] = None
        self._range: Optional[tuple[int, int]] = None

    # -- operations ----------------------------------------------------------
    def select(self, columns: str = "*", *, count: Optional[str] = None) -> "FakeQuery":
        self._columns = columns
        self._count = count
        return self

    def insert(self, payload: Any) -> "FakeQuery":
        self._operation, self._payload = "insert", payload
        return self

    def update(self, payload: dict[str, Any]) -> "FakeQuery":
        self._operation, self._payload = "update", payload
        return self

    def delete(self) -> "FakeQuery":
        self._operation = "delete"
        return self

    # -- filters -------------------------------------------------------------
    def eq(self, column: str, value: Any) -> "FakeQuery":
        self._filters.append(lambda row: row.get(column) == value)
        return self

    def in_(self, column: str, values: list[Any]) -> "FakeQuery":
        allowed = list(values)
        self._filters.append(lambda row: row.get(column) in allowed)
        return self

    def like(self, column: str, pattern: str) -> "FakeQuery":
        regex = _like_to_regex(pattern)
        self._filters.append(lambda row: bool(regex.match(str(row.get(column) or ""))))
        return self

    def ilike(self, column: str, pattern: str) -> "FakeQuery":
        regex = _like_to_regex(pattern.lower())
        self._filters.append(lambda row: bool(regex.match(str(row.get(column) or "").lower())))
        return self

    # -- shaping -------------------------------------------------------------
    def order(self, column: str, *, desc: bool = False) -> "FakeQuery":
        self._orders.append((column, desc))
        return self

    def limit(self, count: int) -> "FakeQuery":
        self._limit = count
        return self

    def range(self, start: int, end: int) -> "FakeQuery":
        self._range = (start, end)
        return self

    # -- run -----------------------------------------------------------------
    def _matched(self) -> list[dict[str, Any]]:
        return [row for row in self._db.rows[self._table] if all(f(row) for f in self._filters)]

    def execute(self) -> FakeResponse:
        self._db.log.append((self._table, self._operation))

        if self._operation == "insert":
            payloads = self._payload if isinstance(self._payload, list) else [self._payload]
            return FakeResponse(copy.deepcopy(self._db._insert(self._table, payloads)))

        if self._operation == "update":
            rows = self._db._update(self._table, self._matched(), self._payload)
            return FakeResponse(copy.deepcopy(rows))

        if self._operation == "delete":
            rows = self._db._delete(self._table, self._matched())
            return FakeResponse(copy.deepcopy(rows))

        rows = self._matched()
        # Later .order() calls break ties of earlier ones, so sort last-first.
        for column, desc in reversed(self._orders):
            rows = sorted(
                rows,
                key=lambda row: (row.get(column) is None, row.get(column)),
                reverse=desc,
            )
        count = len(rows) if self._count else None

        if self._range is not None:
            start, end = self._range
            rows = rows[start : end + 1]
        if self._limit is not None:
            rows = rows[: self._limit]

        if self._columns.strip() != "*":
            wanted = [column.strip() for column in self._columns.split(",")]
            rows = [{column: row.get(column) for column in wanted} for row in rows]

        return FakeResponse(copy.deepcopy(rows), count)
