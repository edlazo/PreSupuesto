"""Budget PDF rendering.

Turns a budget row — the shape `supabase_service.get_budget()` returns, with
its `items` — into a printable A4 quote. The document is built in memory and
returned as bytes, so the endpoint can stream it straight to the browser.
"""

from __future__ import annotations

import logging
import unicodedata
from datetime import date, datetime
from io import BytesIO
from typing import Any, Optional

from reportlab.lib import colors
from reportlab.lib.enums import TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    KeepTogether,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from config import settings

logger = logging.getLogger(__name__)

# Matches the primary color of the web interface.
BRAND_COLOR = colors.HexColor("#b45309")
TEXT_COLOR = colors.HexColor("#0f172a")
MUTED_COLOR = colors.HexColor("#64748b")
BORDER_COLOR = colors.HexColor("#e2e8f0")
BAND_COLOR = colors.HexColor("#f8fafc")

# Symbols as they are written in Argentina: pesos take the plain sign, and
# dollars are marked "u$s" to tell the two apart.
CURRENCY_SYMBOLS = {
    "ARS": "$",
    "USD": "u$s",
}

# The line groups, in the order they are printed.
ITEM_GROUPS = (
    ("material", "Materiales"),
    ("task", "Mano de obra"),
    ("custom", "Otros costos"),
)

# Budget statuses, as they are printed for the client.
STATUS_LABELS = {
    "draft": "Borrador",
    "sent": "Enviado",
    "accepted": "Aceptado",
    "rejected": "Rechazado",
    "expired": "Vencido",
}

# Month abbreviations, so the date does not depend on the server locale.
MONTHS = (
    "ene", "feb", "mar", "abr", "may", "jun",
    "jul", "ago", "sep", "oct", "nov", "dic",
)


class PdfServiceError(Exception):
    """Raised when a budget cannot be rendered."""


# ---------------------------------------------------------------------------
# Formatting helpers
# ---------------------------------------------------------------------------
def _to_float(value: Any) -> float:
    """Read a numeric column that may arrive as a string from PostgREST."""
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _localize_number(text: str) -> str:
    """Rewrite 1,234.56 as the Argentine 1.234,56."""
    return text.replace(",", "\x00").replace(".", ",").replace("\x00", ".")


def format_money(amount: Any, currency: str) -> str:
    """Format an amount with its currency symbol, e.g. "$ 2.599,44"."""
    code = currency.upper()
    symbol = CURRENCY_SYMBOLS.get(code, code)
    amount_text = _localize_number(format(_to_float(amount), ",.2f"))
    return f"{symbol} {amount_text}"


def format_quantity(value: Any) -> str:
    """Format a quantity without trailing zeros: 11.000 -> "11", 2.500 -> "2,5"."""
    number = _to_float(value)
    text = _localize_number(format(number, ",.3f")).rstrip("0").rstrip(",")
    return text or "0"


def _format_date(value: Any) -> str:
    """Format a date or timestamp as "17 sep 2026"."""
    if value in (None, ""):
        return "—"

    if isinstance(value, (datetime, date)):
        parsed: Optional[date] = value if isinstance(value, date) else value.date()
    else:
        text = str(value).replace("Z", "+00:00")
        try:
            parsed = datetime.fromisoformat(text).date()
        except ValueError:
            try:
                parsed = date.fromisoformat(text[:10])
            except ValueError:
                return str(value)

    return f"{parsed.day} {MONTHS[parsed.month - 1]} {parsed.year}"


