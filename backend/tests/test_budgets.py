"""Building a budget by hand: starting it, adding lines, removing them."""

from services import supabase_service


def new_budget(api, **body):
    response = api.post("/api/budgets", json=body)
    assert response.status_code == 201, response.text
    return response.json()


def add(api, budget_id, **line):
    response = api.post(f"/api/budgets/{budget_id}/items", json=line)
    assert response.status_code == 201, response.text
    return response.json()


# --- starting a budget -------------------------------------------------------
def test_a_budget_starts_empty_with_no_tax(api, catalog):
    budget = new_budget(api)
    assert budget["items"] == []
    assert budget["tax_rate"] == 0
    assert budget["total"] == 0
    assert budget["status"] == "draft"
    assert budget["currency"] == "ARS"


def test_without_a_client_the_stand_in_is_used_and_reused(api, db, catalog):
    first = new_budget(api)
    second = new_budget(api)
    stand_ins = [c for c in db.all("clients") if c["full_name"] == supabase_service.DEFAULT_CLIENT_NAME]
    assert len(stand_ins) == 1
    assert first["client_id"] == second["client_id"] == stand_ins[0]["id"]


def test_budget_numbers_go_up(api, catalog):
    assert new_budget(api)["budget_number"] + 1 == new_budget(api)["budget_number"]


def test_an_unknown_client_is_refused(api, catalog):
    response = api.post("/api/budgets", json={"client_id": "nope"})
    assert response.status_code == 404
    assert response.json()["detail"] == "No se encontró el cliente"


# --- work packages -------------------------------------------------------------
def test_a_work_package_is_one_round_price(api, catalog):
    budget = new_budget(api)
    budget = add(
        api,
        budget["id"],
        description="Refacción de baño",
        detail="Picar paredes\nColocar cerámica",
        note="Sin materiales",
        unit_price=1_600_000,
        quantity=1,
    )
    [line] = budget["items"]
    assert line["item_type"] == "custom"
    assert line["unit"] == "global"
    assert line["detail"] == "Picar paredes\nColocar cerámica"
    assert line["note"] == "Sin materiales"
    assert line["is_quoted"] is True
    assert budget["total"] == 1_600_000


def test_blank_detail_and_note_are_stored_as_nothing(api, catalog):
    budget = new_budget(api)
    [line] = add(api, budget["id"], description="Pintura", detail="  ", note="", unit_price=10, quantity=1)["items"]
    assert line["detail"] is None and line["note"] is None


def test_a_work_package_needs_a_price(api, catalog):
    budget = new_budget(api)
    response = api.post(f"/api/budgets/{budget['id']}/items", json={"description": "Algo", "quantity": 1})
    assert response.status_code == 422


def test_a_line_needs_a_description_or_a_catalog_entry(api, catalog):
    budget = new_budget(api)
    response = api.post(f"/api/budgets/{budget['id']}/items", json={"unit_price": 10, "quantity": 1})
    assert response.status_code == 422


# --- labour from the catalog ---------------------------------------------------------
def test_labour_copies_the_catalog_price(api, catalog):
    budget = new_budget(api)
    budget = add(api, budget["id"], standard_task_id=catalog.tasks.wall["id"], quantity=12.5)
    [line] = budget["items"]
    assert line["item_type"] == "task"
    assert line["description"] == "Levantar muro"
    assert line["unit"] == "m2"
    assert line["unit_price"] == 20_000
    assert budget["total"] == 250_000


def test_a_later_catalog_change_leaves_the_budget_alone(api, db, catalog):
    budget = new_budget(api)
    add(api, budget["id"], standard_task_id=catalog.tasks.wall["id"], quantity=1)
    db.table("standard_tasks").update({"labor_unit_price": 99_999}).eq("id", catalog.tasks.wall["id"]).execute()
    assert api.get(f"/api/budgets/{budget['id']}").json()["total"] == 20_000


def test_an_unknown_task_is_refused(api, catalog):
    budget = new_budget(api)
    response = api.post(f"/api/budgets/{budget['id']}/items", json={"standard_task_id": "nope", "quantity": 1})
    assert response.status_code == 404


