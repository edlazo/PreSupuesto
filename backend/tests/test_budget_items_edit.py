"""Changing a line after it was added: quantity, price, charged or listed."""

import pytest


@pytest.fixture
def budget(api, catalog):
    budget = api.post("/api/budgets", json={}).json()
    api.post(f"/api/budgets/{budget['id']}/items", json={"standard_task_id": catalog.tasks.wall["id"], "quantity": 10})
    return api.post(
        f"/api/budgets/{budget['id']}/items",
        json={"description": "Refacción de baño", "unit_price": 1_600_000, "quantity": 1},
    ).json()


def patch(api, budget, item_index, **changes):
    item_id = budget["items"][item_index]["id"]
    return api.patch(f"/api/budgets/{budget['id']}/items/{item_id}", json=changes)


def test_changing_the_quantity_updates_line_and_total(api, budget):
    response = patch(api, budget, 0, quantity=12)
    assert response.status_code == 200
    line = response.json()["items"][0]
    assert line["quantity"] == 12
    assert line["line_total"] == 240_000
    assert response.json()["total"] == 1_840_000


def test_the_quantity_is_rounded_to_the_column_precision(api, budget):
    line = patch(api, budget, 0, quantity=2.12345).json()["items"][0]
    assert line["quantity"] == 2.123


@pytest.mark.parametrize("quantity", [0, -1])
def test_a_quantity_must_be_positive(api, budget, quantity):
    assert patch(api, budget, 0, quantity=quantity).status_code == 422


def test_a_quantity_that_rounds_to_zero_is_refused(api, budget):
    assert patch(api, budget, 0, quantity=0.0001).status_code == 422


def test_changing_the_price(api, budget):
    response = patch(api, budget, 1, unit_price=1_750_000)
    assert response.status_code == 200
    assert response.json()["items"][1]["unit_price"] == 1_750_000
    assert response.json()["total"] == 1_950_000


def test_a_negative_price_is_refused(api, budget):
    assert patch(api, budget, 1, unit_price=-1).status_code == 422


def test_moving_a_line_to_the_list_drops_its_price(api, budget):
    response = patch(api, budget, 1, is_quoted=False)
    line = response.json()["items"][1]
    assert line["is_quoted"] is False
    assert line["unit_price"] == 0
    assert response.json()["total"] == 200_000


def test_moving_to_the_list_wins_over_a_price_sent_with_it(api, budget):
    line = patch(api, budget, 1, is_quoted=False, unit_price=5).json()["items"][1]
    assert line["unit_price"] == 0


def test_an_empty_change_reads_the_line_without_writing(api, db, budget):
    before = len(db.log)
    response = patch(api, budget, 0)
    assert response.status_code == 200
    assert ("budget_items", "update") not in db.log[before:]


def test_a_line_of_another_budget_is_not_found(api, budget):
    other = api.post("/api/budgets", json={}).json()
    item_id = budget["items"][0]["id"]
    response = api.patch(f"/api/budgets/{other['id']}/items/{item_id}", json={"quantity": 3})
    assert response.status_code == 404
    assert response.json()["detail"] == "No se encontró el ítem"


def test_an_unknown_line_is_not_found(api, budget):
    assert api.patch(f"/api/budgets/{budget['id']}/items/nope", json={"quantity": 3}).status_code == 404
