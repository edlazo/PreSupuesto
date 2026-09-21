"""The blue dollar rate, and the chat endpoint when no assistant is reachable."""

import httpx
import pytest

from services import currency_service

UPSTREAM = {"compra": 1535, "venta": 1555, "fechaActualizacion": "2026-09-17T21:00:00.000Z"}


class FakeUpstream:
    """Stands in for httpx.AsyncClient against dolarapi.com."""

    calls = 0
    fail = False

    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    async def get(self, url):
        FakeUpstream.calls += 1
        if FakeUpstream.fail:
            raise httpx.RequestError("sin red")
        return httpx.Response(200, json=UPSTREAM)


@pytest.fixture
def upstream(monkeypatch):
    FakeUpstream.calls = 0
    FakeUpstream.fail = False
    monkeypatch.setattr(currency_service.httpx, "AsyncClient", FakeUpstream)
    return FakeUpstream


def test_parsing_the_upstream_answer():
    rate = currency_service._parse_rate(UPSTREAM)
    assert (rate.buy, rate.sell) == (1535.0, 1555.0)
    assert rate.updated_at.year == 2026


@pytest.mark.parametrize("payload", [{"compra": 1535}, {"compra": 0, "venta": 0}, "nope", {"compra": "x", "venta": "y"}])
def test_nonsense_from_upstream_is_rejected(payload):
    with pytest.raises(currency_service.CurrencyServiceError):
        currency_service._parse_rate(payload)


def test_the_rate_endpoint(api, upstream):
    body = api.get("/api/currency/blue").json()
    assert (body["buy"], body["sell"]) == (1535.0, 1555.0)
    assert body["source"] == "dolarapi.com"


def test_the_rate_is_cached_until_a_refresh(api, upstream):
    api.get("/api/currency/blue")
    api.get("/api/currency/blue")
    assert upstream.calls == 1
    api.get("/api/currency/blue?refresh=true")
    assert upstream.calls == 2


def test_upstream_down_is_a_503_in_spanish(api, upstream):
    upstream.fail = True
    response = api.get("/api/currency/blue")
    assert response.status_code == 503
    assert "cotizaciones" in response.json()["detail"]


def test_a_dollar_pdf_without_a_rate_uses_the_blue_one(api, catalog, upstream):
    budget = api.post("/api/budgets", json={}).json()
    api.post(f"/api/budgets/{budget['id']}/items", json={"description": "A", "unit_price": 1555, "quantity": 1})
    response = api.get(f"/api/budgets/{budget['id']}/pdf?currency=USD")
    assert response.status_code == 200
    assert upstream.calls == 1


def test_a_dollar_pdf_with_no_rate_available_is_a_503(api, catalog, upstream):
    upstream.fail = True
    budget = api.post("/api/budgets", json={}).json()
    assert api.get(f"/api/budgets/{budget['id']}/pdf?currency=USD").status_code == 503


def test_chat_without_any_assistant_is_a_503(api):
    response = api.post("/api/chat", json={"message": "Hola"})
    assert response.status_code == 503
    assert "GEMINI_API_KEY" in response.json()["detail"]


def test_health_reports_what_is_configured(api):
    body = api.get("/health").json()
    assert body == {
        "status": "ok",
        "supabase_configured": True,
        "hermes_configured": False,
        "gemini_configured": False,
        "access_configured": True,
    }