# ---------------------------------------------------------------------------
# Styles and page furniture
# ---------------------------------------------------------------------------
def _styles() -> dict[str, ParagraphStyle]:
    """Paragraph styles used across the document."""
    base = getSampleStyleSheet()

    return {
        "title": ParagraphStyle(
            "BudgetTitle",
            parent=base["Title"],
            fontName="Helvetica-Bold",
            fontSize=20,
            leading=24,
            alignment=0,
            textColor=TEXT_COLOR,
            spaceAfter=2,
        ),
        "subtitle": ParagraphStyle(
            "BudgetSubtitle",
            parent=base["Normal"],
            fontSize=10,
            leading=14,
            textColor=MUTED_COLOR,
        ),
        "heading": ParagraphStyle(
            "BudgetHeading",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=9,
            leading=12,
            textColor=BRAND_COLOR,
            spaceBefore=10,
            spaceAfter=4,
        ),
        "body": ParagraphStyle(
            "BudgetBody",
            parent=base["Normal"],
            fontSize=9.5,
            leading=13,
            textColor=TEXT_COLOR,
        ),
        "muted": ParagraphStyle(
            "BudgetMuted",
            parent=base["Normal"],
            fontSize=8.5,
            leading=12,
            textColor=MUTED_COLOR,
        ),
        "cell": ParagraphStyle(
            "BudgetCell",
            parent=base["Normal"],
            fontSize=9,
            leading=12,
            textColor=TEXT_COLOR,
        ),
        "cell_right": ParagraphStyle(
            "BudgetCellRight",
            parent=base["Normal"],
            fontSize=9,
            leading=12,
            alignment=TA_RIGHT,
            textColor=TEXT_COLOR,
        ),
    }


def _draw_page_furniture(canvas: Any, doc: Any) -> None:
    """Draw the brand rule at the top and the footer on every page."""
    canvas.saveState()

    canvas.setStrokeColor(BRAND_COLOR)
    canvas.setLineWidth(3)
    canvas.line(
        doc.leftMargin,
        A4[1] - doc.topMargin + 8 * mm,
        A4[0] - doc.rightMargin,
        A4[1] - doc.topMargin + 8 * mm,
    )

    canvas.setFont("Helvetica", 7.5)
    canvas.setFillColor(MUTED_COLOR)
    canvas.drawString(doc.leftMargin, 12 * mm, settings.company_name)
    canvas.drawRightString(
        A4[0] - doc.rightMargin, 12 * mm, f"Página {canvas.getPageNumber()}"
    )

    canvas.restoreState()


# ---------------------------------------------------------------------------
# Document sections
# ---------------------------------------------------------------------------
def _header_block(budget: dict[str, Any], styles: dict[str, ParagraphStyle]) -> list[Any]:
    """Title, budget number and status."""
    number = budget.get("budget_number")
    title = budget.get("title") or "Presupuesto"

    return [
        Paragraph(
            f"Presupuesto #{number}" if number else "Presupuesto", styles["title"]
        ),
        Paragraph(title, styles["subtitle"]),
        Spacer(1, 6 * mm),
    ]


def _parties_block(
    budget: dict[str, Any],
    client: Optional[dict[str, Any]],
    styles: dict[str, ParagraphStyle],
) -> list[Any]:
    """Two columns: who issues the budget, and who receives it."""
    issuer_lines = [f"<b>{settings.company_name}</b>"]
    for value in (
        settings.company_tax_id,
        settings.company_address,
        settings.company_email,
        settings.company_phone,
    ):
        if value:
            issuer_lines.append(value)

    if client:
        client_lines = [f"<b>{client.get('full_name') or 'Cliente'}</b>"]
        for value in (
            client.get("company_name"),
            client.get("tax_id"),
            client.get("address"),
            client.get("city"),
            client.get("email"),
            client.get("phone"),
        ):
            if value:
                client_lines.append(str(value))
    else:
        client_lines = ["<b>Cliente</b>", "—"]

    status = str(budget.get("status") or "draft")
    meta_lines = [
        f"<b>Fecha:</b> {_format_date(budget.get('created_at'))}",
        f"<b>Estado:</b> {STATUS_LABELS.get(status, status.capitalize())}",
    ]
    if budget.get("valid_until"):
        meta_lines.append(
            f"<b>Válido hasta:</b> {_format_date(budget.get('valid_until'))}"
        )
    if budget.get("site_address"):
        meta_lines.append(f"<b>Obra:</b> {budget['site_address']}")

    table = Table(
        [
            [
                Paragraph("DE", styles["heading"]),
                Paragraph("PARA", styles["heading"]),
                Paragraph("DATOS", styles["heading"]),
            ],
            [
                Paragraph("<br/>".join(issuer_lines), styles["body"]),
                Paragraph("<br/>".join(client_lines), styles["body"]),
                Paragraph("<br/>".join(meta_lines), styles["body"]),
            ],
        ],
        colWidths=[58 * mm, 58 * mm, 54 * mm],
    )
    table.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
            ]
        )
    )

    blocks: list[Any] = [table, Spacer(1, 6 * mm)]

    if budget.get("description"):
        blocks.append(Paragraph(str(budget["description"]), styles["muted"]))
        blocks.append(Spacer(1, 4 * mm))

    return blocks


