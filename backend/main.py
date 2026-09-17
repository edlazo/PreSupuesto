"""PreSupuesto FastAPI application.

Endpoints:

* `GET    /health`               — service and configuration status
* `GET    /api/materials`        — list materials (search, filter, paginate)
* `POST   /api/materials`        — create a material
* `GET    /api/materials/{id}`   — read one material
* `PUT|PATCH /api/materials/{id}`— update a material
* `DELETE /api/materials/{id}`   — delete a material
* `POST   /api/chat`             — talk to the Hermes Agent
"""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import FastAPI, HTTPException, Query, Response, status
from fastapi.middleware.cors import CORSMiddleware

from config import settings
from models import (
    BudgetRead,
    ChatRequest,
    ChatResponse,
    DeletedResponse,
    HealthResponse,
    MaterialCreate,
    MaterialRead,
    MaterialUpdate,
)
from services import hermes_service, supabase_service
from services.hermes_service import HermesServiceError
from services.supabase_service import NotConfiguredError, SupabaseServiceError

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

UNIQUE_VIOLATION = "23505"
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
        return HTTPException(status.HTTP_409_CONFLICT, detail="A material with that code already exists")
    if exc.code == FOREIGN_KEY_VIOLATION:
        return HTTPException(
            status.HTTP_409_CONFLICT,
            detail="The record is referenced by a budget and cannot be changed",
        )
    return HTTPException(status.HTTP_502_BAD_GATEWAY, detail=exc.message)


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------
@app.get("/health", response_model=HealthResponse, tags=["system"])
def health() -> HealthResponse:
    """Report whether Supabase and Hermes Agent are configured."""
    return HealthResponse(
        supabase_configured=settings.supabase_configured,
        hermes_configured=settings.hermes_configured,
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


@app.get("/api/materials/{material_id}", response_model=MaterialRead, tags=["materials"])
def get_material(material_id: str) -> MaterialRead:
    """Read one material."""
    try:
        row = supabase_service.get_material(material_id)
    except SupabaseServiceError as exc:
        raise _handle_supabase_error(exc) from exc

    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Material not found")

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
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Material not found")

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
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Material not found")

    return DeletedResponse(id=material_id)


# ---------------------------------------------------------------------------
# Budgets (read only)
#
# Budgets are written by the agent through its tools. These endpoints let the
# web app show what the agent produced.
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


@app.get("/api/budgets/{budget_id}", response_model=BudgetRead, tags=["budgets"])
def get_budget(budget_id: str) -> BudgetRead:
    """Read one budget with all of its lines."""
    try:
        row = supabase_service.get_budget(budget_id)
    except SupabaseServiceError as exc:
        raise _handle_supabase_error(exc) from exc

    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Budget not found")

    return BudgetRead.model_validate(row)


# ---------------------------------------------------------------------------
# Hermes Agent chat
# ---------------------------------------------------------------------------
@app.post("/api/chat", response_model=ChatResponse, tags=["agent"])
async def chat(payload: ChatRequest) -> ChatResponse:
    """Send a message to the Hermes Agent and return its reply.

    Pass the `session_id` from the response back on the next call to keep the
    conversation going. The agent reaches the budgeting tools through the MCP
    server in `backend/mcp_server.py`.
    """
    try:
        reply, session_id, model = await hermes_service.send_chat_message(
            payload.message,
            session_id=payload.session_id,
        )
    except HermesServiceError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc

    return ChatResponse(reply=reply, session_id=session_id, model=model)
