"""Budget PDF rendering.

Turns a budget row — the shape `supabase_service.get_budget()` returns, with
its `items` — into a printable A4 quote. The document is built in memory and
returned as bytes, so the endpoint can stream it straight to the browser.
"""

from __future__ import annotations

import logging
import unicodedata
from datetime import date, datetime
from decimal import Decimal, ROUND_HALF_UP
from io import BytesIO
from typing import Any, Optional
# Cells are mini-HTML, so text typed by the user has to be escaped.
from xml.sax.saxutils import escape

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
from services import pricing_service

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

# Currency names, for the note that explains a converted document.
CURRENCY_NAMES = {
    "ARS": "pesos",
    "USD": "dólares",
}

# The line groups, in the order they are printed.
# Work packages carry the bulk of a quote, so they are printed first.
ITEM_GROUPS = (
    ("custom", "Trabajos"),
    ("material", "Materiales"),
    ("task", "Mano de obra"),
)

# A line quoted whole is priced as a job, not by the unit.
WHOLE_JOB_UNIT = "global"

# Budget statuses, as they are printed for the client.
STATUS_LABELS = {
    "draft": "Borrador",
    "sent": "Enviado",
    "accepted": "Aceptado",
    "rejected": "Rechazado",
    "expired": "Vencido",
}

CENTS = Decimal("0.01")

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
    *,
    exchange_rate: Optional[float] = None,
    currency: Optional[str] = None,
) -> list[Any]:
    """Three columns: who issues the budget, who receives it, and the details."""
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
    if exchange_rate:
        meta_lines.append(
            f"<b>Cotización aplicada:</b> dólar blue venta {format_money(exchange_rate, 'ARS')}"
        )

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

    if exchange_rate and currency:
        blocks.append(
            Paragraph(
                f"Importes expresados en {CURRENCY_NAMES.get(currency, currency)} "
                f"convertidos al dólar blue vendedor de {format_money(exchange_rate, 'ARS')}. "
                "La cotización puede variar hasta la aceptación del presupuesto.",
                styles["muted"],
            )
        )
        blocks.append(Spacer(1, 4 * mm))

    if budget.get("description"):
        blocks.append(Paragraph(str(budget["description"]), styles["muted"]))
        blocks.append(Spacer(1, 4 * mm))

    return blocks


def _is_quoted(item: dict[str, Any]) -> bool:
    """False for a line that is only listed, with no price and no total."""
    return item.get("is_quoted", True) is not False


def _is_whole_job(item: dict[str, Any]) -> bool:
    """True when the line is a job priced whole, with no quantity to show."""
    return str(item.get("unit") or "") == WHOLE_JOB_UNIT and _to_float(item.get("quantity")) == 1