def _items_table(
    budget: dict[str, Any],
    currency: str,
    styles: dict[str, ParagraphStyle],
) -> list[Any]:
    """The line table, with one banded section per group."""
    items = budget.get("items") or []

    # The header prints on a dark band: a Paragraph carries its own color, so
    # the white has to be set here rather than through the table style.
    def header_cell(text: str, right: bool = False) -> Paragraph:
        return Paragraph(
            f"<b><font color='#ffffff'>{text}</font></b>",
            styles["cell_right"] if right else styles["cell"],
        )

    rows: list[list[Any]] = [
        [
            header_cell("Descripción"),
            header_cell("Unidad"),
            header_cell("Cant.", right=True),
            header_cell("Precio unit.", right=True),
            header_cell("Total", right=True),
        ]
    ]

    # Rows that carry a group title, so they can be styled as bands.
    group_rows: list[int] = []

    for item_type, label in ITEM_GROUPS:
        group_items = [item for item in items if item.get("item_type") == item_type]
        if not group_items:
            continue

        group_rows.append(len(rows))
        rows.append([Paragraph(f"<b>{label.upper()}</b>", styles["cell"]), "", "", "", ""])

        for item in group_items:
            rows.append(
                [
                    Paragraph(str(item.get("description") or ""), styles["cell"]),
                    Paragraph(str(item.get("unit") or ""), styles["cell"]),
                    Paragraph(format_quantity(item.get("quantity")), styles["cell_right"]),
                    Paragraph(
                        format_money(item.get("unit_price"), currency), styles["cell_right"]
                    ),
                    Paragraph(
                        format_money(item.get("line_total"), currency), styles["cell_right"]
                    ),
                ]
            )

    if len(rows) == 1:
        return [
            Paragraph("Este presupuesto todavía no tiene ítems.", styles["muted"]),
            Spacer(1, 4 * mm),
        ]

    table = Table(rows, colWidths=[78 * mm, 18 * mm, 20 * mm, 27 * mm, 27 * mm], repeatRows=1)

    style = [
        ("BACKGROUND", (0, 0), (-1, 0), TEXT_COLOR),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("LINEBELOW", (0, 1), (-1, -1), 0.4, BORDER_COLOR),
    ]
    for row_index in group_rows:
        style.append(("BACKGROUND", (0, row_index), (-1, row_index), BAND_COLOR))
        style.append(("SPAN", (0, row_index), (-1, row_index)))

    table.setStyle(TableStyle(style))

    return [table, Spacer(1, 6 * mm)]


