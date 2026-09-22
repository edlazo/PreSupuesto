"""How long a quote is good for, and moving its prices with inflation."""

import pypdfium2 as pdfium
import pytest


@pytest.fixture
def budget(api, catalog):
    """A bathroom job: a work package, labour by the metre, a listed material."""
    budget = api.post("/api/budgets", json={"title": "Baño"}).json()
    base = f"/api/budgets/{budget['id']}/items"
    api.post(base, json={"description": "Refacción de baño", "unit_price": 1_600_000, "quantity": 1})
    api.post(base, json={"standard_task_id": catalog.tasks.wall["id"], "quantity": 10})
    return api.post(base, json={"description": "Arena", "quantity": 3, "unit": "m3", "is_quoted": False}).json()


def adjust(api, budget, percentage):
    return api.post(f"/api/budgets/{budget['id']}/adjust-prices", json={"percentage": percentage})


# --- valid until ---------------------------------------------------------------------
def test_setting_and_clearing_the_date(api, budget):
    response = api.patch(f"/api/budgets/{budget['id']}", json={"valid_until": "2026-10-07"})
    assert response.status_code == 200
    assert response.json()["valid_until"] == "2026-10-07"

    # Null is how the date comes off; before, an omitted field could not clear it.
    cleared = api.patch(f"/api/budgets/{budget['id']}", json={"valid_until": None})
    assert cleared.status_code == 200
    assert cleared.json()["valid_until"] is None


def test_other_fields_still_ignore_null(api, budget):
    api.patch(f"/api/budgets/{budget['id']}", json={"title": "Baño completo"})
    response = api.patch(f"/api/budgets/{budget['id']}", json={"title": None, "status": None})
    assert response.status_code == 200
    assert response.json()["title"] == "Baño completo"
    assert response.json()["status"] == "draft"


def test_a_date_that_is_not_one_is_refused(api, budget):
    assert api.patch(f"/api/budgets/{budget['id']}", json={"valid_until": "el jueves"}).status_code == 422


def test_the_pdf_states_it(api, budget):
    api.patch(f"/api/budgets/{budget['id']}", json={"valid_until": "2026-10-07"})
    pdf = api.get(f"/api/budgets/{budget['id']}/pdf").content
    text = "\n".join(page.get_textpage().get_text_range() for page in pdfium.PdfDocument(pdf))
    assert "Válido hasta:" in text
    assert "7 oct 2026" in text


# --- moving the prices ------------------------------------------------------------------
def test_raising_every_charged_line(api, budget):
    response = adjust(api, budget, 12)
    assert response.status_code == 200
    package, task, listed = response.json()["items"]
    assert package["unit_price"] == 1_792_000
    assert task["unit_price"] == 22_400
    assert listed["unit_price"] == 0  # the customer buys it
    assert response.json()["total"] == 1_792_000 + 224_000


def test_lowering_them(api, budget):
    assert adjust(api, budget, -10).json()["total"] == 1_440_000 + 180_000


def test_rounding_lands_on_cents(api, db, budget):
    item_id = budget["items"][0]["id"]
    api.patch(f"/api/budgets/{budget['id']}/items/{item_id}", json={"unit_price": 333.33})
    adjust(api, budget, 7.5)
    assert db.find("budget_items", id=item_id)["unit_price"] == 358.33


def test_the_stored_price_is_the_base_one(api, db, budget):
    # Conditions are applied on the way out, so what moves is the base price.
    api.patch(f"/api/budgets/{budget['id']}", json={"site_factors": ["departamento"]})
    charged = adjust(api, budget, 10).json()
    assert db.find("budget_items", description="Refacción de baño")["unit_price"] == 1_760_000
    assert charged["items"][0]["unit_price"] == 2_464_000  # 1.760.000 + 40%


def test_zero_percent_changes_nothing(api, db, budget):
    before = len(db.log)
    assert adjust(api, budget, 0).json()["total"] == 1_800_000
    assert ("budget_items", "update") not in db.log[before:]


def test_a_budget_with_nothing_charged_is_fine(api, catalog):
    budget = api.post("/api/budgets", json={}).json()
    api.post(
        f"/api/budgets/{budget['id']}/items",
        json={"description": "Arena", "quantity": 1, "is_quoted": False},
    )
    assert adjust(api, budget, 20).json()["total"] == 0


@pytest.mark.parametrize("percentage", [-100, -150, 501, "mucho"])
def test_an_impossible_percentage_is_refused(api, budget, percentage):
    assert adjust(api, budget, percentage).status_code == 422


def test_adjusting_an_unknown_budget_is_a_404(api, catalog):
    response = api.post("/api/budgets/nope/adjust-prices", json={"percentage": 10})
    assert response.status_code == 404


def test_adjusting_needs_a_session(anonymous, budget):
    response = anonymous.post(f"/api/budgets/{budget['id']}/adjust-prices", json={"percentage": 10})
    assert response.status_code == 401