def _describe(item: dict[str, Any]) -> str:
    """The description cell: the work, what it covers, and its condition.

    A quote written by hand reads as a title, a few bullets under it and a
    remark next to the price, so the cell is built the same way.
    """
    parts = [f"<b>{escape(str(item.get('description') or ''))}</b>"]

    detail = str(item.get("detail") or "").strip()
    if detail:
        bullets = [line.strip() for line in detail.splitlines() if line.strip()]
        parts.extend(f"• {escape(line)}" for line in bullets)

    note = str(item.get("note") or "").strip()
    if note:
        parts.append(f"<i>{escape(note)}</i>")

    return "<br/>".join(parts)


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
        group_items = [
            item
            for item in items
            if item.get("item_type") == item_type and _is_quoted(item)
        ]
        if not group_items:
            continue

        group_rows.append(len(rows))
        rows.append([Paragraph(f"<b>{label.upper()}</b>", styles["cell"]), "", "", "", ""])

        for item in group_items:
            # A job quoted whole has no quantity worth printing: the reader
            # wants the work described and one price.
            whole_job = _is_whole_job(item)

            rows.append(
                [
                    Paragraph(_describe(item), styles["cell"]),
                    Paragraph("" if whole_job else str(item.get("unit") or ""), styles["cell"]),
                    Paragraph(
                        "" if whole_job else format_quantity(item.get("quantity")),
                        styles["cell_right"],
                    ),
                    Paragraph(
                        ""
                        if whole_job
                        else format_money(item.get("unit_price"), currency),
                        styles["cell_right"],
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


def _supplied_block(
    budget: dict[str, Any],
    styles: dict[str, ParagraphStyle],
) -> list[Any]:
    """Materials the customer buys: what to get, how much, no prices.

    A quote written by hand closes with such a list, so it is printed apart
    from the priced table and adds nothing to the total.
    """
    items = [item for item in (budget.get("items") or []) if not _is_quoted(item)]

    if not items:
        return []

    rows: list[list[Any]] = [
        [
            Paragraph("<b>Material</b>", styles["cell"]),
            Paragraph("<b>Cantidad</b>", styles["cell_right"]),
            Paragraph("<b>Unidad</b>", styles["cell"]),
        ]
    ]

    for item in items:
        # Some entries are just a name — "madera" — with nothing to measure.
        unit = str(item.get("unit") or "")
        measured = bool(unit) or _to_float(item.get("quantity")) != 1

        rows.append(
            [
                Paragraph(_describe(item), styles["cell"]),
                Paragraph(
                    format_quantity(item.get("quantity")) if measured else "",
                    styles["cell_right"],
                ),
                Paragraph(escape(unit), styles["cell"]),
            ]
        )

    table = Table(rows, colWidths=[104 * mm, 25 * mm, 41 * mm], repeatRows=1)
    table.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("LINEBELOW", (0, 0), (-1, 0), 0.6, BORDER_COLOR),
                ("LINEBELOW", (0, 1), (-1, -2), 0.4, BORDER_COLOR),
                ("BACKGROUND", (0, 0), (-1, 0), BAND_COLOR),
            ]
        )
    )

    return [
        Spacer(1, 8 * mm),
        Paragraph("MATERIALES A CARGO DEL CLIENTE", styles["heading"]),
        Paragraph(
            "Cantidades aproximadas. No están incluidas en el total de arriba.",
            styles["muted"],
        ),
        Spacer(1, 3 * mm),
        table,
    ]


