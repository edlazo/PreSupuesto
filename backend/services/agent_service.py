"""Chat routing between Hermes Agent and the Gemini fallback.

The Hermes Agent gateway is the primary engine: it owns the conversation and
reaches the budgeting tools over MCP. When that gateway is unreachable — not
running, wrong URL, or answering 5xx — this module runs the same tools here
instead, driving them with the Gemini API through function calling.

The two engines differ in where state lives:

* Hermes keeps the transcript itself and hands back a session id;
* the Gemini path keeps the transcript in this process, under a session id
  prefixed with `gemini-`.

A session therefore stays on the engine that owns it for as long as that engine
is available, so a fallback conversation is not silently cut in half when the
gateway comes back.
"""

from __future__ import annotations

import json
import logging
import threading
from collections import OrderedDict
from functools import partial
from dataclasses import dataclass
from typing import Any, Literal, Optional
from uuid import uuid4

import anyio

from config import settings
from services import hermes_service
from services.hermes_service import HermesUnavailableError
from tools.budget_tools import TOOL_SCHEMAS, dispatch_tool

logger = logging.getLogger(__name__)

GEMINI_SESSION_PREFIX = "gemini-"

# Upper bound on the tool round trips one message may trigger, so a model that
# keeps calling tools cannot loop forever.
MAX_TOOL_ROUNDS = 8

# A busy model answers 503 "high demand"; this is the last line of defence, so
# each model gets a second try before moving on to the next one in the chain.
GEMINI_ATTEMPTS_PER_MODEL = 2
GEMINI_RETRY_DELAY_SECONDS = 1.5

# In-process transcripts for the fallback. They are lost on restart, which is
# acceptable for a fallback path; Hermes is what persists conversations.
MAX_SESSIONS = 200
MAX_HISTORY_ENTRIES = 40

SYSTEM_INSTRUCTION = """
You are the PreSupuesto budgeting assistant for a construction and renovation
business. You help the user price jobs and turn them into stored budgets.

Write every reply in the same language as the user's latest message.

How a budget is written here:
* the work is quoted as work packages: a described job with one round price
  (`description` + `unit_price`, optional `detail` bullets and a `note`). Only
  the user knows those prices — ask for them, never make one up;
* labour charged by quantity comes from list_standard_tasks (`task_code`);
* materials are NEVER priced. The customer buys them; the budget only tells
  them what will be bought. Add each one as a `material` line (a name, with a
  quantity and unit when the user gives them) and never mention what it costs.
  A quantity that is not a plain number — "1/2", "2 o 3", "a definir" — goes in
  `quantity_text`, exactly as the user said it.
  list_materials only helps spell a name and pick its unit.

Always use the tools instead of guessing:
* never invent a price or a catalog code;
* price a job with calculate_estimate before quoting figures;
* find or create the client with list_clients / create_client before storing a
  budget, since create_budget needs a client_id;
* store a budget only when the user asks for one.

A tool answering with an "error" field means the call failed: read the message,
fix the arguments and try again, or tell the user what is missing.

Never do the arithmetic yourself; report the totals the tool returns. The
total is the work and the labour only — the materials list adds nothing.

Quantities use the catalog units (m2, m3, kg, m, bolsa, balde, u). Amounts are
in {currency}.
Keep replies short: a line per figure, then the total.
""".strip()


class AgentError(Exception):
    """Raised when no engine could answer the message."""


@dataclass(frozen=True)
class AgentReply:
    """One answer, plus what produced it."""

    reply: str
    session_id: Optional[str]
    model: Optional[str]
    engine: Literal["hermes", "gemini"]


# ---------------------------------------------------------------------------
# Session storage for the Gemini path
# ---------------------------------------------------------------------------
_sessions: "OrderedDict[str, list[Any]]" = OrderedDict()
_sessions_lock = threading.Lock()


def _is_gemini_session(session_id: Optional[str]) -> bool:
    """True when this session belongs to the Gemini fallback."""
    return bool(session_id and session_id.startswith(GEMINI_SESSION_PREFIX))


def _load_history(session_id: Optional[str]) -> list[Any]:
    """Return a copy of the stored transcript for a session."""
    if not _is_gemini_session(session_id):
        return []

    with _sessions_lock:
        history = _sessions.get(session_id or "")
        if history is None:
            return []
        _sessions.move_to_end(session_id or "")
        return list(history)


def _save_history(session_id: str, history: list[Any]) -> None:
    """Store a transcript, trimming both its length and the session count."""
    with _sessions_lock:
        _sessions[session_id] = history[-MAX_HISTORY_ENTRIES:]
        _sessions.move_to_end(session_id)

        while len(_sessions) > MAX_SESSIONS:
            _sessions.popitem(last=False)


# ---------------------------------------------------------------------------
# Gemini engine
# ---------------------------------------------------------------------------
_client: Any = None
_client_lock = threading.Lock()


def _get_client() -> Any:
    """Return the shared Gemini client, creating it on first use."""
    global _client

    if _client is not None:
        return _client

    with _client_lock:
        if _client is None:
            if not settings.gemini_configured:
                raise AgentError("GEMINI_API_KEY must be set in backend/.env")

            try:
                from google import genai
            except ImportError as exc:  # pragma: no cover - dependency missing
                raise AgentError(
                    "The google-genai package is required for the Gemini fallback: "
                    "pip install -r requirements.txt"
                ) from exc

            _client = genai.Client(api_key=settings.gemini_api_key)

    return _client


