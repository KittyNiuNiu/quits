"""Storage configuration, persistence, and the properties that keep this
database-agnostic."""

import os

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Float, Numeric, inspect

from quits.app import create_app
from quits.sql import (
    DATABASE_URL_ENV,
    DEFAULT_DATABASE_URL,
    Base,
    _engine_options,
    create_database_engine,
    create_database_factory,
    database_url,
)


class TestConfiguration:
    def test_defaults_to_a_single_sqlite_file(self, monkeypatch):
        monkeypatch.delenv(DATABASE_URL_ENV, raising=False)
        assert database_url() == DEFAULT_DATABASE_URL
        assert database_url().startswith("sqlite")

    def test_the_environment_variable_selects_the_database(self, monkeypatch):
        monkeypatch.setenv(DATABASE_URL_ENV, "sqlite:///./somewhere-else.db")
        assert database_url() == "sqlite:///./somewhere-else.db"

    def test_an_empty_variable_falls_back_to_the_default(self, monkeypatch):
        monkeypatch.setenv(DATABASE_URL_ENV, "")
        assert database_url() == DEFAULT_DATABASE_URL

    def test_the_url_picks_the_dialect(self):
        assert create_database_engine("sqlite://").dialect.name == "sqlite"

    def test_a_postgres_url_builds_the_postgres_dialect(self):
        # No server needed: creating an engine does not connect. This is the
        # check that the URL alone is enough to change database.
        pytest.importorskip("psycopg", reason="no PostgreSQL driver installed yet")
        engine = create_database_engine("postgresql+psycopg://user:pw@localhost/quits")
        assert engine.dialect.name == "postgresql"


class TestDialectIsolation:
    """SQLite needs a few things other engines do not. Those must not leak
    into the general path, or a future PostgreSQL URL breaks."""

    def test_sqlite_gets_its_threading_workaround(self):
        assert _engine_options("sqlite:///./quits.db")["connect_args"] == {
            "check_same_thread": False
        }

    def test_in_memory_sqlite_shares_one_connection(self):
        # Otherwise each pooled connection gets its own empty database.
        assert "poolclass" in _engine_options("sqlite://")

    def test_a_file_backed_sqlite_does_not_need_that_pool(self):
        assert "poolclass" not in _engine_options("sqlite:///./quits.db")

    def test_other_engines_get_no_sqlite_options(self):
        assert _engine_options("postgresql+psycopg://user:pw@localhost/quits") == {}
        assert _engine_options("mysql+pymysql://user:pw@localhost/quits") == {}

    def test_sqlite_foreign_keys_are_switched_on(self):
        # SQLite ignores foreign keys unless asked, per connection.
        engine = create_database_engine("sqlite://")
        with engine.connect() as connection:
            from sqlalchemy import text

            assert connection.execute(text("PRAGMA foreign_keys")).scalar() == 1


class TestSchema:
    def test_money_is_never_stored_as_a_float(self):
        # SPEC §5: no floating-point arithmetic touches money at any point.
        # A Float or Numeric column would be the one place that could creep
        # back in.
        for table in Base.metadata.tables.values():
            for column in table.columns:
                assert not isinstance(column.type, (Float, Numeric)), (
                    f"{table.name}.{column.name} is {column.type!r}"
                )

    def test_every_amount_column_is_an_integer(self):
        amount_columns = [
            (table.name, column.name, column.type)
            for table in Base.metadata.tables.values()
            for column in table.columns
            if column.name.endswith("_cents")
        ]
        assert amount_columns, "expected money columns to exist"
        for table_name, column_name, column_type in amount_columns:
            assert column_type.python_type is int, f"{table_name}.{column_name}"

    def test_the_schema_is_created_on_a_fresh_database(self):
        engine = create_database_factory("sqlite://").engine
        tables = set(inspect(engine).get_table_names())
        assert {"trips", "participants", "expenses", "expense_splits"} <= tables

    def test_tokens_are_unique_and_indexed(self):
        # SPEC §2: the token is the only credential, and every request looks a
        # trip up by it.
        token = Base.metadata.tables["trips"].columns["token"]
        assert token.unique and token.index


