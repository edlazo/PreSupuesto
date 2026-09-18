"""Pydantic models for API requests and responses.

These mirror the tables defined in `supabase/schema.sql`.
"""

from datetime import date, datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, EmailStr, Field

BudgetStatus = Literal["draft", "sent", "accepted", "rejected", "expired"]
BudgetItemType = Literal["material", "task", "custom"]


# ---------------------------------------------------------------------------
# Materials
# ---------------------------------------------------------------------------
class MaterialBase(BaseModel):
    """Fields shared by material creation and reading."""

    code: str = Field(min_length=1, max_length=50, description="Unique catalog code")
    name: str = Field(min_length=1, max_length=200)
    description: Optional[str] = None
    category: str = Field(min_length=1, max_length=100)
    unit: str = Field(min_length=1, max_length=20, description="Unit of measure, e.g. bag, m2, unit")
    unit_price: float = Field(ge=0, description="Current price for one unit")
    is_active: bool = True


class MaterialCreate(MaterialBase):
    """Payload to create a material.

    The code may be left out: the backend then generates one from the category,
    e.g. MAT-ALB-004 for Albañilería.
    """

    code: Optional[str] = Field(
        default=None,
        max_length=50,
        description="Unique catalog code. Generated from the category when omitted",
    )


class MaterialUpdate(BaseModel):
    """Payload to update a material. Every field is optional."""

    code: Optional[str] = Field(default=None, min_length=1, max_length=50)
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    description: Optional[str] = None
    category: Optional[str] = Field(default=None, min_length=1, max_length=100)
    unit: Optional[str] = Field(default=None, min_length=1, max_length=20)
    unit_price: Optional[float] = Field(default=None, ge=0)
    is_active: Optional[bool] = None


class BulkPriceUpdateRequest(BaseModel):
    """Apply a percentage change to the unit price of several materials."""

    percentage: float = Field(
        ge=-90,
        le=1000,
        description="Percentage to apply, e.g. 12.5 to raise prices by 12.5%, -5 to lower them",
    )
    category: Optional[str] = Field(
        default=None,
        description="Restrict the change to one category",
    )
    material_ids: Optional[list[str]] = Field(
        default=None,
        description="Restrict the change to these materials",
    )
    only_active: bool = Field(
        default=True,
        description="Skip materials flagged as inactive",
    )


class BulkPriceUpdateResponse(BaseModel):
    """What a bulk price update changed."""

    updated: int
    percentage: float
    materials: list["MaterialRead"] = Field(default_factory=list)


class MaterialRead(MaterialBase):
    """A material as stored in the database."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    created_at: datetime
    updated_at: datetime


# ---------------------------------------------------------------------------
# Standard tasks
# ---------------------------------------------------------------------------
class StandardTaskRead(BaseModel):
    """A standard labor task as stored in the database."""

    id: str
    code: str
    name: str
    description: Optional[str] = None
    trade: str
    unit: str
    labor_unit_price: float
    estimated_hours_per_unit: Optional[float] = None
    is_active: bool
    created_at: datetime
    updated_at: datetime


# ---------------------------------------------------------------------------
# Clients
# ---------------------------------------------------------------------------
class ClientCreate(BaseModel):
    """Payload to create a client."""

    full_name: str = Field(min_length=1, max_length=200)
    company_name: Optional[str] = None
    tax_id: Optional[str] = None
    email: Optional[EmailStr] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    notes: Optional[str] = None


class ClientRead(ClientCreate):
    """A client as stored in the database."""

    id: str
    created_at: datetime
    updated_at: datetime


# ---------------------------------------------------------------------------
# Budgets
# ---------------------------------------------------------------------------
class BudgetItemRead(BaseModel):
    """A single budget line."""

    id: str
    budget_id: str
    item_type: BudgetItemType
    material_id: Optional[str] = None
    standard_task_id: Optional[str] = None
    description: str
    unit: str
    quantity: float
    unit_price: float
    line_total: float
    sort_order: int


class BudgetCreate(BaseModel):
    """Payload to start a budget, with or without lines."""

    title: str = Field(default="Presupuesto nuevo", min_length=1, max_length=200)
    client_id: Optional[str] = Field(
        default=None,
        description="Client the budget belongs to. A stand-in client is used when omitted",
    )
    description: Optional[str] = None
    site_address: Optional[str] = None
    tax_rate: Optional[float] = Field(default=None, ge=0, le=100)
    valid_until: Optional[date] = None


class BudgetItemCreate(BaseModel):
    """Payload to append one line to a budget.

    Give a `material_id` or a `standard_task_id` to price the line from the
    catalog, or a description, unit and price to write a free line.
    """

    material_id: Optional[str] = None
    standard_task_id: Optional[str] = None
    description: Optional[str] = Field(default=None, max_length=300)
    unit: Optional[str] = Field(default=None, max_length=20)
    unit_price: Optional[float] = Field(default=None, ge=0)
    quantity: float = Field(gt=0, description="How much of it the job needs")
    waste_percent: float = Field(
        default=0,
        ge=0,
        le=100,
        description="Extra percentage added to the quantity of a material",
    )


class BudgetRead(BaseModel):
    """A budget header with its computed totals."""

    id: str
    budget_number: int
    client_id: str
    title: str
    description: Optional[str] = None
    site_address: Optional[str] = None
    status: BudgetStatus
    currency: str
    tax_rate: float
    subtotal: float
    tax_amount: float
    total: float
    valid_until: Optional[date] = None
    created_at: datetime
    updated_at: datetime
    items: list[BudgetItemRead] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Chat
# ---------------------------------------------------------------------------
class ChatRequest(BaseModel):
    """A user message for the Hermes Agent."""

    message: str = Field(min_length=1, description="User message in natural language")
    session_id: Optional[str] = Field(
        default=None,
        description="Hermes session id returned by a previous call, to keep conversation context",
    )


class ChatResponse(BaseModel):
    """The agent reply plus the session id to send on the next call."""

    reply: str
    session_id: Optional[str] = None
    model: Optional[str] = None
    engine: Optional[Literal["hermes", "gemini"]] = Field(
        default=None,
        description="Which engine answered: the Hermes gateway, or the Gemini fallback",
    )


# ---------------------------------------------------------------------------
# Currency
# ---------------------------------------------------------------------------
class BlueRateResponse(BaseModel):
    """Current blue dollar quote."""

    buy: float = Field(description="Price the market pays for one dollar")
    sell: float = Field(description="Price the market charges for one dollar")
    updated_at: Optional[datetime] = Field(
        default=None,
        description="When the upstream API last refreshed the quote",
    )
    source: str = Field(description="Where the quote comes from")


# ---------------------------------------------------------------------------
# Generic
# ---------------------------------------------------------------------------
class DeletedResponse(BaseModel):
    """Result of a delete operation."""

    id: str
    deleted: bool = True


class HealthResponse(BaseModel):
    """Service health and configuration status."""

    status: Literal["ok"] = "ok"
    supabase_configured: bool
    hermes_configured: bool
    gemini_configured: bool


# `BulkPriceUpdateResponse` refers to `MaterialRead`, which is defined below it.
BulkPriceUpdateResponse.model_rebuild()
