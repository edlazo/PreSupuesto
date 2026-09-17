"""Blue dollar rates, read from dolarapi.com.

The rate moves a few times a day, so the answer is cached briefly: the header
widget and the budget preview both ask for it, and a page reload should not
mean a new round trip to the upstream API.
"""

from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Optional

import httpx

logger = logging.getLogger(__name__)

BLUE_RATE_URL = "https://dolarapi.com/v1/dolares/blue"
REQUEST_TIMEOUT_SECONDS = 10.0

# How long a fetched rate is served before going back to the upstream API.
CACHE_TTL_SECONDS = 60.0


class CurrencyServiceError(Exception):
    """Raised when the blue dollar rate cannot be read."""


@dataclass(frozen=True)
class BlueRate:
    """One quote of the blue dollar."""

    buy: float
    sell: float
    updated_at: Optional[datetime]
    source: str = "dolarapi.com"


_cached_rate: Optional[BlueRate] = None
_cached_at: float = 0.0
_cache_lock = threading.Lock()


def _parse_updated_at(value: Any) -> Optional[datetime]:
    """Read the upstream timestamp, which is ISO 8601 with a trailing Z."""
    if not value:
        return None

    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        logger.warning("Unexpected date from %s: %r", BLUE_RATE_URL, value)
        return None


def _parse_rate(payload: Any) -> BlueRate:
    """Turn the upstream body into a BlueRate, or fail loudly."""
    if not isinstance(payload, dict):
        raise CurrencyServiceError("La respuesta de la API de cotizaciones no es válida")

    try:
        buy = float(payload["compra"])
        sell = float(payload["venta"])
    except (KeyError, TypeError, ValueError) as exc:
        raise CurrencyServiceError(
            "La API de cotizaciones no devolvió los valores de compra y venta"
        ) from exc

    if buy <= 0 or sell <= 0:
        raise CurrencyServiceError("La API de cotizaciones devolvió valores en cero")

    return BlueRate(buy=buy, sell=sell, updated_at=_parse_updated_at(payload.get("fechaActualizacion")))


def _cached() -> Optional[BlueRate]:
    """Return the cached rate while it is still fresh."""
    with _cache_lock:
        if _cached_rate is not None and (time.monotonic() - _cached_at) < CACHE_TTL_SECONDS:
            return _cached_rate
    return None


def _store(rate: BlueRate) -> None:
    """Remember a freshly fetched rate."""
    global _cached_rate, _cached_at

    with _cache_lock:
        _cached_rate = rate
        _cached_at = time.monotonic()


async def get_blue_rate(*, force_refresh: bool = False) -> BlueRate:
    """Return the current blue dollar rate.

    A cached value less than `CACHE_TTL_SECONDS` old is reused unless
    `force_refresh` is set, which is what the widget's refresh button does.
    """
    if not force_refresh:
        cached = _cached()
        if cached is not None:
            return cached

    try:
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SECONDS) as client:
            response = await client.get(BLUE_RATE_URL)
    except httpx.RequestError as exc:
        logger.error("Could not reach %s: %s", BLUE_RATE_URL, exc)
        raise CurrencyServiceError(
            "No se pudo contactar a la API de cotizaciones del dólar blue"
        ) from exc

    if response.status_code >= 400:
        logger.error("%s answered %s", BLUE_RATE_URL, response.status_code)
        raise CurrencyServiceError(
            f"La API de cotizaciones respondió {response.status_code}"
        )

    try:
        payload = response.json()
    except ValueError as exc:
        raise CurrencyServiceError("La API de cotizaciones no devolvió JSON") from exc

    rate = _parse_rate(payload)
    _store(rate)

    return rate


def clear_cache() -> None:
    """Drop the cached rate. Used by tests."""
    global _cached_rate, _cached_at

    with _cache_lock:
        _cached_rate = None
        _cached_at = 0.0
