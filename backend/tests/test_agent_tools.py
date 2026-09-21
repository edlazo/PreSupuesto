"""The assistant's tools: work is priced, materials are only listed."""

import json

import pytest

from tools import budget_tools


def call(name, **args):
    return json.loads(budget_tools.dispatch_tool(name, args))


ITEMS = [
    {"description": "Refacción de baño", "unit_price": 1_600_000, "quantity": 1,
     "detail": "Picar paredes\nColocar cerámica", "note": "Sin materiales"},
    {"task_code": "TSK-ALB-001", "quantity": 10},
    {"material_code": "MAT-ARI-001", "quantity": 3},
    {"material": "Plasticor", "quantity": 10, "unit": "bolsa"},
    {"material": "Madera"},
]


def test_the_estimate_charges_only_work_and_labour(catalog):
    estimate = call("calculate_estimate", items=ITEMS, tax_rate=0)
    assert "error" not in estimate
    assert estimate["total"] == 1_600_000 + 200_000

    listed = [line for line in estimate["lines"] if line.get("listed_only")]
    assert [line["description"] for line in listed] == ["Arena fina", "Plasticor", "Madera"]
    assert all("unit_price" not in line and "line_total" not in line for line in listed)


def test_listed_materials_keep_the_quantity_and_unit_given(catalog):
    estimate = call("calculate_estimate", items=ITEMS)
    sand, plasticor, wood = (line for line in estimate["lines"] if line.get("listed_only"))
    assert (sand["quantity"], sand["unit"]) == (3, "m3")
    assert (plasticor["quantity"], plasticor["unit"]) == (10, "bolsa")
    assert (wood["quantity"], wood["unit"]) == (1, "")


def test_a_work_package_is_quoted_whole(catalog):
    [package] = call("calculate_estimate", items=ITEMS[:1])["lines"]
    assert package["unit"] == "global"


def test_the_stored_budget_is_one_the_database_accepts(api, db, catalog):
    client = call("create_client", full_name="Ana Torres")
    created = call("create_budget", client_id=client["id"], title="Baño", items=ITEMS)
    assert created.get("created") is True, created
    assert created["total"] == 1_800_000

    rows = {row["description"]: row for row in db.all("budget_items")}
    # On the catalog it points at the material; off it, it is a free line —
    # the database only takes a 'material' line that has a material_id.
    assert rows["Arena fina"]["item_type"] == "material"
    assert rows["Arena fina"]["material_id"] == catalog.materials.sand["id"]
    assert rows["Plasticor"]["item_type"] == "custom"
    assert rows["Madera"]["item_type"] == "custom"
    for name in ("Arena fina", "Plasticor", "Madera"):
        assert rows[name]["is_quoted"] is False
        assert rows[name]["unit_price"] == 0
    assert rows["Refacción de baño"]["detail"].startswith("Picar")
    assert rows["Refacción de baño"]["note"] == "Sin materiales"

    # And the web app reads it back the same way.
    budget = api.get(f"/api/budgets/{created['id']}").json()
    assert budget["total"] == 1_800_000


def test_reading_a_budget_marks_the_listed_lines(catalog):
    client = call("create_client", full_name="Ana Torres")
    created = call("create_budget", client_id=client["id"], title="Baño", items=ITEMS)
    lines = call("get_budget", budget_id=created["id"])["items"]
    assert [line["listed_only"] for line in lines] == [False, False, True, True, True]


def test_the_catalog_tools_hand_out_no_prices(catalog):
    listing = call("list_materials", search="arena")
    assert listing["materials"][0]["name"] == "Arena fina"
    assert "unit_price" not in listing["materials"][0]
    assert "unit_price" not in call("get_material", code="MAT-ARI-001")


@pytest.mark.parametrize(
    "item",
    [
        {"task_code": "TSK-ALB-001"},  # labour needs a quantity
        {"material": "Arena", "task_code": "TSK-ALB-001", "quantity": 1},
        {"description": "Algo", "quantity": 1},  # a package needs a price
        {"material_code": "NOPE"},
        {"task_code": "NOPE", "quantity": 1},
        {"material": "Arena", "quantity": 0},
    ],
)
def test_malformed_lines_are_reported_not_raised(catalog, item):
    assert "error" in call("calculate_estimate", items=[item])


def test_a_budget_needs_a_client_that_exists(catalog):
    assert "error" in call("create_budget", client_id="nope", title="Baño", items=ITEMS)


def test_the_schema_offers_materials_and_no_waste():
    schema = next(tool for tool in budget_tools.TOOL_SCHEMAS if tool["name"] == "calculate_estimate")
    properties = schema["parameters"]["properties"]["items"]["items"]["properties"]
    assert "material" in properties
    assert "waste_percent" not in properties


def test_an_unknown_tool_is_an_error():
    assert "error" in json.loads(budget_tools.dispatch_tool("borrar_todo", {}))
