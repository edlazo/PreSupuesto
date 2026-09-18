"""PreSupuesto FastAPI application.

Endpoints:

* `GET    /health`               — service and configuration status
* `GET    /api/budgets/{id}/pdf` — the budget as a downloadable PDF
* `GET    /api/materials`        — list materials (search, filter, paginate)
* `POST   /api/materials`        — create a material
* `POST   /api/materials/bulk-update-price` — shift several prices by a percentage
* `GET    /api/materials/{id}`   — read one material
* `PUT|PATCH /api/materials/{id}`— update a material
* `DELETE /api/materials/{id}`   — delete a material
* `POST   /api/budgets`          — start a budget
* `POST   /api/budgets/{id}/items` — append a line
* `DELETE /api/budgets/{id}/items/{item_id}` — remove a line
* `GET    /api/standard-tasks`   — labor tasks catalog
* `GET    /api/currency/blue`    — current blue dollar rate
* `POST   /api/chat`             — talk to the Hermes Agent
"""

from __future__ import annotations

import logging
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Optional

from fastapi import FastAPI, HTTPException, Query, Response, status
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware

from config import settings
from models import (
    BlueRateResponse,
    BudgetCreate,
    BudgetItemCreate,
    BudgetRead,
    BulkPriceUpdateRequest,
    BulkPriceUpdateResponse,
    ChatRequest,
    ChatResponse,
    DeletedResponse,
    HealthResponse,
    MaterialCreate,
    MaterialRead,
    MaterialUpdate,
    StandardTaskRead,
)
from services import agent_service, currency_service, pdf_service, supabase_service
from services.agent_service import AgentError
from services.currency_service import CurrencyServiceError
from services.pdf_service import PdfServiceError
from services.hermes_service import HermesServiceError
from services.supabase_service import NotConfiguredError, SupabaseServiceError

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

UNIQUE_VIOLATION = "23505"

# `budget_items.quantity` is numeric(12, 3).
QUANTITY_STEP = Decimal("0.001")
FOREIGN_KEY_VIOLATION = "23503"

app = FastAPI(
    title="PreSupuesto API",
    description="Construction and renovation budget automation, backed by Supabase and Hermes Agent.",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _handle_supabase_error(exc: SupabaseServiceError) -> HTTPException:
    """Translate a Supabase failure into the right HTTP error."""
    if isinstance(exc, NotConfiguredError):
        return HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail=exc.message)
    if exc.code == UNIQUE_VIOLATION:
        return HTTPException(status.HTTP_409_CONFLICT, detail="Ya existe un material con ese código")
    if exc.code == FOREIGN_KEY_VIOLATION:
        return HTTPException(
            status.HTTP_409_CONFLICT,
            detail="El registro está usado por un presupuesto y no se puede modificar",
        )
    return HTTPException(status.HTTP_502_BAD_GATEWAY, detail=exc.message)


def _build_budget_item(payload: BudgetItemCreate) -> dict[str, Any]:
    """Turn a line request into a `budget_items` row, priced from the catalog.

    Raises HTTPException for anything the caller can fix: an unknown id, a
    free line missing its price.
    """
    quantity = Decimal(str(payload.quantity))

    if payload.material_id and payload.standard_task_id:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Una línea no puede ser material y mano de obra a la vez",
        )

    if payload.material_id:
        material = supabase_service.get_material(payload.material_id)
        if material is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="No se encontró el material")

        waste = Decimal(str(payload.waste_percent or 0))
        quantity = quantity * (Decimal("1") + waste / Decimal("100"))

        return {
            "item_type": "material",
            "material_id": material["id"],
            "standard_task_id": None,
            "description": payload.description or material["name"],
            "unit": material["unit"],
            "quantity": float(quantity.quantize(QUANTITY_STEP, rounding=ROUND_HALF_UP)),
            "unit_price": float(Decimal(str(material["unit_price"]))),
        }

    if payload.standard_task_id:
        task = supabase_service.get_standard_task(payload.standard_task_id)
        if task is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="No se encontró la tarea")

        return {
            "item_type": "task",
            "material_id": None,
            "standard_task_id": task["id"],
            "description": payload.description or task["name"],
            "unit": task["unit"],
            "quantity": float(quantity.quantize(QUANTITY_STEP, rounding=ROUND_HALF_UP)),
            "unit_price": float(Decimal(str(task["labor_unit_price"]))),
        }

    if not payload.description or not payload.unit or payload.unit_price is None:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Una línea libre necesita descripción, unidad y precio",
        )

    return {
        "item_type": "custom",
        "material_id": None,
        "standard_task_id": None,
        "description": payload.description,
        "unit": payload.unit,
        "quantity": float(quantity.quantize(QUANTITY_STEP, rounding=ROUND_HALF_UP)),
        "unit_price": float(payload.unit_price),
    }


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------
@app.get("/health", response_model=HealthResponse, tags=["system"])
def health() -> HealthResponse:
    """Report whether Supabase, Hermes Agent and the Gemini fallback are configured."""
    return HealthResponse(
        supabase_configured=settings.supabase_configured,
        hermes_configured=settings.hermes_configured,
        gemini_configured=settings.gemini_configured,
    )


