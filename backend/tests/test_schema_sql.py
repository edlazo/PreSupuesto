"""The SQL that gets pasted into Supabase by hand has to parse.

Migrations are run manually in the Supabase SQL editor, so a syntax error
would only surface there. pglast uses PostgreSQL's own parser, which catches
it here instead. It checks syntax, not that tables or columns exist.
"""

import re
from pathlib import Path

import pytest
from pglast import parse_sql
from pglast.parser import ParseError

SUPABASE = Path(__file__).resolve().parents[2] / "supabase"
MIGRATIONS = sorted((SUPABASE / "migrations").glob("*.sql"))


@pytest.mark.parametrize("path", [SUPABASE / "schema.sql", *MIGRATIONS], ids=lambda p: p.name)
def test_the_sql_parses(path):
    try:
        statements = parse_sql(path.read_text(encoding="utf-8"))
    except ParseError as exc:
        pytest.fail(f"{path.name}: {exc}")
    assert statements, f"{path.name} has no statements"


def test_migrations_are_numbered_in_order():
    numbers = [int(re.match(r"(\d+)_", path.name).group(1)) for path in MIGRATIONS]
    assert numbers == list(range(1, len(numbers) + 1)), [path.name for path in MIGRATIONS]


def test_a_broken_statement_is_caught():
    with pytest.raises(ParseError):
        parse_sql("alter table public.budgets add column;")