def _totals_block(
    budget: dict[str, Any],
    currency: str,
    styles: dict[str, ParagraphStyle],
) -> list[Any]:
    """Per-group subtotals, then subtotal, tax and total."""
    items = budget.get("items") or []

    rows: list[list[Any]] = []
    for item_type, label in ITEM_GROUPS:
        group_items = [item for item in items if item.get("item_type") == item_type]
        if not group_items:
            continue

        group_total = sum(_to_float(item.get("line_total")) for item in group_items)
        rows.append(
            [
                Paragraph(label, styles["cell"]),
                Paragraph(format_money(group_total, currency), styles["cell_right"]),
            ]
        )

    tax_rate = format_quantity(budget.get("tax_rate"))
    rows.extend(
        [
            [
                Paragraph("<b>Subtotal</b>", styles["cell"]),
                Paragraph(
                    f"<b>{format_money(budget.get('subtotal'), currency)}</b>",
                    styles["cell_right"],
                ),
            ],
            [
                Paragraph(f"IVA ({tax_rate}%)", styles["cell"]),
                Paragraph(format_money(budget.get("tax_amount"), currency), styles["cell_right"]),
            ],
            [
                Paragraph("<b>TOTAL</b>", styles["cell"]),
                Paragraph(
                    f"<b>{format_money(budget.get('total'), currency)}</b>", styles["cell_right"]
                ),
            ],
        ]
    )

    totals = Table(rows, colWidths=[40 * mm, 35 * mm], hAlign="RIGHT")
    totals.setStyle(
        TableStyle(
            [
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("LINEABOVE", (0, -3), (-1, -3), 0.6, BORDER_COLOR),
                ("LINEABOVE", (0, -1), (-1, -1), 1.0, BRAND_COLOR),
                ("BACKGROUND", (0, -1), (-1, -1), BAND_COLOR),
            ]
        )
    )

    # Keep the totals with the closing note so they are never orphaned.
    return [
        KeepTogether(
            [
                totals,
                Spacer(1, 8 * mm),
                Paragraph(
                    "Los precios incluyen los materiales y la mano de obra detallados "
                    "arriba. Los trabajos no descriptos en este documento se presupuestan "
                    "aparte.",
                    styles["muted"],
                ),
            ]
        )
    ]


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------
def build_budget_pdf(budget: dict[str, Any], client: Optional[dict[str, Any]] = None) -> bytes:
    """Render a budget as a PDF and return its bytes.

    `budget` is a row from `supabase_service.get_budget()`, including `items`.
    `client` is the matching `clients` row when it is available; the document
    still renders without it.
    """
    if not isinstance(budget, dict) or not budget.get("id"):
        raise PdfServiceError("A budget with an id is required to build a PDF")

    currency = str(budget.get("currency") or settings.default_currency)
    styles = _styles()
    buffer = BytesIO()

    document = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=22 * mm,
        bottomMargin=20 * mm,
        title=(
            f"Presupuesto #{budget.get('budget_number')} — "
            f"{budget.get('title') or ''}"
        ).strip(" —"),
        author=settings.company_name,
        subject="Presupuesto de obra",
    )

    story: list[Any] = []
    story.extend(_header_block(budget, styles))
    story.extend(_parties_block(budget, client, styles))
    story.extend(_items_table(budget, currency, styles))
    story.extend(_totals_block(budget, currency, styles))

    try:
        document.build(story, onFirstPage=_draw_page_furniture, onLaterPages=_draw_page_furniture)
    except Exception as exc:  # a malformed row should not surface as a 500 trace
        logger.exception("Could not render budget %s", budget.get("id"))
        raise PdfServiceError(f"Could not render the budget PDF: {exc}") from exc

    return buffer.getvalue()


def build_filename(budget: dict[str, Any]) -> str:
    """Suggested download name, e.g. "presupuesto-0001-refaccion-de-cocina.pdf".

    The name travels in a Content-Disposition header, which carries no raw
    UTF-8, so accents are folded to ASCII: "refacción" becomes "refaccion".
    """
    number = budget.get("budget_number")
    prefix = f"presupuesto-{int(number):04d}" if isinstance(number, int) else "presupuesto"

    title = str(budget.get("title") or "").lower()
    # NFKD splits "ó" into "o" plus a combining accent, which is then dropped.
    title = "".join(
        character
        for character in unicodedata.normalize("NFKD", title)
        if not unicodedata.combining(character)
    )
    slug = "".join(character if character.isascii() and character.isalnum() else "-" for character in title)
    slug = "-".join(part for part in slug.split("-") if part)[:60]

    return f"{prefix}-{slug}.pdf" if slug else f"{prefix}.pdf"
