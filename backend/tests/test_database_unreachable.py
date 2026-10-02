"""What the app says when the database is away.

A paused Supabase project takes its hostname down with it, so the request
never leaves the machine. What came back before was the raw errno — "[Errno
16] Device or resource busy" on the server, "[Errno 11001] getaddrinfo failed"
on Windows — printed on screen for a person who has no use for it. The errno
belongs in the log; the screen gets a sentence.
"""

from __future__ import annotations

import logging

import httpx
import pytest

from services import supabase_service
from services.supabase_service import (
    UNREACHABLE_MESSAGE,
    DatabaseUnreachableError,
    SupabaseServiceError,
)

DEAD_HOSTNAME = httpx.ConnectError("[Errno 11001] getaddrinfo failed")
PAUSED_IN_PRODUCTION = OSError(16, "Device or resource busy")


class Unreachable:
    """A database that cannot be reached: every query fails on its way out."""

    def __init__(self, error: Exception) -> None:
        self._error = error

    def execute(self):
        raise self._error

    def __getattr__(self, _name: str):
        # table(), select(), eq(), order(), limit()… all keep building a query
        # that is never going to run.
        return lambda *args, **kwargs: self


class Complaint(Exception):
    """What PostgREST raises when the database answered and said no."""

    message = "duplicate key value violates unique constraint"
    code = "23505"


class Refused:
    """A database that answered, complaining."""

    def execute(self):
        raise Complaint(Complaint.message)

    def __getattr__(self, _name: str):
        return lambda *args, **kwargs: self


@pytest.fixture
def unreachable(monkeypatch: pytest.MonkeyPatch):
    """Point the whole service layer at a database that cannot be reached."""

    def use(error: Exception) -> None:
        monkeypatch.setattr(supabase_service, "get_client", lambda: Unreachable(error))

    return use


# ---------------------------------------------------------------------------
# What the caller is handed
# ---------------------------------------------------------------------------
def test_a_hostname_that_no_longer_exists_reads_as_a_sentence(unreachable):
    unreachable(DEAD_HOSTNAME)

    with pytest.raises(DatabaseUnreachableError) as caught:
        supabase_service.list_budgets()

    assert caught.value.message == UNREACHABLE_MESSAGE
    assert "Errno" not in caught.value.message


def test_the_shape_production_fails_in_is_recognised(unreachable):
    # Linux reports the same missing host as a busy device.
    unreachable(PAUSED_IN_PRODUCTION)

    with pytest.raises(DatabaseUnreachableError):
        supabase_service.list_budgets()


def test_a_timeout_counts_as_unreachable_too(unreachable):
    unreachable(httpx.ReadTimeout("timed out"))

    with pytest.raises(DatabaseUnreachableError):
        supabase_service.list_clients()


def test_a_transport_failure_the_client_re_raised_is_still_recognised(unreachable):
    # Some versions of the Supabase client wrap the failure in their own error.
    wrapped = RuntimeError("request failed")
    wrapped.__cause__ = DEAD_HOSTNAME
    unreachable(wrapped)

    with pytest.raises(DatabaseUnreachableError):
        supabase_service.list_materials()


def test_counting_materials_fails_the_same_way(unreachable):
    unreachable(DEAD_HOSTNAME)

    with pytest.raises(DatabaseUnreachableError):
        supabase_service.count_materials()


def test_the_database_complaining_keeps_its_own_message(monkeypatch):
    # A reply, however unhappy, is not the same as no reply: the code behind it
    # is what turns a duplicate into a 409 further up.
    monkeypatch.setattr(supabase_service, "get_client", lambda: Refused())

    with pytest.raises(SupabaseServiceError) as caught:
        supabase_service.list_materials()

    assert not isinstance(caught.value, DatabaseUnreachableError)
    assert caught.value.code == "23505"
    assert "unique constraint" in caught.value.message


def test_the_errno_is_kept_where_it_is_useful(unreachable, caplog):
    unreachable(DEAD_HOSTNAME)

    with caplog.at_level(logging.ERROR, logger="services.supabase_service"):
        with pytest.raises(DatabaseUnreachableError):
            supabase_service.list_budgets()

    assert "11001" in caplog.text
    assert "list budgets" in caplog.text


# ---------------------------------------------------------------------------
# What reaches the screen
# ---------------------------------------------------------------------------
def test_the_budget_list_asks_to_try_again_later(api, unreachable):
    unreachable(PAUSED_IN_PRODUCTION)

    response = api.get("/api/budgets")

    # Nothing is wrong with the request, so this is not a 4xx, and the database
    # being away is not a bad gateway either.
    assert response.status_code == 503
    assert response.json()["detail"] == UNREACHABLE_MESSAGE


def test_nothing_technical_reaches_the_screen(api, unreachable):
    unreachable(PAUSED_IN_PRODUCTION)

    for path in ["/api/budgets", "/api/clients", "/api/materials"]:
        detail = str(api.get(path).json()["detail"])
        assert "Errno" not in detail, path
        assert "busy" not in detail, path
