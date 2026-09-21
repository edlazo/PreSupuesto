"""Site conditions folded into the prices a budget charges.

A quote written by hand never shows a surcharge: the tradesman thinks "this is
a flat, so instead of 1.600.000 I write 2.240.000". The conditions chosen for a
budget work the same way here — the lines are stored at their base price and
the surcharge is spread across them whenever the budget is shown or printed, so
the lines always add up to the total and the customer sees no percentage.

Nothing in this module touches the database: it takes a budget dictionary and
returns a new one.
"""

from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Optional

CENTS = Decimal("0.01")

# What counts as labour: a work package priced whole, and a catalog task.
LABOR_ITEM_TYPES = frozenset({"custom", "task"})


def _to_decimal(value: Any) -> Decimal:
    """Read a numeric column that may arrive as a string from PostgREST."""
    try:
        return Decimal(str(value))
    except (TypeError, ValueError, ArithmeticError):
        return Decimal("0")


def _money(value: Decimal) -> float:
    return float(value.quantize(CENTS, rounding=ROUND_HALF_UP))


def multipliers(site_factors: Optional[list[dict[str, Any]]]) -> tuple[Decimal, Decimal]:
    """Return what to multiply labour and materials by.

    The percentages add up rather than compound: a flat, nowhere to park and
    imposed hours is +130%, not +194%.
    """
    labor = Decimal("0")
    materials = Decimal("0")

    for factor in site_factors or []:
        percent = _to_decimal(factor.get("percent"))

        if factor.get("applies_to") == "materials":
            materials += percent
        else:
            labor += percent

    hundred = Decimal("100")
    return Decimal("1") + labor / hundred, Decimal("1") + materials / hundred


def apply_site_factors(budget: dict[str, Any]) -> dict[str, Any]:
    """Return the budget as it is charged, with the conditions spread in.

    Lines the customer buys are left alone: they charge nothing to raise.
    """
    factors = budget.get("site_factors") or []

    if not factors:
        return budget

    labor_multiplier, materials_multiplier = multipliers(factors)

    if labor_multiplier == 1 and materials_multiplier == 1:
        return budget

    charged: list[dict[str, Any]] = []

    for item in budget.get("items") or []:
        if item.get("is_quoted", True) is False:
            charged.append(item)
            continue

        multiplier = (
            labor_multiplier
            if item.get("item_type") in LABOR_ITEM_TYPES
            else materials_multiplier
        )

        if multiplier == 1:
            charged.append(item)
            continue

        unit_price = _to_decimal(item.get("unit_price")) * multiplier
        quantity = _to_decimal(item.get("quantity"))
        line = dict(item)
        line["unit_price"] = _money(unit_price)
        # The line total is rebuilt from the rounded unit price, so the column
        # the customer can check by hand is the one that adds up.
        line["line_total"] = _money(Decimal(str(line["unit_price"])) * quantity)
        charged.append(line)

    subtotal = sum(_to_decimal(line.get("line_total")) for line in charged)
    tax_rate = _to_decimal(budget.get("tax_rate"))
    tax_amount = (subtotal * tax_rate / Decimal("100")).quantize(
        CENTS, rounding=ROUND_HALF_UP
    )

    return dict(
        budget,
        items=charged,
        subtotal=_money(subtotal),
        tax_amount=float(tax_amount),
        total=_money(subtotal + tax_amount),
    )
