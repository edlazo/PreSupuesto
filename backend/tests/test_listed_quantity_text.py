"""A listed material's quantity written as said: "1/2", "2 o 3", "a definir"."""

import json

import pypdfium2 as pdfium
import pytest

from tools import budget_tools


@pytest.fixture
def budget(api, catalog):
    return api.post("/api/budgets", json={}).json()


def add(api, budget, **line):
    response = api.post(f"/api/budgets/{budget['id']}/items", json=line)
    assert response.status_code == 201, response.text
    return response.json()


def test_a_listed_line_keeps_the_quantity_as_written(api, budget):
    [line] = add(api, budget, description="Cemento", quantity=1, quantity_text=" 1/2 ", unit="bolsa", is_quoted=False)["items"]
    assert line["quantity_text"] == "1/2"
    assert line["unit"] == "bolsa"
    assert line["line_total"] == 0


def test_a_catalog_material_takes_it_too(api, catalog, budget):
    [line] = add(
        api, budget, material_id=catalog.materials.sand["id"], quantity=1, quantity_text="2 o 3", is_quoted=False
    )["items"]
    assert line["quantity_text"] == "2 o 3"
    assert line["unit"] == "m3"


def test_blank_written_quantity_is_nothing(api, budget):
    [line] = add(api, budget, description="Madera", quantity=1, quantity_text="   ", is_quoted=False)["items"]
    assert line["quantity_text"] is None


def test_a_charged_line_ignores_it(api, budget):
    # A charged line multiplies its numeric quantity; a written one would lie.
    [line] = add(api, budget, description="Pintura", unit_price=100, quantity=2, quantity_text="½")["items"]
    assert line["quantity_text"] is None
    assert line["line_total"] == 200


def test_it_is_capped_in_length(api, budget):
    response = api.post(
        f"/api/budgets/{budget['id']}/items",
        json={"description": "Arena", "quantity": 1, "quantity_text": "x" * 41, "is_quoted": False},
    )
    assert response.status_code == 422


def test_editing_and_clearing_it(api, budget):
    budget = add(api, budget, description="Arena", quantity=3, unit="m3", is_quoted=False)
    url = f"/api/budgets/{budget['id']}/items/{budget['items'][0]['id']}"

    line = api.patch(url, json={"quantity_text": "½ a 1"}).json()["items"][0]
    assert line["quantity_text"] == "½ a 1"

    line = api.patch(url, json={"quantity_text": ""}).json()["items"][0]
    assert line["quantity_text"] is None
    assert line["quantity"] == 3


def test_the_pdf_prints_it_as_written(api, budget):
    add(api, budget, description="Refacción", unit_price=1000, quantity=1)
    add(api, budget, description="Cemento", quantity=1, quantity_text="1/2", unit="bolsa", is_quoted=False)
    add(api, budget, description="Arena", quantity=3, unit="m3", is_quoted=False)
    pdf = api.get(f"/api/budgets/{budget['id']}/pdf").content
    text = "\n".join(page.get_textpage().get_text_range() for page in pdfium.PdfDocument(pdf))
    listed = text[text.index("MATERIALES A CARGO DEL CLIENTE"):]
    assert "1/2" in listed
    assert "3" in listed.split("Arena")[1]


def test_the_assistant_can_write_it(api, db, catalog):
    client = json.loads(budget_tools.dispatch_tool("create_client", {"full_name": "Ana"}))
    created = json.loads(
        budget_tools.dispatch_tool(
            "create_budget",
            {
                "client_id": client["id"],
                "title": "Baño",
                "items": [
                    {"description": "Refacción", "unit_price": 1000, "quantity": 1},
                    {"material": "Cemento", "quantity_text": "1/2", "unit": "bolsa"},
                    {"material_code": "MAT-ARI-001", "quantity_text": "2 o 3"},
                ],
            },
        )
    )
    assert created.get("created") is True, created
    cement = db.find("budget_items", description="Cemento")
    assert (cement["quantity_text"], cement["unit"], cement["quantity"]) == ("1/2", "bolsa", 1)
    assert db.find("budget_items", description="Arena fina")["unit"] == "m3"

    estimate = json.loads(
        budget_tools.dispatch_tool("calculate_estimate", {"items": [{"material": "Cemento", "quantity_text": "1/2"}]})
    )
    assert estimate["lines"][0]["quantity"] == "1/2"
