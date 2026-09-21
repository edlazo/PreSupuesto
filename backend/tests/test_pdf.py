"""The PDF the customer receives."""

import pypdfium2 as pdfium
import pytest

from services import pdf_service


def text_of(pdf_bytes: bytes) -> str:
    document = pdfium.PdfDocument(pdf_bytes)
    return "\n".join(page.get_textpage().get_text_range() for page in document)


@pytest.fixture
def budget(api, catalog):
    """The way it is written by hand: a package, labour, and a list of materials."""
    client = api.post("/api/clients", json={"full_name": "Ana Torres", "city": "CABA"}).json()
    budget = api.post("/api/budgets", json={"client_id": client["id"], "title": "Refacción de baño"}).json()
    base = f"/api/budgets/{budget['id']}/items"
    api.post(base, json={
        "description": "Refacción de baño completa",
        "detail": "Picar paredes\nColocar cerámica",
        "note": "Precio con materiales a cargo del cliente",
        "unit_price": 1_600_000,
        "quantity": 1,
    })
    api.post(base, json={"standard_task_id": catalog.tasks.wall["id"], "quantity": 10})
    api.post(base, json={"material_id": catalog.materials.sand["id"], "quantity": 3, "is_quoted": False})
    return api.post(base, json={"description": "Madera", "quantity": 1, "is_quoted": False}).json()


def pdf(api, budget, query=""):
    response = api.get(f"/api/budgets/{budget['id']}/pdf{query}")
    assert response.status_code == 200, response.text
    assert response.content[:5] == b"%PDF-"
    return response


def test_it_downloads_with_a_readable_name(api, budget):
    disposition = pdf(api, budget).headers["Content-Disposition"]
    assert disposition == f'attachment; filename="presupuesto-{budget["budget_number"]:04d}-refaccion-de-bano.pdf"'


def test_a_package_reads_as_title_bullets_and_remark(api, budget):
    text = text_of(pdf(api, budget).content)
    assert "Refacción de baño completa" in text
    assert "• Picar paredes" in text and "• Colocar cerámica" in text
    assert "Precio con materiales a cargo del cliente" in text
    assert "$ 1.600.000,00" in text


def test_materials_are_listed_below_without_prices(api, budget):
    text = text_of(pdf(api, budget).content)
    listed = text[text.index("MATERIALES A CARGO DEL CLIENTE"):]
    assert "Arena fina" in listed and "Madera" in listed
    assert "$" not in listed.split("Madera")[0].split("Arena fina")[1]


def test_no_tax_row_when_there_is_no_tax(api, budget):
    text = text_of(pdf(api, budget).content)
    assert "IVA" not in text
    assert "$ 1.800.000,00" in text


def test_the_tax_row_appears_when_there_is_tax(api, db, budget):
    db.table("budgets").update({"tax_rate": 21}).eq("id", budget["id"]).execute()
    text = text_of(pdf(api, budget).content)
    assert "IVA (21" in text
    assert "$ 2.178.000,00" in text


def test_conditions_are_printed_inside_the_prices(api, budget):
    api.patch(f"/api/budgets/{budget['id']}", json={"site_factors": ["departamento", "compra_materiales_capital"]})
    text = text_of(pdf(api, budget).content)
    assert "$ 2.240.000,00" in text
    assert "40%" not in text  # the customer never reads the surcharge
    assert "Por la compra de materiales se cobra un 20% del valor de los mismos." in text


def test_the_client_is_named(api, budget):
    assert "Ana Torres" in text_of(pdf(api, budget).content)


def test_an_unknown_budget_is_a_404(api, catalog):
    assert api.get("/api/budgets/nope/pdf").status_code == 404


# --- in dollars -------------------------------------------------------------------
def test_printing_in_dollars_states_the_rate(api, budget):
    text = text_of(pdf(api, budget, "?currency=USD&rate=1555").content)
    assert "Cotización aplicada" in text and "1.555,00" in text
    assert "u$s" in text


def test_a_zero_rate_is_refused(api, budget):
    assert api.get(f"/api/budgets/{budget['id']}/pdf?currency=USD&rate=0").status_code == 422


def test_conversion_rebuilds_the_totals_from_the_lines():
    budget = {
        "id": "b",
        "tax_rate": 21,
        "items": [
            {"unit_price": 1000, "line_total": 3000},
            {"unit_price": 777, "line_total": 777},
        ],
    }
    converted = pdf_service.convert_budget(budget, currency="USD", exchange_rate=1555)
    assert converted["currency"] == "USD"
    assert [item["line_total"] for item in converted["items"]] == [1.93, 0.5]
    assert converted["subtotal"] == 2.43
    assert converted["tax_amount"] == 0.51
    assert converted["total"] == 2.94


def test_conversion_needs_a_positive_rate():
    with pytest.raises(pdf_service.PdfServiceError):
        pdf_service.convert_budget({"id": "b", "items": []}, currency="USD", exchange_rate=0)


@pytest.mark.parametrize(
    "amount, text",
    [(2599.44, "$ 2.599,44"), (0, "$ 0,00"), (1_600_000, "$ 1.600.000,00")],
)
def test_money_is_written_the_argentine_way(amount, text):
    assert pdf_service.format_money(amount, "ARS") == text


@pytest.mark.parametrize("value, text", [(11, "11"), (2.5, "2,5"), (1000, "1.000"), (0.125, "0,125")])
def test_quantities_drop_trailing_zeros(value, text):
    assert pdf_service.format_quantity(value) == text