def _totals_block(
    budget: dict[str, Any],
    currency: str,
    styles: dict[str, ParagraphStyle],
) -> list[Any]:
    """Per-group subtotals, then subtotal, tax and total."""
    items = budget.get("items") or []

    rows: list[list[Any]] = []
    for item_type, label in ITEM_GROUPS:
        group_items = [
            item
            for item in items
            if item.get("item_type") == item_type and _is_quoted(item)
        ]
        if not group_items:
            continue

        group_total = sum(_to_float(item.get("line_total")) for item in group_items)
        rows.append(
            [
                Paragraph(label, styles["cell"]),
                Paragraph(format_money(group_total, currency), styles["cell_right"]),
            ]
        )

    rows.append(
        [
            Paragraph("<b>Subtotal</b>", styles["cell"]),
            Paragraph(
                f"<b>{format_money(budget.get('subtotal'), currency)}</b>",
                styles["cell_right"],
            ),
        ]
    )

    # These quotes are written without VAT; the row only earns its place when
    # a rate was actually set.
    prints_tax = _to_float(budget.get("tax_rate")) > 0

    if prints_tax:
        tax_rate = format_quantity(budget.get("tax_rate"))
        rows.append(
            [
                Paragraph(f"IVA ({tax_rate}%)", styles["cell"]),
                Paragraph(format_money(budget.get("tax_amount"), currency), styles["cell_right"]),
            ]
        )

    rows.extend(
        [
            [
                Paragraph("<b>TOTAL</b>", styles["cell"]),
                Paragraph(
                    f"<b>{format_money(budget.get('total'), currency)}</b>", styles["cell_right"]
                ),
            ],
        ]
    )

    # The rule sits above Subtotal, two or three rows from the end depending
    # on whether the VAT row was printed.
    subtotal_row = -3 if prints_tax else -2

    totals = Table(rows, colWidths=[40 * mm, 35 * mm], hAlign="RIGHT")
    totals.setStyle(
        TableStyle(
            [
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("LINEABOVE", (0, subtotal_row), (-1, subtotal_row), 0.6, BORDER_COLOR),
                ("LINEABOVE", (0, -1), (-1, -1), 1.0, BRAND_COLOR),
                ("BACKGROUND", (0, -1), (-1, -1), BAND_COLOR),
            ]
        )
    )

    closing: list[Any] = [
        totals,
        Spacer(1, 8 * mm),
        Paragraph(
            "Los precios incluyen la mano de obra detallada arriba. Los trabajos no "
            "descriptos en este documento se presupuestan aparte.",
            styles["muted"],
        ),
    ]

    # Conditions that are stated rather than charged, e.g. what buying the
    # materials costs, which is a percentage of a value nobody knows yet.
    for sentence in pricing_service.clauses(budget.get("site_factors")):
        closing.append(Spacer(1, 2 * mm))
        closing.append(Paragraph(escape(sentence), styles["muted"]))

    # Keep the totals with the closing note so they are never orphaned.
    return [KeepTogether(closing)]


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------
def convert_budget(budget: dict[str, Any], *, currency: str, exchange_rate: float) -> dict[str, Any]:
    """Return a copy of the budget priced in `currency` at `exchange_rate`.

    Every line is converted and rounded on its own, then the totals are rebuilt
    from those lines, so the printed figures always add up. The tax rate is a
    percentage, so it survives the conversion untouched.
    """
    if exchange_rate <= 0:
        raise PdfServiceError("The exchange rate must be greater than zero")

    rate = Decimal(str(exchange_rate))
    converted_items = []

    for item in budget.get("items") or []:
        unit_price = (Decimal(str(_to_float(item.get("unit_price")))) / rate).quantize(
            CENTS, rounding=ROUND_HALF_UP
        )
        line_total = (Decimal(str(_to_float(item.get("line_total")))) / rate).quantize(
            CENTS, rounding=ROUND_HALF_UP
        )
        converted_items.append(dict(item, unit_price=float(unit_price), line_total=float(line_total)))

    subtotal = sum(
        (Decimal(str(item["line_total"])) for item in converted_items), Decimal("0")
    ).quantize(CENTS, rounding=ROUND_HALF_UP)
    tax_rate = Decimal(str(_to_float(budget.get("tax_rate"))))
    tax_amount = (subtotal * tax_rate / Decimal("100")).quantize(CENTS, rounding=ROUND_HALF_UP)

    return dict(
        budget,
        currency=currency,
        items=converted_items,
        subtotal=float(subtotal),
        tax_amount=float(tax_amount),
        total=float(subtotal + tax_amount),
    )


def build_budget_pdf(
    budget: dict[str, Any],
    client: Optional[dict[str, Any]] = None,
    *,
    currency: Optional[str] = None,
    exchange_rate: Optional[float] = None,
) -> bytes:
    """Render a budget as a PDF and return its bytes.

    `budget` is a row from `supabase_service.get_budget()`, including `items`.
    `client` is the matching `clients` row when it is available; the document
    still renders without it.

    Passing a `currency` different from the budget's own converts every amount
    at `exchange_rate` — the blue dollar sell rate — and prints which rate was
    applied, so the reader can check the arithmetic.
    """
    if not isinstance(budget, dict) or not budget.get("id"):
        raise PdfServiceError("A budget with an id is required to build a PDF")

    # The conditions chosen for the job are folded into the prices before
    # anything else, so the document prints what is actually charged.
    budget = pricing_service.apply_site_factors(budget)

    stored_currency = str(budget.get("currency") or settings.default_currency).upper()
    currency = (currency or stored_currency).upper()

    if currency != stored_currency:
        if exchange_rate is None:
            raise PdfServiceError(
                f"An exchange rate is required to print a {stored_currency} budget in {currency}"
            )
        budget = convert_budget(budget, currency=currency, exchange_rate=exchange_rate)
    else:
        # Nothing to convert, so no rate is worth printing either.
        exchange_rate = None

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
    story.extend(
        _parties_block(budget, client, styles, exchange_rate=exchange_rate, currency=currency)
    )
    story.extend(_items_table(budget, currency, styles))
    story.extend(_totals_block(budget, currency, styles))
    story.extend(_supplied_block(budget, styles))

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
