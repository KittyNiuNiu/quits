"""The storage seam.

This module defines *what* storage must do, in plain dataclasses and a
protocol. It knows nothing about SQL, SQLAlchemy or any particular engine —
`sql.py` is the only module that does.

The records mirror SPEC §4.

Two rules this protocol exists to enforce:

- **Writes are addressed by id, never by mutating a returned record.** The
  records handed back are detached snapshots. An earlier in-memory store
  returned the live objects, so `expense.amount_cents = x` happened to persist;
  against a database that is a silent no-op. Making every write an explicit
  call keeps that class of bug impossible.
- **Ordering is a storage concern.** `participants_of` must return ascending
  creation order, because SPEC §5 breaks rounding ties on it, and
  `expenses_of` newest first (SPEC §7.17). SQL expresses these as ORDER BY;
  the service simply relies on them.
"""

from __future__ import annotations

from contextlib import AbstractContextManager
from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class Trip:
    id: str
    token: str
    name: str
    currency_label: str
    created_at: str
    last_activity_at: str


@dataclass(frozen=True)
class Participant:
    id: str
    trip_id: str
    name: str
    created_at: str


@dataclass(frozen=True)
class Expense:
    id: str
    trip_id: str
    description: str
    amount_cents: int
    paid_by: str
    date: str
    category: str | None
    split_type: str
    created_by: str
    created_at: str


@dataclass(frozen=True)
class ExpenseSplit:
    expense_id: str
    participant_id: str
    amount_cents: int


class Database(Protocol):
    """One unit of work against storage.

    An instance is scoped to a single request and its methods run inside one
    transaction, so a rejected write leaves nothing behind.
    """

    # --- trips ------------------------------------------------------------

    def add_trip(self, trip: Trip) -> None: ...

    def trip_by_token(self, token: str) -> Trip | None: ...

    def any_trips(self) -> bool:
        """Whether the database holds any trip at all. Used to decide whether
        a fresh install should be seeded with demo data."""
        ...

    def touch_trip(self, trip_id: str, when: str) -> None:
        """SPEC §4 and §9: bump `last_activity_at`. Drives retention."""
        ...

    # --- participants -----------------------------------------------------

    def participants_of(self, trip_id: str) -> list[Participant]:
        """Ascending creation order. SPEC §5 depends on this."""
        ...

    def participant(self, trip_id: str, participant_id: str) -> Participant | None: ...

    def add_participant(self, participant: Participant) -> None: ...

    def rename_participant(self, participant_id: str, name: str) -> None: ...

    def remove_participant(self, participant_id: str) -> None: ...

    # --- expenses ---------------------------------------------------------

    def expenses_of(self, trip_id: str) -> list[Expense]:
        """Newest first. SPEC §7.17."""
        ...

    def expense(self, trip_id: str, expense_id: str) -> Expense | None: ...

    def add_expense(self, expense: Expense) -> None: ...

    def update_expense(self, expense_id: str, **fields: object) -> None:
        """Write the given columns. `created_by` is never among them: the
        original author survives an edit by someone else (SPEC §7.17)."""
        ...

    def remove_expense(self, expense_id: str) -> None:
        """Removes the expense and its split rows."""
        ...

    # --- splits -----------------------------------------------------------

    def splits_of(self, expense_id: str) -> list[ExpenseSplit]: ...

    def replace_splits(self, expense_id: str, splits: list[tuple[str, int]]) -> None:
        """SPEC §7.15: splits are recomputed and replaced wholesale on save."""
        ...

    def usage_of(self, trip_id: str, participant_id: str) -> tuple[int, int]:
        """(paid_count, split_count) — SPEC §7.8 decides deletion on this."""
        ...


class DatabaseFactory(Protocol):
    """Opens one unit of work.

    Used as a context manager: the transaction commits when the block exits
    cleanly and rolls back if anything was raised, so a request rejected by
    SPEC §8 validation leaves no partial write.
    """

    def __call__(self) -> AbstractContextManager[Database]: ...
