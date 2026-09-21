"""A budget's life: its status, deleting it, and rewording its work."""

import pypdfium2 as pdfium
import pytest


@pytest.fixture
def budget(api, catalog):
    budget = api.post("/api/budgets", json={"title": "Baño"}).json()
    base = f"/api/budgets/{budget['id']}/items"
    api.post(base, json={
        "description": "Refacción de baño",
        "detail": "Picar paredes\nColocar cerámica",
        "note": "Sin materiales",
        "unit_price": 1_600_000,
        "quantity": 1,
    })
    return api.post(base, json={"description": "Arena", "quantity": 3, "unit": "m3", "is_quoted": False}).json()


# --- status -------------------------------------------------------------------------
def test_a_budget_starts_as_draft(budget):
    assert budget["status"] == "draft"


@pytest.mark.parametrize("status", ["in_progress", "completed", "draft"])
def test_moving_through_the_statuses(api, budget, status):
    response = api.patch(f"/api/budgets/{budget['id']}", json={"status": status})
    assert response.status_code == 200
    assert response.json()["status"] == status
    assert response.json()["total"] == 1_600_000  # the work is untouched


@pytest.mark.parametrize("status", ["sent", "accepted", "rejected", "expired", "cobrado"])
def test_the_retired_and_unknown_statuses_are_refused(api, budget, status):
    assert api.patch(f"/api/budgets/{budget['id']}", json={"status": status}).status_code == 422


def test_the_history_shows_each_status(api, budget):
    api.patch(f"/api/budgets/{budget['id']}", json={"status": "completed"})
    api.post("/api/budgets", json={"title": "Cocina"})
    statuses = {b["title"]: b["status"] for b in api.get("/api/budgets").json()}
    assert statuses == {"Baño": "completed", "Cocina": "draft"}


def test_the_history_can_be_filtered_by_status(api, budget):
    api.patch(f"/api/budgets/{budget['id']}", json={"status": "in_progress"})
    api.post("/api/budgets", json={"title": "Cocina"})
    assert [b["title"] for b in api.get("/api/budgets?status=in_progress").json()] == ["Baño"]


@pytest.mark.parametrize("status, label", [("in_progress", "En proceso"), ("completed", "Terminado")])
def test_the_pdf_states_the_status(api, budget, status, label):
    api.patch(f"/api/budgets/{budget['id']}", json={"status": status})
    pdf = api.get(f"/api/budgets/{budget['id']}/pdf").content
    text = "\n".join(page.get_textpage().get_text_range() for page in pdfium.PdfDocument(pdf))
    assert f"Estado: {label}" in text


# --- deleting ---------------------------------------------------------------------------
def test_deleting_a_budget_takes_its_lines_with_it(api, db, budget):
    response = api.delete(f"/api/budgets/{budget['id']}")
    assert response.status_code == 200
    assert response.json() == {"id": budget["id"], "deleted": True}
    assert api.get(f"/api/budgets/{budget['id']}").status_code == 404
    assert db.all("budget_items") == []
    assert api.get("/api/budgets").json() == []


def test_deleting_leaves_the_other_budgets_alone(api, db, budget):
    other = api.post("/api/budgets", json={"title": "Cocina"}).json()
    api.post(f"/api/budgets/{other['id']}/items", json={"description": "Pintura", "unit_price": 10, "quantity": 1})
    api.delete(f"/api/budgets/{budget['id']}")
    assert [b["title"] for b in api.get("/api/budgets").json()] == ["Cocina"]
    assert len(db.all("budget_items")) == 1


def test_deleting_keeps_the_client(api, db, budget):
    api.delete(f"/api/budgets/{budget['id']}")
    assert db.find("clients", id=budget["client_id"]) is not None


def test_deleting_an_unknown_budget_is_a_404(api, catalog):
    assert api.delete("/api/budgets/nope").status_code == 404


def test_deleting_needs_a_session(anonymous, budget):
    assert anonymous.delete(f"/api/budgets/{budget['id']}").status_code == 401


# --- rewording work already added -------------------------------------------------------
def patch(api, budget, index, **changes):
    item_id = budget["items"][index]["id"]
    return api.patch(f"/api/budgets/{budget['id']}/items/{item_id}", json=changes)


def test_rewording_a_work_package(api, budget):
    response = patch(
        api, budget, 0,
        description="Refacción completa del baño",
        detail="Picar paredes\nColocar cerámica\nCambiar la grifería",
        note="Con materiales a cargo del cliente",
    )
    assert response.status_code == 200
    line = response.json()["items"][0]
    assert line["description"] == "Refacción completa del baño"
    assert line["detail"].endswith("Cambiar la grifería")
    assert line["note"] == "Con materiales a cargo del cliente"
    assert line["unit_price"] == 1_600_000
    assert response.json()["total"] == 1_600_000


def test_rewording_and_repricing_at_once(api, budget):
    line = patch(api, budget, 0, description="Baño", unit_price=1_700_000).json()["items"][0]
    assert (line["description"], line["unit_price"]) == ("Baño", 1_700_000)


def test_blank_bullets_and_remark_are_taken_off(api, budget):
    line = patch(api, budget, 0, detail="  ", note="").json()["items"][0]
    assert line["detail"] is None
    assert line["note"] is None
    assert line["description"] == "Refacción de baño"


def test_a_line_cannot_lose_its_name(api, budget):
    response = patch(api, budget, 0, description="   ")
    assert response.status_code == 422
    assert response.json()["detail"] == "La línea necesita un nombre"


def test_only_what_is_sent_changes(api, budget):
    line = patch(api, budget, 0, note="Precio final").json()["items"][0]
    assert line["description"] == "Refacción de baño"
    assert line["detail"] == "Picar paredes\nColocar cerámica"


def test_renaming_a_listed_material(api, budget):
    line = patch(api, budget, 1, description="Arena fina").json()["items"][1]
    assert line["description"] == "Arena fina"
    assert line["is_quoted"] is False


def test_the_pdf_prints_the_new_wording(api, budget):
    patch(api, budget, 0, description="Baño completo", detail="Cambiar la grifería")
    pdf = api.get(f"/api/budgets/{budget['id']}/pdf").content
    text = "\n".join(page.get_textpage().get_text_range() for page in pdfium.PdfDocument(pdf))
    assert "Baño completo" in text
    assert "• Cambiar la grifería" in text
    assert "Picar paredes" not in text


def test_text_limits_are_enforced(api, budget):
    assert patch(api, budget, 0, description="x" * 301).status_code == 422
    assert patch(api, budget, 0, note="x" * 301).status_code == 422
