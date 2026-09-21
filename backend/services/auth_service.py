"""Access without a password: one secret link, then a signed session.

Only one person uses the app, so there are no accounts. The owner hands out a
private link carrying `ACCESS_KEY`; opening it trades the key for a session
token the browser keeps and sends on every request.

A session token is `v1.<expiry>.<signature>`, signed with HMAC-SHA256 under
the access key itself. Nothing is stored server side, and changing
`ACCESS_KEY` voids every link and every session at once — which is how a
leaked link is revoked.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import time
from typing import Optional

from config import settings

TOKEN_VERSION = "v1"

# Shortest key accepted, so a weak placeholder cannot guard the app.
MIN_KEY_LENGTH = 32


class AuthNotConfiguredError(Exception):
    """Raised when ACCESS_KEY is missing or too short to be safe."""


def _key() -> bytes:
    key = settings.access_key.strip()
    if len(key) < MIN_KEY_LENGTH:
        raise AuthNotConfiguredError(
            f"ACCESS_KEY is not set in backend/.env (it needs {MIN_KEY_LENGTH}+ characters)"
        )
    return key.encode("utf-8")


def ensure_configured() -> None:
    """Raise AuthNotConfiguredError unless a usable ACCESS_KEY is set."""
    _key()


def _sign(payload: str) -> str:
    digest = hmac.new(_key(), payload.encode("ascii"), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def key_matches(candidate: str) -> bool:
    """True when `candidate` is the access key. Constant time."""
    return hmac.compare_digest(candidate.strip().encode("utf-8"), _key())


def create_session(now: Optional[float] = None) -> tuple[str, int]:
    """Return a new session token and its expiry, as a Unix timestamp."""
    issued = int(now if now is not None else time.time())
    expires = issued + settings.session_days * 24 * 60 * 60
    payload = f"{TOKEN_VERSION}.{expires}"
    return f"{payload}.{_sign(payload)}", expires


def session_is_valid(token: str, now: Optional[float] = None) -> bool:
    """True for an unexpired token signed with the current access key."""
    parts = token.strip().split(".")
    if len(parts) != 3 or parts[0] != TOKEN_VERSION or not parts[1].isdigit():
        return False

    payload = f"{parts[0]}.{parts[1]}"
    if not hmac.compare_digest(parts[2], _sign(payload)):
        return False

    current = now if now is not None else time.time()
    return int(parts[1]) > current
