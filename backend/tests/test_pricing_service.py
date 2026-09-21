"""Site conditions folded into what a budget charges (no database involved)."""

from decimal import Decimal

from services import pricing_service

FLAT = {"code": "departamento", "percent": 40, "applies_to": "labor"}
PARKING = {"code": "sin_estacionamiento", "percent": 40, "applies_to": "labor"}
HOURS = {"code": "horarios_restringidos", "percent": 50, "applies_to": "labor"}
CAPITAL = {
    "code": "compra_materiales_capital",
    "label": "Compra de materiales (capital)",
    "percent": 20,
    "applies_to": "note",
    "clause": "Por la compra de materiales se cobra un {percent}% del valor de los mismos.",
}


def line(**values):
    base = {"item_type": "custom", "quantity": 1, "unit_price": 1_600_000, "line_total": 1_600_000, "is_quoted": True}
    return dict(base, **values)


def budget(items, factors, tax_rate=0):
    subtotal = sum(float(item["line_total"]) for item in items)
    return {
        "items": items,
        "site_factors": factors,
        "tax_rate": tax_rate,
        "subtotal": subtotal,
        "tax_amount": 0,
        "total": subtotal,
    }


def test_percentages_add_rather_than_compound():
    labor, materials = pricing_service.multipliers([FLAT, PARKING, HOURS])
    assert labor == Decimal("2.3")  # +130%, not 1.4 * 1.4 * 1.5
    assert materials == Decimal("1")


def test_a_materials_factor_raises_only_charged_materials():
    # None is seeded today — materials go on the list — but the base still
    # exists, and it must not leak into the labour.
    on_materials = {"code": "x", "percent": 20, "applies_to": "materials"}
    assert pricing_service.multipliers([on_materials]) == (Decimal("1"), Decimal("1.2"))

    material = line(item_type="material", quantity=2, unit_price=100, line_total=200)
    charged = pricing_service.apply_site_factors(budget([line(), material], [on_materials]))
    assert charged["items"][0]["unit_price"] == 1_600_000
    assert charged["items"][1]["unit_price"] == 120
    assert charged["total"] == 1_600_240


def test_a_note_factor_multiplies_nothing():
    assert pricing_service.multipliers([CAPITAL]) == (Decimal("1"), Decimal("1"))


def test_clause_substitutes_the_percentage():
    assert pricing_service.clauses([FLAT, CAPITAL]) == [
        "Por la compra de materiales se cobra un 20% del valor de los mismos."
    ]
    assert pricing_service.clauses([dict(CAPITAL, percent=12.5)])[0].startswith(
        "Por la compra de materiales se cobra un 12.5%"
    )


def test_clause_without_wording_falls_back_to_the_label():
    assert pricing_service.clauses([dict(CAPITAL, clause=None)]) == [
        "Compra de materiales (capital): 20%"
    ]


def test_a_flat_raises_the_work():
    charged = pricing_service.apply_site_factors(budget([line()], [FLAT]))
    assert charged["items"][0]["unit_price"] == 2_240_000
    assert charged["items"][0]["line_total"] == 2_240_000
    assert charged["total"] == 2_240_000


def test_labour_by_quantity_is_raised_too():
    task = line(item_type="task", quantity=10, unit_price=20_000, line_total=200_000)
    charged = pricing_service.apply_site_factors(budget([task], [FLAT]))
    assert charged["items"][0]["unit_price"] == 28_000
    assert charged["total"] == 280_000


def test_listed_materials_are_left_alone():
    listed = line(item_type="material", unit_price=0, line_total=0, is_quoted=False, quantity=3)
    charged = pricing_service.apply_site_factors(budget([line(), listed], [FLAT, HOURS]))
    assert charged["items"][1] == listed
    assert charged["total"] == 1_600_000 * 1.9


def test_stored_base_is_never_modified():
    original = budget([line()], [FLAT])
    pricing_service.apply_site_factors(original)
    assert original["items"][0]["unit_price"] == 1_600_000
    assert original["total"] == 1_600_000


def test_line_total_is_rebuilt_from_the_rounded_unit_price():
    # 3 x 333,33 raised 40% is 466,662 each: printed 466,66, so the line reads
    # 1.399,98 — what the customer gets multiplying the printed column.
    task = line(item_type="task", quantity=3, unit_price=333.33, line_total=999.99)
    charged = pricing_service.apply_site_factors(budget([task], [FLAT]))
    assert charged["items"][0]["unit_price"] == 466.66
    assert charged["items"][0]["line_total"] == 1399.98
    assert charged["subtotal"] == 1399.98


def test_tax_is_worked_out_on_the_charged_subtotal():
    charged = pricing_service.apply_site_factors(budget([line()], [FLAT], tax_rate=21))
    assert charged["tax_amount"] == 470_400
    assert charged["total"] == 2_710_400


def test_no_conditions_returns_the_budget_untouched():
    original = budget([line()], [])
    assert pricing_service.apply_site_factors(original) is original


def test_no_lines_keeps_the_stored_totals():
    # Regression: summing an empty list returned the integer 0, which crashed
    # the history list, and would have zeroed totals read without their lines.
    headers_only = {"items": [], "site_factors": [FLAT], "subtotal": 500, "tax_rate": 0, "total": 500}
    assert pricing_service.apply_site_factors(headers_only)["total"] == 500


def test_only_listed_lines_charge_nothing():
    listed = line(item_type="material", unit_price=0, line_total=0, is_quoted=False)
    charged = pricing_service.apply_site_factors(budget([listed], [FLAT]))
    assert charged["subtotal"] == 0
    assert charged["total"] == 0


def test_numbers_arriving_as_strings_are_read():
    task = line(item_type="task", quantity="2", unit_price="1000.00", line_total="2000.00")
    charged = pricing_service.apply_site_factors(budget([task], [dict(FLAT, percent="40.00")]))
    assert charged["total"] == 2800
