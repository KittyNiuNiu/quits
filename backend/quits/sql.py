"""SQLAlchemy implementation of the storage seam.

The only module in the codebase that knows SQL exists. Everything above it
works with the dataclasses from `db.py`, so the ORM never leaks into the
service, the routes or the tests.

**Database-agnostic by construction.** The schema uses portable column types
and the queries use SQLAlchemy Core constructs, so the same code runs on
SQLite today and PostgreSQL later — the connection URL picks the dialect.
The only dialect-specific code is isolated in `_engine_options` and
`_register_dialect_hooks` below, each with the reason it is needed.

Adding PostgreSQL later is: install a driver (`psycopg[binary]`), then set
`QUITS_DATABASE_URL=postgresql+psycopg://user:pass@host/quits`. No change
here.
"""

from __future__ import annotations

import os
from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import (
    ForeignKey,
    Integer,
    String,
    create_engine,
    delete,
    event,
    func,
    select,
    update,
)
from sqlalchemy.engine import Engine, make_url
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker
from sqlalchemy.pool import StaticPool

from quits.db import Expense, ExpenseSplit, Participant, Trip

# SPEC and CLAUDE.md both call for SQLite in a single file by default.
DEFAULT_DATABASE_URL = "sqlite:///./quits.db"

#: Environment variable naming the database to connect to.
DATABASE_URL_ENV = "QUITS_DATABASE_URL"


def database_url() -> str:
    """The configured database, or the default single-file SQLite."""
    return os.environ.get(DATABASE_URL_ENV) or DEFAULT_DATABASE_URL


# --- schema ----------------------------------------------------------------


class Base(DeclarativeBase):
    pass


class TripRow(Base):
    __tablename__ = "trips"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    # SPEC §2: the only credential, so it is what lookups go through.
    token: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    currency_label: Mapped[str] = mapped_column(String(40), nullable=False)
    created_at: Mapped[str] = mapped_column(String(40), nullable=False)
    # Indexed because the SPEC §9 retention job scans on it.
    last_activity_at: Mapped[str] = mapped_column(String(40), nullable=False, index=True)


