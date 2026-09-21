"""Site conditions: offered, chosen for a budget, and charged inside the prices."""

import pytest


@pytest.fixture
def budget(api, catalog):
    """A bathroom job: one work package, labour by the metre, a listed material."""
    budget = api.post("/api/budgets", json={}).json()
    base = f"/api/budgets/{budget['id']}/items"
    api.post(base, json={"description": "Refacción de baño", "unit_price": 1_600_000, "quantity": 1})
    api.post(base, json={"standard_task_id": catalog.tasks.wall["id"], "quantity": 10})
    return api.post(base, json={"material_id": catalog.materials.sand["id"], "quantity": 3, "is_quoted": False}).json()


def apply(api, budget, *codes):
    return api.patch(f"/api/budgets/{budget['id']}", json={"site_factors": list(codes)})


# --- the list of conditions ------------------------------------------------------
def test_conditions_are_listed_in_order(api, catalog):
    codes = [factor["code"] for factor in api.get("/api/pricing-factors").json()]
    assert codes == [
        "departamento",
        "sin_estacionamiento",
        "horarios_restringidos",
        "compra_materiales_provincia",
        "compra_materiales_capital",
    ]


def test_a_condition_switched_off_is_not_offered(api, catalog):
    factor = catalog.factors["horarios_restringidos"]
    api.patch(f"/api/pricing-factors/{factor['id']}", json={"is_active": False})
    codes = [f["code"] for f in api.get("/api/pricing-factors?only_active=true").json()]
    assert "horarios_restringidos" not in codes
    assert len(api.get("/api/pricing-factors").json()) == 5


def test_tuning_a_percentage(api, catalog):
    factor = catalog.factors["departamento"]
    response = api.patch(f"/api/pricing-factors/{factor['id']}", json={"percent": 45})
    assert response.status_code == 200
    assert response.json()["percent"] == 45


def test_tuning_an_unknown_condition_is_a_404(api, catalog):
    assert api.patch("/api/pricing-factors/nope", json={"percent": 10}).status_code == 404


def test_an_absurd_percentage_is_refused(api, catalog):
    factor = catalog.factors["departamento"]
    assert api.patch(f"/api/pricing-factors/{factor['id']}", json={"percent": 900}).status_code == 422


# --- charged inside the prices ----------------------------------------------------
def test_a_flat_raises_the_labour_and_not_the_list(api, budget):
    charged = apply(api, budget, "departamento").json()
    package, task, listed = charged["items"]
    assert package["unit_price"] == 2_240_000
    assert task["unit_price"] == 28_000
    assert listed["unit_price"] == 0
    assert charged["total"] == 2_240_000 + 280_000


def test_the_base_price_stays_stored(api, db, budget):
    apply(api, budget, "departamento")
    stored = db.find("budget_items", description="Refacción de baño")
    assert stored["unit_price"] == 1_600_000


def test_conditions_add_up(api, budget):
    charged = apply(api, budget, "departamento", "sin_estacionamiento", "horarios_restringidos").json()
    # +40 +40 +50 = +130%: 1.800.000 x 2,3, not x 1,4 x 1,4 x 1,5.
    assert charged["total"] == 4_140_000


def test_unticking_goes_back_to_the_base(api, budget):
    apply(api, budget, "departamento")
    assert apply(api, budget).json()["total"] == 1_800_000


def test_the_material_fee_is_stated_not_charged(api, budget):
    charged = apply(api, budget, "compra_materiales_capital").json()
    assert charged["total"] == 1_800_000
    [factor] = charged["site_factors"]
    assert factor["applies_to"] == "note"
    assert factor["clause"].startswith("Por la compra de materiales")


def test_province_and_capital_are_alternatives(api, budget):
    response = apply(api, budget, "compra_materiales_provincia", "compra_materiales_capital")
    assert response.status_code == 422
    assert "elegí una sola" in response.json()["detail"]


def test_an_unknown_condition_is_refused(api, budget):
    response = apply(api, budget, "departamento", "con_perro")
    assert response.status_code == 404
    assert "con_perro" in response.json()["detail"]


def test_a_quote_keeps_the_percentage_it_was_given(api, catalog, budget):
    apply(api, budget, "departamento")
    api.patch(f"/api/pricing-factors/{catalog.factors['departamento']['id']}", json={"percent": 60})
    assert api.get(f"/api/budgets/{budget['id']}").json()["total"] == 2_520_000


def test_the_history_shows_what_is_charged(api, budget):
    apply(api, budget, "departamento")
    [header] = api.get("/api/budgets").json()
    assert header["total"] == 2_520_000
    assert header["items"] == []


def test_an_edited_price_is_stored_as_base(api, db, budget):
    # The screen divides the typed (charged) price by the surcharge before
    # sending it, so the backend stores exactly what it receives as the base.
    apply(api, budget, "departamento")
    item_id = budget["items"][0]["id"]
    charged = api.patch(f"/api/budgets/{budget['id']}/items/{item_id}", json={"unit_price": 1_607_142.86}).json()
    assert charged["items"][0]["unit_price"] == 2_250_000
    assert db.find("budget_items", id=item_id)["unit_price"] == 1_607_142.86
