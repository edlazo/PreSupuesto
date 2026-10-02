"""Pydantic models for API requests and responses.

These mirror the tables defined in `supabase/schema.sql`.
"""

import base64
import binascii
from datetime import date, datetime
from typing import Annotated, Any, Literal, Optional

from pydantic import BaseModel, BeforeValidator, ConfigDict, EmailStr, Field, model_validator

# Borrador, En proceso, Terminado / cobrado.
BudgetStatus = Literal["draft", "in_progress", "completed"]
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
# Pricing factors
# ---------------------------------------------------------------------------
# "note" is a condition that is stated on the quote rather than charged.
FactorBase = Literal["labor", "materials", "note"]


class PricingFactorRead(BaseModel):
    """A site condition that moves the price of a job."""

    id: str
    code: str
    label: str
    description: Optional[str] = None
    percent: float
    applies_to: FactorBase
    clause: Optional[str] = Field(
        default=None,
        description="Sentence printed for a note factor; {percent} is substituted",
    )
    exclusive_group: Optional[str] = Field(
        default=None,
        description="Conditions sharing a group are alternatives, never both",
    )
    is_active: bool
    sort_order: int
    created_at: datetime
    updated_at: datetime


class PricingFactorUpdate(BaseModel):
    """Payload to tune a factor. Every field is optional."""

    label: Optional[str] = Field(default=None, min_length=1, max_length=100)
    description: Optional[str] = None
    percent: Optional[float] = Field(default=None, ge=-100, le=500)
    is_active: Optional[bool] = None


class AppliedFactor(BaseModel):
    """A condition as it applied to one budget, frozen when it was chosen.

    Prices are snapshotted onto budget lines for the same reason: raising a
    percentage today must not rewrite a quote sent last month.
    """

    code: str
    label: str
    percent: float
    applies_to: FactorBase
    clause: Optional[str] = None


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
    detail: Optional[str] = None
    note: Optional[str] = None
    unit: str
    quantity: float
    quantity_text: Optional[str] = Field(
        default=None,
        description="A listed line's quantity as written, e.g. '1/2'; shown instead of quantity",
    )
    unit_price: float
    is_quoted: bool = True
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


class BudgetUpdate(BaseModel):
    """Payload to change a budget header. Every field is optional."""

    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    client_id: Optional[str] = Field(
        default=None, description="Client the budget belongs to"
    )
    description: Optional[str] = None
    site_address: Optional[str] = None
    status: Optional[BudgetStatus] = None
    valid_until: Optional[date] = None
    site_factors: Optional[list[str]] = Field(
        default=None,
        description="Codes of the conditions that apply, frozen onto the budget",
    )


class PriceAdjustment(BaseModel):
    """Payload to shift every charged line of a budget by a percentage."""

    percentage: float = Field(
        ge=-99,
        le=500,
        description="12.5 raises the prices by 12.5%, -10 lowers them by 10%",
    )


class BudgetItemCreate(BaseModel):
    """Payload to append one line to a budget.

    Give a `material_id` or a `standard_task_id` to price the line from the
    catalog, or a description, unit and price to write a free line.
    """

    material_id: Optional[str] = None
    standard_task_id: Optional[str] = None
    description: Optional[str] = Field(default=None, max_length=300)
    detail: Optional[str] = Field(
        default=None,
        max_length=2000,
        description="Bullet lines covered by this price, one per line",
    )
    note: Optional[str] = Field(
        default=None,
        max_length=300,
        description="Condition printed next to the price, e.g. a building restriction",
    )
    unit: Optional[str] = Field(default=None, max_length=20)
    unit_price: Optional[float] = Field(default=None, ge=0)
    quantity: float = Field(gt=0, description="How much of it the job needs")
    quantity_text: Optional[str] = Field(
        default=None,
        max_length=40,
        description="For a listed line: the quantity as written, symbols and all, e.g. '1/2' or '2 o 3'",
    )
    is_quoted: bool = Field(
        default=True,
        description="False lists the line without a price and keeps it out of the total",
    )
    waste_percent: float = Field(
        default=0,
        ge=0,
        le=100,
        description="Extra percentage added to the quantity of a material",
    )


class BudgetItemUpdate(BaseModel):
    """Payload to change one line of a budget. Every field is optional.

    The quantity is the final one, waste included: what the budget shows.
    """

    quantity: Optional[float] = Field(
        default=None, gt=0, description="How much of it the job needs"
    )
    unit_price: Optional[float] = Field(
        default=None,
        ge=0,
        description="Base price of one unit, before any site condition is applied",
    )
    is_quoted: Optional[bool] = Field(
        default=None,
        description="False lists the line without a price and keeps it out of the total",
    )
    quantity_text: Optional[str] = Field(
        default=None,
        max_length=40,
        description="For a listed line: the quantity as written. An empty string clears it",
    )
    description: Optional[str] = Field(
        default=None,
        max_length=300,
        description="What the line is called: the work, the task, the material",
    )
    detail: Optional[str] = Field(
        default=None,
        max_length=2000,
        description="Bullet lines covered by the price, one per line. An empty string clears them",
    )
    note: Optional[str] = Field(
        default=None,
        max_length=300,
        description="Condition printed next to the price. An empty string clears it",
    )
    description: Optional[str] = Field(
        default=None,
        max_length=300,
        description="What the line is: the job's title, or the material's name",
    )
    detail: Optional[str] = Field(
        default=None,
        max_length=2000,
        description="Bullet lines covered by the price, one per line. Empty clears them",
    )
    note: Optional[str] = Field(
        default=None,
        max_length=300,
        description="Condition printed next to the price. Empty clears it",
    )
    unit: Optional[str] = Field(default=None, max_length=20, description="Unit of measure")


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
    site_factors: list[AppliedFactor] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime
    items: list[BudgetItemRead] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Chat