def test_a_line_cannot_be_material_and_labour(api, catalog):
    budget = new_budget(api)
    response = api.post(
        f"/api/budgets/{budget['id']}/items",
        json={"material_id": catalog.materials.sand["id"], "standard_task_id": catalog.tasks.wall["id"], "quantity": 1},
    )
    assert response.status_code == 422


# --- the materials list ----------------------------------------------------------------
def test_a_catalog_material_is_listed_without_price(api, catalog):
    budget = new_budget(api)
    add(api, budget["id"], description="Refacción", unit_price=500_000, quantity=1)
    budget = add(api, budget["id"], material_id=catalog.materials.sand["id"], quantity=3, is_quoted=False)
    listed = budget["items"][1]
    assert listed["item_type"] == "material"
    assert listed["unit"] == "m3"
    assert listed["unit_price"] == 0
    assert listed["line_total"] == 0
    assert listed["is_quoted"] is False
    assert budget["total"] == 500_000


def test_a_material_off_the_catalog_is_just_a_name(api, catalog):
    budget = new_budget(api)
    budget = add(api, budget["id"], description="Madera", quantity=1, is_quoted=False)
    [listed] = budget["items"]
    assert listed["item_type"] == "custom"
    assert listed["unit"] == ""
    assert listed["unit_price"] == 0
    assert budget["total"] == 0


def test_a_listed_line_ignores_a_price_sent_with_it(api, catalog):
    budget = new_budget(api)
    budget = add(api, budget["id"], description="Arena", quantity=2, unit="m3", unit_price=45_000, is_quoted=False)
    assert budget["items"][0]["unit_price"] == 0
    assert budget["total"] == 0


def test_an_unknown_material_is_refused(api, catalog):
    budget = new_budget(api)
    response = api.post(f"/api/budgets/{budget['id']}/items", json={"material_id": "nope", "quantity": 1})
    assert response.status_code == 404


# --- order, removal, reading -------------------------------------------------------------
def test_lines_keep_the_order_they_were_added(api, catalog):
    budget = new_budget(api)
    for name in ("Primera", "Segunda", "Tercera"):
        budget = add(api, budget["id"], description=name, unit_price=1, quantity=1)
    assert [line["description"] for line in budget["items"]] == ["Primera", "Segunda", "Tercera"]
    assert [line["sort_order"] for line in budget["items"]] == [0, 1, 2]


def test_removing_a_line_updates_the_total(api, catalog):
    budget = new_budget(api)
    add(api, budget["id"], description="A", unit_price=100, quantity=1)
    budget = add(api, budget["id"], description="B", unit_price=50, quantity=1)
    response = api.delete(f"/api/budgets/{budget['id']}/items/{budget['items'][0]['id']}")
    assert response.status_code == 200
    assert [line["description"] for line in response.json()["items"]] == ["B"]
    assert response.json()["total"] == 50


def test_removing_an_unknown_line_is_a_404(api, catalog):
    budget = new_budget(api)
    assert api.delete(f"/api/budgets/{budget['id']}/items/nope").status_code == 404


def test_adding_to_an_unknown_budget_is_a_404(api, catalog):
    response = api.post("/api/budgets/nope/items", json={"description": "A", "unit_price": 1, "quantity": 1})
    assert response.status_code == 404


def test_reading_an_unknown_budget_is_a_404(api, catalog):
    assert api.get("/api/budgets/nope").status_code == 404


def test_the_history_lists_headers_with_their_totals(api, catalog):
    first = new_budget(api, title="Baño")
    add(api, first["id"], description="Refacción", unit_price=1000, quantity=1)
    new_budget(api, title="Cocina")

    response = api.get("/api/budgets")
    assert response.status_code == 200
    budgets = response.json()
    assert {b["title"] for b in budgets} == {"Baño", "Cocina"}
    assert all(b["items"] == [] for b in budgets)
    assert next(b for b in budgets if b["title"] == "Baño")["total"] == 1000


def test_an_empty_history_is_fine(api, catalog):
    # Regression: this answered 500 when there were no lines to add up.
    response = api.get("/api/budgets")
    assert response.status_code == 200
    assert response.json() == []