# ---------------------------------------------------------------------------
# Materials CRUD
# ---------------------------------------------------------------------------
@app.get("/api/materials", response_model=list[MaterialRead], tags=["materials"])
def list_materials(
    response: Response,
    search: Optional[str] = Query(default=None, description="Text to look for in the material name"),
    category: Optional[str] = Query(default=None, description="Exact category"),
    is_active: Optional[bool] = Query(default=None, description="Filter by active flag"),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> list[MaterialRead]:
    """List materials for the management table."""
    try:
        rows = supabase_service.list_materials(
            search=search,
            category=category,
            is_active=is_active,
            limit=limit,
            offset=offset,
        )
        total = supabase_service.count_materials(search=search, category=category, is_active=is_active)
    except SupabaseServiceError as exc:
        raise _handle_supabase_error(exc) from exc

    # The total row count travels in a header so the list body stays a plain array.
    response.headers["X-Total-Count"] = str(total)

    return [MaterialRead.model_validate(row) for row in rows]


@app.post(
    "/api/materials",
    response_model=MaterialRead,
    status_code=status.HTTP_201_CREATED,
    tags=["materials"],
)
def create_material(payload: MaterialCreate) -> MaterialRead:
    """Create a material."""
    try:
        row = supabase_service.create_material(payload.model_dump())
    except SupabaseServiceError as exc:
        raise _handle_supabase_error(exc) from exc

    return MaterialRead.model_validate(row)


@app.post(
    "/api/materials/bulk-update-price",
    response_model=BulkPriceUpdateResponse,
    tags=["materials"],
)
def bulk_update_material_prices(payload: BulkPriceUpdateRequest) -> BulkPriceUpdateResponse:
    """Raise or lower the unit price of several materials by a percentage.

    The change can be limited to one category or to a list of materials, and
    skips inactive ones unless `only_active` is false. A material whose price
    does not move — a 0% change, or a price of zero — is left untouched.
    """
    try:
        rows = supabase_service.bulk_update_material_prices(
            percentage=payload.percentage,
            category=payload.category,
            material_ids=payload.material_ids,
            only_active=payload.only_active,
        )
    except SupabaseServiceError as exc:
        raise _handle_supabase_error(exc) from exc

    return BulkPriceUpdateResponse(
        updated=len(rows),
        percentage=payload.percentage,
        materials=[MaterialRead.model_validate(row) for row in rows],
    )


@app.get("/api/materials/{material_id}", response_model=MaterialRead, tags=["materials"])
def get_material(material_id: str) -> MaterialRead:
    """Read one material."""
    try:
        row = supabase_service.get_material(material_id)
    except SupabaseServiceError as exc:
        raise _handle_supabase_error(exc) from exc

    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="No se encontró el material")

    return MaterialRead.model_validate(row)


@app.put("/api/materials/{material_id}", response_model=MaterialRead, tags=["materials"])
@app.patch("/api/materials/{material_id}", response_model=MaterialRead, tags=["materials"])
def update_material(material_id: str, payload: MaterialUpdate) -> MaterialRead:
    """Update a material. Only the fields present in the body are changed."""
    changes = payload.model_dump(exclude_unset=True)

    try:
        row = supabase_service.update_material(material_id, changes)
    except SupabaseServiceError as exc:
        raise _handle_supabase_error(exc) from exc

    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="No se encontró el material")

    return MaterialRead.model_validate(row)


@app.delete("/api/materials/{material_id}", response_model=DeletedResponse, tags=["materials"])
def delete_material(material_id: str) -> DeletedResponse:
    """Delete a material.

    A material already used by a budget cannot be deleted; deactivate it
    instead by setting `is_active` to false.
    """
    try:
        deleted = supabase_service.delete_material(material_id)
    except SupabaseServiceError as exc:
        raise _handle_supabase_error(exc) from exc

    if not deleted:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="No se encontró el material")

    return DeletedResponse(id=material_id)


