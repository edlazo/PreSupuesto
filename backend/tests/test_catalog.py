"""The materials and labour catalogs the budget lines are picked from."""

import pytest

from services import supabase_service


# --- reading ---------------------------------------------------------------------
def test_materials_are_listed_by_name_with_a_total_count(api, catalog):
    response = api.get("/api/materials?limit=2")
    assert [m["name"] for m in response.json()] == ["Arena fina", "Cemento Portland"]
    assert response.headers["X-Total-Count"] == "4"


def test_materials_can_be_searched_and_filtered(api, catalog):
    assert [m["name"] for m in api.get("/api/materials?search=LADRI").json()] == ["Ladrillo común"]
    assert [m["name"] for m in api.get("/api/materials?is_active=false").json()] == ["Látex interior"]
    assert len(api.get("/api/materials?category=Áridos").json()) == 1


def test_paging_through_materials(api, catalog):
    names = [m["name"] for m in api.get("/api/materials?limit=2&offset=2").json()]
    assert names == ["Ladrillo común", "Látex interior"]


def test_an_unknown_material_is_a_404(api, catalog):
    assert api.get("/api/materials/nope").status_code == 404


def test_labour_tasks_are_listed(api, catalog):
    tasks = api.get("/api/standard-tasks").json()
    assert [t["code"] for t in tasks] == ["TSK-ALB-001", "TSK-PIN-001"]
    assert api.get("/api/standard-tasks?trade=Pintura").json()[0]["labor_unit_price"] == 3500


# --- codes ----------------------------------------------------------------------------
@pytest.mark.parametrize(
    "category, prefix",
    [
        ("Albañilería", "ALB"),
        ("albanileria", "ALB"),
        ("Materiales de agarre", "AGA"),
        ("Áridos", "ARI"),
        ("Yesería", "YES"),
        ("de la obra", "OBR"),
        ("Ok", "OKX"),
        ("---", "GEN"),
    ],
)
def test_category_prefixes(category, prefix):
    assert supabase_service.build_category_prefix(category) == prefix


def test_a_new_material_gets_the_next_code_of_its_category(api, catalog):
    response = api.post(
        "/api/materials",
        json={"name": "Ladrillo hueco", "category": "Albañilería", "unit": "u", "unit_price": 950},
    )
    assert response.status_code == 201
    assert response.json()["code"] == "MAT-ALB-002"


def test_numbering_continues_after_the_highest(api, db, catalog):
    db.seed("materials", code="MAT-ALB-007", name="Bloque", category="Albañilería", unit="u", unit_price=1)
    assert supabase_service.generate_material_code("Albañilería") == "MAT-ALB-008"


def test_a_code_given_by_hand_is_kept(api, catalog):
    response = api.post(
        "/api/materials",
        json={"code": "MIO-1", "name": "Algo", "category": "Varios", "unit": "u", "unit_price": 1},
    )
    assert response.json()["code"] == "MIO-1"


def test_a_repeated_code_is_a_conflict(api, catalog):
    response = api.post(
        "/api/materials",
        json={"code": "MAT-ARI-001", "name": "Otra arena", "category": "Áridos", "unit": "m3", "unit_price": 1},
    )
    assert response.status_code == 409


def test_a_taken_generated_code_is_retried(monkeypatch, db, catalog):
    # Someone else takes MAT-ALB-002 between the lookup and the insert.
    real_generate = supabase_service.generate_material_code
    calls = []

    def racing_generate(category):
        code = real_generate(category)
        if not calls:
            db.seed("materials", code=code, name="Ajeno", category=category, unit="u", unit_price=1)
        calls.append(code)
        return code

    monkeypatch.setattr(supabase_service, "generate_material_code", racing_generate)
    row = supabase_service.create_material({"name": "Mío", "category": "Albañilería", "unit": "u", "unit_price": 1})
    assert calls == ["MAT-ALB-002", "MAT-ALB-003"]
    assert row["code"] == "MAT-ALB-003"


# --- editing ------------------------------------------------------------------------
def test_editing_a_material(api, catalog):
    material = catalog.materials.sand
    response = api.patch(f"/api/materials/{material['id']}", json={"unit_price": 50_000})
    assert response.json()["unit_price"] == 50_000
    assert response.json()["name"] == "Arena fina"


def test_editing_an_unknown_material_is_a_404(api, catalog):
    assert api.patch("/api/materials/nope", json={"unit_price": 1}).status_code == 404


def test_deleting_an_unused_material(api, db, catalog):
    assert api.delete(f"/api/materials/{catalog.materials.brick['id']}").json() == {
        "id": catalog.materials.brick["id"],
        "deleted": True,
    }
    assert db.find("materials", code="MAT-ALB-001") is None


def test_a_material_used_by_a_budget_cannot_be_deleted(api, catalog):
    budget = api.post("/api/budgets", json={}).json()
    api.post(
        f"/api/budgets/{budget['id']}/items",
        json={"material_id": catalog.materials.sand["id"], "quantity": 1, "is_quoted": False},
    )
    response = api.delete(f"/api/materials/{catalog.materials.sand['id']}")
    assert response.status_code == 409


# --- raising prices in bulk ---------------------------------------------------------
def test_a_bulk_raise_touches_active_materials(api, db, catalog):
    response = api.post("/api/materials/bulk-update-price", json={"percentage": 10})
    assert response.json()["updated"] == 3
    assert db.find("materials", code="MAT-ARI-001")["unit_price"] == 49_500
    assert db.find("materials", code="MAT-PIN-001")["unit_price"] == 60_000  # inactive


def test_a_bulk_raise_can_stay_in_one_category(api, db, catalog):
    response = api.post("/api/materials/bulk-update-price", json={"percentage": 10, "category": "Áridos"})
    assert response.json()["updated"] == 1
    assert db.find("materials", code="MAT-AGA-001")["unit_price"] == 9500


def test_a_bulk_cut_rounds_and_never_goes_below_zero(db, catalog):
    supabase_service.bulk_update_material_prices(percentage=-33.333)
    assert db.find("materials", code="MAT-ALB-001")["unit_price"] == 120.0
    supabase_service.bulk_update_material_prices(percentage=-100)
    assert db.find("materials", code="MAT-ALB-001")["unit_price"] == 0.0


def test_nothing_moves_at_zero_percent(api, catalog):
    assert api.post("/api/materials/bulk-update-price", json={"percentage": 0}).json()["updated"] == 0