def _build_config() -> Any:
    """Build the generation config that exposes the budgeting tools."""
    from google.genai import types

    # The tool schemas are plain JSON Schema, which `parameters_json_schema`
    # takes as-is — no lossy conversion to the SDK's Schema type.
    declarations = [
        types.FunctionDeclaration(
            name=schema["name"],
            description=schema["description"],
            parameters_json_schema=schema["parameters"],
        )
        for schema in TOOL_SCHEMAS
    ]

    return types.GenerateContentConfig(
        system_instruction=SYSTEM_INSTRUCTION.format(currency=settings.default_currency),
        tools=[types.Tool(function_declarations=declarations)],
        # Tools are dispatched by this module, not by the SDK.
        automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
        temperature=0.2,
    )


def _tool_response_payload(raw_result: str) -> dict[str, Any]:
    """Shape a tool's JSON string into the dict a function response needs."""
    try:
        parsed = json.loads(raw_result)
    except json.JSONDecodeError:
        return {"result": raw_result}

    return parsed if isinstance(parsed, dict) else {"result": parsed}


async def _generate(client: Any, contents: list[Any], config: Any) -> tuple[Any, str]:
    """Call Gemini, surviving the transient failures a fallback should survive.

    Each model in the chain gets `GEMINI_ATTEMPTS_PER_MODEL` tries before the
    next one is used. Returns the response and the model that produced it.
    """
    from google.genai import errors

    last_error: Optional[Exception] = None

    for model in settings.gemini_model_chain:
        for attempt in range(GEMINI_ATTEMPTS_PER_MODEL):
            try:
                with anyio.fail_after(settings.gemini_timeout_seconds):
                    response = await client.aio.models.generate_content(
                        model=model,
                        contents=contents,
                        config=config,
                    )
                return response, model
            except TimeoutError as exc:
                raise AgentError("Gemini took too long to answer") from exc
            except errors.ServerError as exc:
                # 5xx, typically "high demand" on a busy model. Worth a retry.
                last_error = exc
                logger.warning("Gemini model %s attempt %s failed: %s", model, attempt + 1, exc)
                await anyio.sleep(GEMINI_RETRY_DELAY_SECONDS)
            except errors.ClientError as exc:
                # Rate limits and quota are counted per model, so the next model
                # in the chain may well answer. Anything else — a bad request,
                # a bad key — will fail the same way everywhere.
                if getattr(exc, "code", None) != 429:
                    logger.error("Gemini call failed on %s: %s", model, exc)
                    raise AgentError(f"Gemini failed: {exc}") from exc

                last_error = exc
                logger.warning("Gemini model %s is rate limited, trying the next one", model)
                break
            except Exception as exc:
                logger.error("Gemini call failed on %s: %s", model, exc)
                raise AgentError(f"Gemini failed: {exc}") from exc

    raise AgentError(f"Every Gemini model is unavailable: {last_error}")


async def _run_gemini(message: str, session_id: Optional[str]) -> AgentReply:
    """Answer a message with Gemini, running tool calls locally in a loop."""
    from google.genai import types

    client = _get_client()
    config = _build_config()

    contents: list[Any] = _load_history(session_id)
    contents.append(types.Content(role="user", parts=[types.Part.from_text(text=message)]))

    effective_session = (
        session_id if _is_gemini_session(session_id) else f"{GEMINI_SESSION_PREFIX}{uuid4().hex}"
    )

    answering_model = settings.gemini_model

    for _ in range(MAX_TOOL_ROUNDS):
        response, answering_model = await _generate(client, contents, config)

        candidate_content = (
            response.candidates[0].content
            if response.candidates and response.candidates[0].content
            else None
        )
        if candidate_content is None:
            raise AgentError("Gemini returned an empty response")

        contents.append(candidate_content)

        calls = response.function_calls or []
        if not calls:
            _save_history(effective_session, contents)
            return AgentReply(
                reply=(response.text or "").strip(),
                session_id=effective_session,
                model=answering_model,
                engine="gemini",
            )

        # The tools reach Supabase through a synchronous client, so they run in
        # a worker thread to keep the event loop free.
        response_parts = []
        for call in calls:
            name = call.name or ""
            arguments = dict(call.args or {})
            logger.info("Gemini fallback tool call: %s", name)

            result = await anyio.to_thread.run_sync(partial(dispatch_tool, name, arguments))
            response_parts.append(
                types.Part.from_function_response(
                    name=name,
                    response=_tool_response_payload(result),
                )
            )

        contents.append(types.Content(role="user", parts=response_parts))

    _save_history(effective_session, contents)
    raise AgentError(
        f"The agent kept calling tools after {MAX_TOOL_ROUNDS} rounds without answering"
    )


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------
async def send_message(message: str, *, session_id: Optional[str] = None) -> AgentReply:
    """Answer a user message, preferring Hermes and falling back to Gemini."""
    # A fallback session stays on Gemini while Gemini is available.
    if _is_gemini_session(session_id) and settings.gemini_configured:
        return await _run_gemini(message, session_id)

    hermes_error: Optional[Exception] = None

    try:
        reply, returned_session, model = await hermes_service.send_chat_message(
            message,
            # A gemini session id means nothing to Hermes; start fresh there.
            session_id=None if _is_gemini_session(session_id) else session_id,
        )
        return AgentReply(
            reply=reply,
            session_id=returned_session,
            model=model,
            engine="hermes",
        )
    except HermesUnavailableError as exc:
        hermes_error = exc
        logger.warning("Hermes Agent unavailable, falling back to Gemini: %s", exc)

    if not settings.gemini_configured:
        raise AgentError(
            f"{hermes_error} — and no GEMINI_API_KEY is set in backend/.env for the fallback"
        )

    return await _run_gemini(message, None)