# ---------------------------------------------------------------------------
# Standard tasks
# ---------------------------------------------------------------------------
@app.get("/api/standard-tasks", response_model=list[StandardTaskRead], tags=["tasks"])
def list_standard_tasks(
    search: Optional[str] = Query(default=None, description="Text to look for in the task name"),
    trade: Optional[str] = Query(default=None, description="Exact trade"),
    is_active: Optional[bool] = Query(default=True, description="Filter by active flag"),
    limit: int = Query(default=200, ge=1, le=500),
) -> list[StandardTaskRead]:
    """List the labor tasks a budget line can be priced from."""
    try:
        rows = supabase_service.list_standard_tasks(
            search=search, trade=trade, is_active=is_active, limit=limit
        )
    except SupabaseServiceError as exc:
        raise _handle_supabase_error(exc) from exc

    return [StandardTaskRead.model_validate(row) for row in rows]


# ---------------------------------------------------------------------------
# Budgets
#
# A budget can be built by hand from the web app or by the agent through its
# tools; both write the same rows, so a budget can be started one way and
# finished the other.
# ---------------------------------------------------------------------------
@app.get("/api/budgets", response_model=list[BudgetRead], tags=["budgets"])
def list_budgets(
    client_id: Optional[str] = Query(default=None, description="Filter by client"),
    status_filter: Optional[str] = Query(default=None, alias="status", description="Filter by status"),
    limit: int = Query(default=20, ge=1, le=100),
) -> list[BudgetRead]:
    """List budget headers, most recent first. Lines are not included."""
    try:
        rows = supabase_service.list_budgets(client_id=client_id, status=status_filter, limit=limit)
    except SupabaseServiceError as exc:
        raise _handle_supabase_error(exc) from exc

    return [BudgetRead.model_validate(row) for row in rows]


@app.post(
    "/api/budgets",
    response_model=BudgetRead,
    status_code=status.HTTP_201_CREATED,
    tags=["budgets"],
)
def create_budget(payload: BudgetCreate) -> BudgetRead:
    """Start an empty budget, ready for lines.

    A budget needs a client, but one is rarely known when the first line is
    priced, so leaving `client_id` out attaches the stand-in "Consumidor
    final" client until a real one is set.
    """
    try:
        client_id = payload.client_id

        if client_id:
            if supabase_service.get_client_record(client_id) is None:
                raise HTTPException(
                    status.HTTP_404_NOT_FOUND, detail="No se encontró el cliente"
                )
        else:
            client_id = supabase_service.get_or_create_default_client()["id"]

        header: dict[str, Any] = {
            "client_id": client_id,
            "title": payload.title,
            "status": "draft",
            "currency": settings.default_currency,
            "tax_rate": (
                payload.tax_rate if payload.tax_rate is not None else settings.default_tax_rate
            ),
        }
        if payload.description:
            header["description"] = payload.description
        if payload.site_address:
            header["site_address"] = payload.site_address
        if payload.valid_until:
            header["valid_until"] = payload.valid_until.isoformat()

        budget = supabase_service.create_budget(header, [])
    except SupabaseServiceError as exc:
        raise _handle_supabase_error(exc) from exc

    return BudgetRead.model_validate(budget)


@app.post(
    "/api/budgets/{budget_id}/items",
    response_model=BudgetRead,
    status_code=status.HTTP_201_CREATED,
    tags=["budgets"],
)
def add_budget_item(budget_id: str, payload: BudgetItemCreate) -> BudgetRead:
    """Append a line to a budget and return the budget with its new totals.

    Catalog prices are copied onto the line, so a later price change leaves
    stored budgets alone — the same snapshot rule the agent's tools follow.
    """
    try:
        if supabase_service.get_budget(budget_id) is None:
            raise HTTPException(
                status.HTTP_404_NOT_FOUND, detail="No se encontró el presupuesto"
            )

        item = _build_budget_item(payload)
        supabase_service.add_budget_item(budget_id, item)
        budget = supabase_service.get_budget(budget_id)
    except SupabaseServiceError as exc:
        raise _handle_supabase_error(exc) from exc

    if budget is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="No se encontró el presupuesto")

    return BudgetRead.model_validate(budget)