class ParticipantRow(Base):
    __tablename__ = "participants"

    # An autoincrementing surrogate key, which is what gives creation order a
    # stable tiebreak. Two participants can share a `created_at` to the
    # microsecond, and SPEC §5 breaks rounding ties on creation order, so the
    # order must never fall back to something arbitrary. Portable: SQLite maps
    # this to ROWID, PostgreSQL to IDENTITY.
    seq: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    id: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    trip_id: Mapped[str] = mapped_column(
        ForeignKey("trips.id", ondelete="CASCADE"), index=True, nullable=False
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    created_at: Mapped[str] = mapped_column(String(40), nullable=False)


class ExpenseRow(Base):
    __tablename__ = "expenses"

    seq: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    id: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    trip_id: Mapped[str] = mapped_column(
        ForeignKey("trips.id", ondelete="CASCADE"), index=True, nullable=False
    )
    description: Mapped[str] = mapped_column(String(500), nullable=False)
    # SPEC §5: money is integer cents. No float column anywhere in this schema.
    amount_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    paid_by: Mapped[str] = mapped_column(String(64), nullable=False)
    date: Mapped[str] = mapped_column(String(10), nullable=False)
    category: Mapped[str | None] = mapped_column(String(40), nullable=True)
    split_type: Mapped[str] = mapped_column(String(20), nullable=False)
    created_by: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[str] = mapped_column(String(40), nullable=False)


class SplitRow(Base):
    __tablename__ = "expense_splits"

    expense_id: Mapped[str] = mapped_column(
        ForeignKey("expenses.id", ondelete="CASCADE"), primary_key=True
    )
    participant_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    amount_cents: Mapped[int] = mapped_column(Integer, nullable=False)


# --- row <-> record --------------------------------------------------------


def _trip(row: TripRow) -> Trip:
    return Trip(
        id=row.id,
        token=row.token,
        name=row.name,
        currency_label=row.currency_label,
        created_at=row.created_at,
        last_activity_at=row.last_activity_at,
    )


def _participant(row: ParticipantRow) -> Participant:
    return Participant(
        id=row.id, trip_id=row.trip_id, name=row.name, created_at=row.created_at
    )


def _expense(row: ExpenseRow) -> Expense:
    return Expense(
        id=row.id,
        trip_id=row.trip_id,
        description=row.description,
        amount_cents=row.amount_cents,
        paid_by=row.paid_by,
        date=row.date,
        category=row.category,
        split_type=row.split_type,
        created_by=row.created_by,
        created_at=row.created_at,
    )


# --- the implementation ----------------------------------------------------


class SqlDatabase:
    """One unit of work, bound to one session and one transaction."""

    def __init__(self, session: Session):
        self.session = session

    # --- trips ------------------------------------------------------------

    def add_trip(self, trip: Trip) -> None:
        self.session.add(
            TripRow(
                id=trip.id,
                token=trip.token,
                name=trip.name,
                currency_label=trip.currency_label,
                created_at=trip.created_at,
                last_activity_at=trip.last_activity_at,
            )
        )
        self.session.flush()

    def trip_by_token(self, token: str) -> Trip | None:
        row = self.session.scalar(select(TripRow).where(TripRow.token == token))
        return _trip(row) if row else None

    def any_trips(self) -> bool:
        return self.session.scalar(select(func.count()).select_from(TripRow)) > 0

    def touch_trip(self, trip_id: str, when: str) -> None:
        self.session.execute(
            update(TripRow).where(TripRow.id == trip_id).values(last_activity_at=when)
        )

    # --- participants -----------------------------------------------------

    def participants_of(self, trip_id: str) -> list[Participant]:
        rows = self.session.scalars(
            select(ParticipantRow)
            .where(ParticipantRow.trip_id == trip_id)
            # SPEC §4: canonical ordering. `seq` settles same-timestamp ties.
            .order_by(ParticipantRow.created_at.asc(), ParticipantRow.seq.asc())
        )
        return [_participant(row) for row in rows]

    def participant(self, trip_id: str, participant_id: str) -> Participant | None:
        row = self.session.scalar(
            select(ParticipantRow).where(
                ParticipantRow.trip_id == trip_id, ParticipantRow.id == participant_id
            )
        )
        return _participant(row) if row else None

    def add_participant(self, participant: Participant) -> None:
        self.session.add(
            ParticipantRow(
                id=participant.id,
                trip_id=participant.trip_id,
                name=participant.name,
                created_at=participant.created_at,
            )
        )
        self.session.flush()

    def rename_participant(self, participant_id: str, name: str) -> None:
        self.session.execute(
            update(ParticipantRow).where(ParticipantRow.id == participant_id).values(name=name)
        )

    def remove_participant(self, participant_id: str) -> None:
        self.session.execute(
            delete(ParticipantRow).where(ParticipantRow.id == participant_id)
        )

    # --- expenses ---------------------------------------------------------

    def expenses_of(self, trip_id: str) -> list[Expense]:
        rows = self.session.scalars(
            select(ExpenseRow)
            .where(ExpenseRow.trip_id == trip_id)
            # SPEC §7.17: newest first, with `seq` settling ties.
            .order_by(ExpenseRow.created_at.desc(), ExpenseRow.seq.desc())
        )
        return [_expense(row) for row in rows]

    def expense(self, trip_id: str, expense_id: str) -> Expense | None:
        row = self.session.scalar(
            select(ExpenseRow).where(
                ExpenseRow.trip_id == trip_id, ExpenseRow.id == expense_id
            )
        )
        return _expense(row) if row else None

    def add_expense(self, expense: Expense) -> None:
        self.session.add(
            ExpenseRow(
                id=expense.id,
                trip_id=expense.trip_id,
                description=expense.description,
                amount_cents=expense.amount_cents,
                paid_by=expense.paid_by,
                date=expense.date,
                category=expense.category,
                split_type=expense.split_type,
                created_by=expense.created_by,
                created_at=expense.created_at,
            )
        )
        self.session.flush()

    def update_expense(self, expense_id: str, **fields: object) -> None:
        if not fields:
            return
        self.session.execute(
            update(ExpenseRow).where(ExpenseRow.id == expense_id).values(**fields)
        )

    def remove_expense(self, expense_id: str) -> None:
        # Done explicitly rather than relying on ON DELETE CASCADE, so the
        # behaviour does not depend on whether the engine enforces foreign
        # keys (SQLite only does with a pragma).
        self.session.execute(delete(SplitRow).where(SplitRow.expense_id == expense_id))
        self.session.execute(delete(ExpenseRow).where(ExpenseRow.id == expense_id))

    # --- splits -----------------------------------------------------------

    def splits_of(self, expense_id: str) -> list[ExpenseSplit]:
        rows = self.session.scalars(
            select(SplitRow).where(SplitRow.expense_id == expense_id)
        )
        return [
            ExpenseSplit(row.expense_id, row.participant_id, row.amount_cents) for row in rows
        ]

    def replace_splits(self, expense_id: str, splits: list[tuple[str, int]]) -> None:
        self.session.execute(delete(SplitRow).where(SplitRow.expense_id == expense_id))
        self.session.flush()
        for participant_id, amount_cents in splits:
            self.session.add(
                SplitRow(
                    expense_id=expense_id,
                    participant_id=participant_id,
                    amount_cents=amount_cents,
                )
            )
        self.session.flush()

    def usage_of(self, trip_id: str, participant_id: str) -> tuple[int, int]:
        paid = self.session.scalar(
            select(func.count())
            .select_from(ExpenseRow)
            .where(ExpenseRow.trip_id == trip_id, ExpenseRow.paid_by == participant_id)
        )
        in_split = self.session.scalar(
            select(func.count())
            .select_from(SplitRow)
            .join(ExpenseRow, ExpenseRow.id == SplitRow.expense_id)
            .where(ExpenseRow.trip_id == trip_id, SplitRow.participant_id == participant_id)
        )
        return int(paid or 0), int(in_split or 0)


# --- engine and factory ----------------------------------------------------


def _engine_options(url: str) -> dict:
    """Dialect-specific engine options, isolated here on purpose.

    Everything else in this module is portable; this is the one place that
    needs to know which database it is talking to.
    """
    parsed = make_url(url)
    if not parsed.get_backend_name() == "sqlite":
        return {}

    options: dict = {
        # FastAPI runs the sync endpoints in a threadpool, so connections are
        # used from more than one thread. Other drivers allow this already.
        "connect_args": {"check_same_thread": False},
    }
    if parsed.database in (None, "", ":memory:"):
        # An in-memory SQLite database lives inside its connection, so every
        # pooled connection would otherwise get its own empty database.
        options["poolclass"] = StaticPool
    return options


def _register_dialect_hooks(engine: Engine) -> None:
    """SQLite ignores foreign keys unless asked per connection. Other engines
    enforce them by default, so this applies to SQLite only."""
    if engine.dialect.name != "sqlite":
        return

    @event.listens_for(engine, "connect")
    def _enable_foreign_keys(dbapi_connection, _record):  # pragma: no cover - driver hook
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()


def create_database_engine(url: str | None = None) -> Engine:
    """Build an engine for `url`, defaulting to the configured database."""
    resolved = url or database_url()
    engine = create_engine(resolved, **_engine_options(resolved))
    _register_dialect_hooks(engine)
    return engine


def create_schema(engine: Engine) -> None:
    """Create any missing tables.

    Enough while the schema is new. A schema that has to change under live
    data needs migrations (Alembic) rather than this.
    """
    Base.metadata.create_all(engine)


class SqlDatabaseFactory:
    """Opens one transaction-scoped unit of work per call."""

    def __init__(self, engine: Engine):
        self.engine = engine
        self._sessions = sessionmaker(bind=engine, expire_on_commit=False)

    @contextmanager
    def __call__(self) -> Iterator[SqlDatabase]:
        session = self._sessions()
        try:
            yield SqlDatabase(session)
            session.commit()
        except Exception:
            # A request rejected by SPEC §8 validation must leave nothing
            # behind — no half-written expense, no orphaned participant.
            session.rollback()
            raise
        finally:
            session.close()


def create_database_factory(url: str | None = None) -> SqlDatabaseFactory:
    """Engine plus schema plus factory, which is all the app needs."""
    engine = create_database_engine(url)
    create_schema(engine)
    return SqlDatabaseFactory(engine)
