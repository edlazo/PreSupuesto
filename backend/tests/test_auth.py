"""Nobody reaches the data without the private link."""

import pytest

from config import settings
from services import auth_service

KEY = "test-access-key-that-is-long-enough-000"

PROTECTED = [
    ("get", "/api/budgets"),
    ("post", "/api/budgets"),
    ("get", "/api/budgets/x"),
    ("patch", "/api/budgets/x"),
    ("delete", "/api/budgets/x/items/y"),
    ("get", "/api/budgets/x/pdf"),
    ("get", "/api/clients"),
    ("post", "/api/clients"),
    ("get", "/api/materials"),
    ("post", "/api/materials/bulk-update-price"),
    ("delete", "/api/materials/x"),
    ("get", "/api/standard-tasks"),
    ("get", "/api/pricing-factors"),
    ("get", "/api/currency/blue"),
    ("post", "/api/chat"),
]


@pytest.mark.parametrize("method, path", PROTECTED)
def test_every_route_is_closed_without_a_session(anonymous, catalog, method, path):
    response = anonymous.request(method, path, json={})
    assert response.status_code == 401
    assert response.json()["detail"] == "Entrá con tu link de acceso"


def test_health_stays_open(anonymous):
    assert anonymous.get("/health").status_code == 200


def test_the_key_opens_a_session(anonymous, catalog):
    response = anonymous.post("/api/auth/login", json={"key": KEY})
    assert response.status_code == 200
    token = response.json()["token"]

    budgets = anonymous.get("/api/budgets", headers={"Authorization": f"Bearer {token}"})
    assert budgets.status_code == 200


def test_the_session_lasts_the_configured_days(anonymous):
    before = auth_service.time.time()
    expires = anonymous.post("/api/auth/login", json={"key": KEY}).json()["expires_at"]
    assert expires - before == pytest.approx(180 * 24 * 3600, abs=5)


@pytest.mark.parametrize("key", ["wrong", KEY + "x", KEY[:-1], " "])
def test_a_wrong_key_is_refused(anonymous, key):
    response = anonymous.post("/api/auth/login", json={"key": key})
    assert response.status_code in (401, 422)


@pytest.mark.parametrize(
    "header",
    [
        "Bearer nope",
        "Bearer v1.9999999999.forged",
        "Basic dXNlcjpwYXNz",
        "",
    ],
)
def test_forged_sessions_are_refused(anonymous, catalog, header):
    assert anonymous.get("/api/budgets", headers={"Authorization": header}).status_code == 401


def test_a_tampered_expiry_breaks_the_signature():
    token, expires = auth_service.create_session()
    version, _, signature = token.split(".")
    stretched = f"{version}.{expires + 10**8}.{signature}"
    assert auth_service.session_is_valid(token)
    assert not auth_service.session_is_valid(stretched)


def test_an_expired_session_is_refused():
    token, expires = auth_service.create_session(now=1_000_000)
    assert auth_service.session_is_valid(token, now=expires - 1)
    assert not auth_service.session_is_valid(token, now=expires)


def test_changing_the_key_revokes_every_session(monkeypatch, anonymous, catalog):
    token, _ = auth_service.create_session()
    monkeypatch.setattr(settings, "access_key", "a-brand-new-key-after-the-link-leaked-1234")
    assert anonymous.get("/api/budgets", headers={"Authorization": f"Bearer {token}"}).status_code == 401
    assert anonymous.post("/api/auth/login", json={"key": KEY}).status_code == 401


@pytest.mark.parametrize("key", ["", "short-key"])
def test_without_a_proper_key_the_api_refuses_to_run_open(monkeypatch, anonymous, catalog, key):
    monkeypatch.setattr(settings, "access_key", key)
    assert anonymous.get("/api/budgets", headers={"Authorization": "Bearer x"}).status_code == 503
    assert anonymous.post("/api/auth/login", json={"key": "anything"}).status_code == 503
    assert anonymous.get("/health").json()["access_configured"] is False


def test_a_browser_preflight_is_answered(anonymous):
    response = anonymous.options(
        "/api/budgets",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "authorization",
        },
    )
    assert response.status_code == 200
    assert "authorization" in response.headers["access-control-allow-headers"].lower()