class TestPersistence:
    def test_data_survives_a_new_app_on_the_same_database(self, tmp_path):
        url = f"sqlite:///{tmp_path / 'quits.db'}"

        first = TestClient(create_app(create_database_factory(url)))
        token = first.post(
            "/api/trips",
            json={"name": "Lisbon", "currencyLabel": "EUR", "creatorName": "Anna"},
        ).json()["trip"]["token"]

        # A completely separate app object and engine, as after a restart.
        second = TestClient(create_app(create_database_factory(url)))
        view = second.get(f"/api/trips/{token}").json()
        assert view["trip"]["name"] == "Lisbon"
        assert [p["name"] for p in view["participants"]] == ["Anna"]

    def test_expenses_and_splits_survive_too(self, tmp_path):
        url = f"sqlite:///{tmp_path / 'quits.db'}"
        first = TestClient(create_app(create_database_factory(url)))
        created = first.post(
            "/api/trips",
            json={"name": "Lisbon", "currencyLabel": "EUR", "creatorName": "Anna"},
        ).json()
        token, anna = created["trip"]["token"], created["participant"]["id"]
        max_ = first.post(
            f"/api/trips/{token}/participants", json={"name": "Max"}
        ).json()["id"]
        first.post(
            f"/api/trips/{token}/expenses",
            json={
                "description": "Dinner",
                "amountCents": 1000,
                "paidBy": anna,
                "date": "2026-03-12",
                "category": "food",
                "splitType": "equal",
                "participantIds": [anna, max_],
                "exactCents": {},
                "basisPoints": {},
                "createdBy": anna,
            },
        )

        second = TestClient(create_app(create_database_factory(url)))
        view = second.get(f"/api/trips/{token}").json()
        assert view["totalCents"] == 1000
        assert view["expenses"][0]["splits"] == [
            {"participantId": anna, "amountCents": 500},
            {"participantId": max_, "amountCents": 500},
        ]
        assert view["transfers"] == [
            {"fromParticipantId": max_, "toParticipantId": anna, "amountCents": 500}
        ]

    def test_two_files_are_two_databases(self, tmp_path):
        a = TestClient(create_app(create_database_factory(f"sqlite:///{tmp_path / 'a.db'}")))
        b = TestClient(create_app(create_database_factory(f"sqlite:///{tmp_path / 'b.db'}")))
        token = a.post(
            "/api/trips",
            json={"name": "Lisbon", "currencyLabel": "EUR", "creatorName": "Anna"},
        ).json()["trip"]["token"]
        assert b.get(f"/api/trips/{token}").status_code == 404


class TestOrderingIsAStorageGuarantee:
    """SPEC §5 breaks rounding ties on participant creation order, so the
    database — not the service — has to guarantee it."""

    def test_participants_come_back_in_creation_order(self, database_factory):
        client = TestClient(create_app(database_factory))
        token = client.post(
            "/api/trips",
            json={"name": "Lisbon", "currencyLabel": "EUR", "creatorName": "Anna"},
        ).json()["trip"]["token"]
        for name in ["Max", "Sam", "Bea", "Cal", "Dee", "Eve", "Fin"]:
            client.post(f"/api/trips/{token}/participants", json={"name": name})

        names = [p["name"] for p in client.get(f"/api/trips/{token}").json()["participants"]]
        assert names == ["Anna", "Max", "Sam", "Bea", "Cal", "Dee", "Eve", "Fin"]

    def test_the_odd_cent_goes_to_the_earliest_participant(self, database_factory):
        client = TestClient(create_app(database_factory))
        created = client.post(
            "/api/trips",
            json={"name": "Lisbon", "currencyLabel": "EUR", "creatorName": "Anna"},
        ).json()
        token, anna = created["trip"]["token"], created["participant"]["id"]
        ids = [anna] + [
            client.post(f"/api/trips/{token}/participants", json={"name": n}).json()["id"]
            for n in ["Max", "Sam"]
        ]
        expense = client.post(
            f"/api/trips/{token}/expenses",
            json={
                "description": "Dinner",
                "amountCents": 1000,
                "paidBy": anna,
                "date": "2026-03-12",
                "category": None,
                "splitType": "equal",
                "participantIds": ids,
                "exactCents": {},
                "basisPoints": {},
                "createdBy": anna,
            },
        ).json()
        assert [s["amountCents"] for s in expense["splits"]] == [334, 333, 333]

    def test_expenses_come_back_newest_first(self, database_factory):
        client = TestClient(create_app(database_factory))
        created = client.post(
            "/api/trips",
            json={"name": "Lisbon", "currencyLabel": "EUR", "creatorName": "Anna"},
        ).json()
        token, anna = created["trip"]["token"], created["participant"]["id"]
        for description in ["First", "Second", "Third", "Fourth"]:
            client.post(
                f"/api/trips/{token}/expenses",
                json={
                    "description": description,
                    "amountCents": 100,
                    "paidBy": anna,
                    "date": "2026-03-12",
                    "category": None,
                    "splitType": "equal",
                    "participantIds": [anna],
                    "exactCents": {},
                    "basisPoints": {},
                    "createdBy": anna,
                },
            )
        listed = [e["description"] for e in client.get(f"/api/trips/{token}").json()["expenses"]]
        assert listed == ["Fourth", "Third", "Second", "First"]


def test_importing_the_app_module_does_not_touch_a_database(monkeypatch, tmp_path):
    # `uvicorn quits.app:app` connects; `from quits.app import create_app`
    # must not, or the test suite would create stray database files.
    monkeypatch.setenv(DATABASE_URL_ENV, f"sqlite:///{tmp_path / 'should-not-exist.db'}")
    import importlib

    import quits.app

    importlib.reload(quits.app)
    assert not (tmp_path / "should-not-exist.db").exists()
    assert os.path.exists(tmp_path)