@app.delete(
    "/api/budgets/{budget_id}/items/{item_id}",
    response_model=BudgetRead,
    tags=["budgets"],
)
def delete_budget_item(budget_id: str, item_id: str) -> BudgetRead:
    """Remove a line and return the budget with its new totals."""
    try:
        deleted = supabase_service.delete_budget_item(budget_id, item_id)

        if not deleted:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="No se encontró el ítem")

        budget = supabase_service.get_budget(budget_id)
    except SupabaseServiceError as exc:
        raise _handle_supabase_error(exc) from exc

    if budget is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="No se encontró el presupuesto")

    return BudgetRead.model_validate(budget)


@app.get("/api/budgets/{budget_id}", response_model=BudgetRead, tags=["budgets"])
def get_budget(budget_id: str) -> BudgetRead:
    """Read one budget with all of its lines."""
    try:
        row = supabase_service.get_budget(budget_id)
    except SupabaseServiceError as exc:
        raise _handle_supabase_error(exc) from exc

    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="No se encontró el presupuesto")

    return BudgetRead.model_validate(row)


@app.get(
    "/api/budgets/{budget_id}/pdf",
    response_class=Response,
    responses={200: {"content": {"application/pdf": {}}, "description": "The budget as a PDF"}},
    tags=["budgets"],
)
async def get_budget_pdf(
    budget_id: str,
    currency: Optional[str] = Query(
        default=None,
        description="Print the budget in this currency, e.g. USD. Defaults to the stored one",
    ),
    rate: Optional[float] = Query(
        default=None,
        gt=0,
        description="Exchange rate to apply. Defaults to the current blue dollar sell rate",
    ),
) -> Response:
    """Render one budget as a downloadable PDF.

    Asking for a currency the budget was not priced in converts every amount,
    and the document states which rate was applied.
    """
    try:
        budget = await run_in_threadpool(supabase_service.get_budget, budget_id)
    except SupabaseServiceError as exc:
        raise _handle_supabase_error(exc) from exc

    if budget is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="No se encontró el presupuesto")

    # The client block is nice to have: a missing client must not fail the PDF.
    client = None
    try:
        if budget.get("client_id"):
            client = await run_in_threadpool(
                supabase_service.get_client_record, budget["client_id"]
            )
    except SupabaseServiceError as exc:
        logger.warning("Could not load the client for budget %s: %s", budget_id, exc)

    target_currency = (currency or budget.get("currency") or settings.default_currency).upper()
    exchange_rate = rate

    # Converting needs a rate: take the caller's, or read today's blue rate.
    if target_currency != str(budget.get("currency") or "").upper() and exchange_rate is None:
        try:
            exchange_rate = (await currency_service.get_blue_rate()).sell
        except CurrencyServiceError as exc:
            raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc

    try:
        pdf_bytes = pdf_service.build_budget_pdf(
            budget,
            client,
            currency=target_currency,
            exchange_rate=exchange_rate,
        )
    except PdfServiceError as exc:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc

    filename = pdf_service.build_filename(budget)

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            # The browser reads the name from the header, which CORS hides by default.
            "Access-Control-Expose-Headers": "Content-Disposition",
        },
    )


# ---------------------------------------------------------------------------
# Currency
# ---------------------------------------------------------------------------
@app.get("/api/currency/blue", response_model=BlueRateResponse, tags=["currency"])
async def get_blue_rate(
    refresh: bool = Query(
        default=False,
        description="Skip the short-lived cache and read the upstream API again",
    ),
) -> BlueRateResponse:
    """Return the current blue dollar buy and sell prices."""
    try:
        rate = await currency_service.get_blue_rate(force_refresh=refresh)
    except CurrencyServiceError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc

    return BlueRateResponse(
        buy=rate.buy,
        sell=rate.sell,
        updated_at=rate.updated_at,
        source=rate.source,
    )


# ---------------------------------------------------------------------------
# Hermes Agent chat
# ---------------------------------------------------------------------------
@app.post("/api/chat", response_model=ChatResponse, tags=["agent"])
async def chat(payload: ChatRequest) -> ChatResponse:
    """Send a message to the agent and return its reply.

    Hermes Agent answers when its gateway is reachable, and it reaches the
    budgeting tools through the MCP server in `backend/mcp_server.py`. When the
    gateway is down, the Gemini fallback answers instead and runs the same
    tools in this process. The response says which engine replied.

    Pass the `session_id` from the response back on the next call to keep the
    conversation going.
    """
    try:
        answer = await agent_service.send_message(
            payload.message,
            session_id=payload.session_id,
        )
    except (AgentError, HermesServiceError) as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc

    return ChatResponse(
        reply=answer.reply,
        session_id=answer.session_id,
        model=answer.model,
        engine=answer.engine,
    )
