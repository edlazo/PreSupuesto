"""Clients, and addressing a budget to one."""


def create(api, **body):
    response = api.post("/api/clients", json=body)
    assert response.status_code == 201, response.text
    return response.json()


def test_creating_and_reading_a_client(api, db):
    client = create(api, full_name="Ana Torres", phone="+54 11 5555-5555", email="ana@example.com")
    assert client["full_name"] == "Ana Torres"
    assert api.get(f"/api/clients/{client['id']}").json() == client


def test_a_client_needs_a_name(api, db):
    assert api.post("/api/clients", json={"full_name": ""}).status_code == 422


def test_a_bad_email_is_refused(api, db):
    assert api.post("/api/clients", json={"full_name": "Ana", "email": "no-es-un-mail"}).status_code == 422


def test_listing_is_alphabetical_and_searchable(api, db):
    for name in ("Rubén Díaz", "Ana Torres", "Marta Ruiz"):
        create(api, full_name=name)
    assert [c["full_name"] for c in api.get("/api/clients").json()] == ["Ana Torres", "Marta Ruiz", "Rubén Díaz"]
    assert [c["full_name"] for c in api.get("/api/clients?search=RUI").json()] == ["Marta Ruiz"]


def test_an_unknown_client_is_a_404(api, db):
    assert api.get("/api/clients/nope").status_code == 404


def test_assigning_a_client_keeps_the_lines(api, catalog):
    budget = api.post("/api/budgets", json={}).json()
    api.post(f"/api/budgets/{budget['id']}/items", json={"description": "Pintura", "unit_price": 300_000, "quantity": 1})
    client = create(api, full_name="Ana Torres")

    response = api.patch(f"/api/budgets/{budget['id']}", json={"client_id": client["id"]})
    assert response.status_code == 200
    assert response.json()["client_id"] == client["id"]
    assert response.json()["total"] == 300_000
    assert len(response.json()["items"]) == 1


def test_assigning_an_unknown_client_is_refused(api, catalog):
    budget = api.post("/api/budgets", json={}).json()
    response = api.patch(f"/api/budgets/{budget['id']}", json={"client_id": "nope"})
    assert response.status_code == 404
    assert response.json()["detail"] == "No se encontró el cliente"


def test_a_budget_can_start_with_its_client(api, catalog):
    client = create(api, full_name="Ana Torres")
    budget = api.post("/api/budgets", json={"client_id": client["id"], "title": "Baño"}).json()
    assert budget["client_id"] == client["id"]


def test_renaming_and_sending_a_budget(api, catalog):
    budget = api.post("/api/budgets", json={}).json()
    response = api.patch(f"/api/budgets/{budget['id']}", json={"title": "Cocina", "status": "sent"})
    assert response.json()["title"] == "Cocina"
    assert response.json()["status"] == "sent"


def test_an_unknown_status_is_refused(api, catalog):
    budget = api.post("/api/budgets", json={}).json()
    assert api.patch(f"/api/budgets/{budget['id']}", json={"status": "perdido"}).status_code == 422


def test_updating_an_unknown_budget_is_a_404(api, catalog):
    assert api.patch("/api/budgets/nope", json={"title": "X"}).status_code == 404
