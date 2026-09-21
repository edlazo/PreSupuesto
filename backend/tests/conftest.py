"""Shared fixtures.

The environment is set before anything imports `config`, so the settings the
app reads here never point at the real Supabase project or a paid model,
whatever `backend/.env` holds: real values in the environment win over the
file, and these are fake ones.
"""

from __future__ import annotations

import os

os.environ.update(
    {
        "SUPABASE_URL": "https://stub.invalid",
        "SUPABASE_KEY": "stub",
        "HERMES_API_KEY": "",
        "GEMINI_API_KEY": "",
        "DEFAULT_CURRENCY": "ARS",
        "DEFAULT_TAX_RATE": "0",
        "COMPANY_NAME": "Construcciones de prueba",
    }
)

from types import SimpleNamespace  # noqa: E402

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from services import currency_service, supabase_service  # noqa: E402
from tests.fake_supabase import FakeDatabase  # noqa: E402

# The five conditions the real database is seeded with (migrations 002 and 004).
CLAUSE = "Por la compra de materiales se cobra un {percent}% del valor de los mismos."
PRICING_FACTORS = [
    dict(code="departamento", label="Departamento", percent=40, applies_to="labor", sort_order=10),
    dict(code="sin_estacionamiento", label="Sin lugar para estacionar", percent=40, applies_to="labor", sort_order=20),
    dict(code="horarios_restringidos", label="Horarios restringidos", percent=50, applies_to="labor", sort_order=30),
    dict(
        code="compra_materiales_provincia", label="Compra de materiales (provincia)", percent=15,
        applies_to="note", exclusive_group="compra_materiales", clause=CLAUSE, sort_order=40,
    ),
    dict(
        code="compra_materiales_capital", label="Compra de materiales (capital)", percent=20,
        applies_to="note", exclusive_group="compra_materiales", clause=CLAUSE, sort_order=50,
    ),
]


@pytest.fixture
def db(monkeypatch: pytest.MonkeyPatch) -> FakeDatabase:
    """An empty in-memory database wired in place of Supabase."""
    database = FakeDatabase()
    monkeypatch.setattr(supabase_service, "get_client", lambda: database)
    return database


@pytest.fixture
def catalog(db: FakeDatabase) -> SimpleNamespace:
    """A small, known catalog: a few materials, two tasks, the real conditions."""
    materials = SimpleNamespace(
        cement=db.seed("materials", code="MAT-AGA-001", name="Cemento Portland", category="Materiales de agarre", unit="bolsa", unit_price=9500),
        sand=db.seed("materials", code="MAT-ARI-001", name="Arena fina", category="Áridos", unit="m3", unit_price=45000),
        brick=db.seed("materials", code="MAT-ALB-001", name="Ladrillo común", category="Albañilería", unit="u", unit_price=180),
        old_paint=db.seed("materials", code="MAT-PIN-001", name="Látex interior", category="Pintura", unit="balde", unit_price=60000, is_active=False),
    )
    tasks = SimpleNamespace(
        wall=db.seed("standard_tasks", code="TSK-ALB-001", name="Levantar muro", trade="Albañilería", unit="m2", labor_unit_price=20000),
        paint=db.seed("standard_tasks", code="TSK-PIN-001", name="Pintar paredes", trade="Pintura", unit="m2", labor_unit_price=3500),
    )
    factors = {row["code"]: db.seed("pricing_factors", **row) for row in PRICING_FACTORS}
    return SimpleNamespace(materials=materials, tasks=tasks, factors=factors)


@pytest.fixture
def api(db: FakeDatabase) -> TestClient:
    """The FastAPI app, talking to the fake database."""
    import main

    return TestClient(main.app)


@pytest.fixture(autouse=True)
def _no_cached_rate():
    """Every test starts without a cached dollar rate."""
    currency_service.clear_cache()
    yield
    currency_service.clear_cache()