# ---------------------------------------------------------------------------
ChatAttachmentKind = Literal["image", "audio"]

# What a photo may be. Whatever the camera produced, the browser re-encodes it
# before sending.
IMAGE_MIME_TYPES = frozenset({"image/jpeg", "image/png", "image/webp"})
# A recording arrives as WAV whatever the phone recorded, because the browser
# decodes it and writes the header itself: one format to support server-side,
# and the one the assistant is surest to accept.
AUDIO_MIME_TYPES = frozenset({"audio/wav"})

# Vercel caps a request body at 4.5 MB and base64 adds a third on top of the
# bytes, so the room left for the attachments themselves is about 3.3 MB. These
# limits sit under that with the JSON around them accounted for. The browser
# aims far lower: a photo is shrunk to a few hundred KB, and a minute of speech
# at 16 kHz mono is 1.9 MB.
MAX_IMAGE_BYTES = 1_500_000
MAX_AUDIO_BYTES = 2_100_000
MAX_ATTACHMENT_BYTES = 3_000_000
MAX_ATTACHMENTS = 3


def _decoded_base64(value: Any) -> Any:
    """Decode base64 strictly, so a damaged upload is caught here.

    Pydantic's own `Base64Bytes` drops characters outside the alphabet instead
    of complaining, which would turn a truncated upload into a few bytes of
    rubbish and spend a model call on it.
    """
    if not isinstance(value, str):
        return value

    try:
        return base64.b64decode(value.strip(), validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError("No se pudo leer el archivo: llegó incompleto") from exc


Base64Content = Annotated[bytes, BeforeValidator(_decoded_base64)]


class ChatAttachment(BaseModel):
    """A photo or a recording sent along with a chat message.

    Typing a job description on a phone is slow, so the work can also arrive as
    a picture of the note it is written on, or as the tradesman saying it out
    loud.
    """

    kind: ChatAttachmentKind
    mime_type: str = Field(max_length=100)
    content: Base64Content = Field(description="The file itself, base64 encoded")

    @model_validator(mode="after")
    def _check_type_and_size(self) -> "ChatAttachment":
        """Reject anything the assistant cannot read, or that is too large."""
        if self.kind == "image":
            allowed, limit, label = IMAGE_MIME_TYPES, MAX_IMAGE_BYTES, "La foto"
        else:
            allowed, limit, label = AUDIO_MIME_TYPES, MAX_AUDIO_BYTES, "El audio"

        if self.mime_type not in allowed:
            raise ValueError(f"{label} tiene un formato que no se puede leer: {self.mime_type}")

        if not self.content:
            raise ValueError(f"{label} llegó vacía")

        if len(self.content) > limit:
            raise ValueError(f"{label} es demasiado grande")

        return self


class ChatRequest(BaseModel):
    """A user message for the Hermes Agent."""

    message: str = Field(
        default="",
        max_length=8000,
        description="User message in natural language. May be empty when something is attached",
    )
    session_id: Optional[str] = Field(
        default=None,
        description="Hermes session id returned by a previous call, to keep conversation context",
    )
    attachments: list[ChatAttachment] = Field(
        default_factory=list,
        max_length=MAX_ATTACHMENTS,
        description="Photos of the job notes, or a recording describing the work",
    )

    @model_validator(mode="after")
    def _has_something_to_answer(self) -> "ChatRequest":
        """A turn needs text or an attachment, and has to fit in one request."""
        if not self.message.strip() and not self.attachments:
            raise ValueError("Escribí un mensaje, o mandá una foto o un audio")

        if sum(len(item.content) for item in self.attachments) > MAX_ATTACHMENT_BYTES:
            raise ValueError("Lo que mandaste pesa demasiado junto: probá de a una cosa")

        return self


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


class LoginRequest(BaseModel):
    """The access key from the private link."""

    key: str = Field(min_length=1, max_length=500)


class LoginResponse(BaseModel):
    """A session to send as `Authorization: Bearer <token>`."""

    token: str
    expires_at: int = Field(description="Unix timestamp when the session ends")


class HealthResponse(BaseModel):
    """Service health and configuration status."""

    status: Literal["ok"] = "ok"
    supabase_configured: bool
    hermes_configured: bool
    gemini_configured: bool
    access_configured: bool


# `BulkPriceUpdateResponse` refers to `MaterialRead`, which is defined below it.
BulkPriceUpdateResponse.model_rebuild()
