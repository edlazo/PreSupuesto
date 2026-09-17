"""Client for the Hermes Agent API server.

Hermes Agent runs as its own process and exposes an OpenAI-compatible HTTP
API (`hermes gateway` with API_SERVER_ENABLED and API_SERVER_KEY set in
~/.hermes/.env, default port 8642). This module sends user messages to that
server and returns the agent reply.

Conversation continuity uses the `X-Hermes-Session-Id` header: the value
returned by one call is sent back on the next one.
"""

from __future__ import annotations

import logging
from typing import Optional

import httpx

from config import settings

logger = logging.getLogger(__name__)

SESSION_HEADER = "X-Hermes-Session-Id"


class HermesServiceError(Exception):
    """Raised when the Hermes Agent API server cannot be reached or fails."""


async def send_chat_message(
    message: str,
    *,
    session_id: Optional[str] = None,
) -> tuple[str, Optional[str], Optional[str]]:
    """Send a message to the agent.

    Returns a tuple of (reply, session_id, model). The session id is the one
    to send on the next call to continue the same conversation.
    """
    if not settings.hermes_configured:
        raise HermesServiceError(
            "HERMES_API_URL and HERMES_API_KEY must be set in backend/.env, "
            "and the Hermes Agent API server must be running"
        )

    url = f"{settings.hermes_api_url.rstrip('/')}/chat/completions"
    headers = {
        "Authorization": f"Bearer {settings.hermes_api_key}",
        "Content-Type": "application/json",
    }
    if session_id:
        headers[SESSION_HEADER] = session_id

    payload = {
        "model": settings.hermes_model,
        "messages": [{"role": "user", "content": message}],
        "stream": False,
    }

    try:
        async with httpx.AsyncClient(timeout=settings.hermes_timeout_seconds) as client:
            response = await client.post(url, json=payload, headers=headers)
    except httpx.RequestError as exc:
        logger.error("Could not reach the Hermes Agent API server at %s: %s", url, exc)
        raise HermesServiceError(f"Could not reach the Hermes Agent API server: {exc}") from exc

    if response.status_code >= 400:
        detail = response.text.strip()
        logger.error("Hermes Agent returned %s: %s", response.status_code, detail)
        raise HermesServiceError(f"Hermes Agent returned {response.status_code}: {detail}")

    try:
        body = response.json()
        reply = body["choices"][0]["message"]["content"]
    except (ValueError, KeyError, IndexError, TypeError) as exc:
        raise HermesServiceError(f"Unexpected response from Hermes Agent: {exc}") from exc

    returned_session = response.headers.get(SESSION_HEADER) or session_id
    model = body.get("model")

    return reply or "", returned_session, model


async def check_health() -> bool:
    """Return True when the Hermes Agent API server answers its health check."""
    if not settings.hermes_api_url:
        return False

    base = settings.hermes_api_url.rstrip("/")
    if base.endswith("/v1"):
        base = base[: -len("/v1")]

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(f"{base}/health")
        return response.status_code == 200
    except httpx.RequestError:
        return False
