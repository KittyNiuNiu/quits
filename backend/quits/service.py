"""Domain operations and SPEC §8 validation.

This layer owns every rule. The routes are thin: they hand a request over and
turn the result into JSON. The database is injected, so the same logic runs
against the in-memory mock or a real one.
"""

from __future__ import annotations

import secrets
from dataclasses import dataclass, replace
from datetime import date, datetime, timezone

from quits.balances import Balance, Transfer, compute_balances, compute_transfers
from quits.categories import CATEGORIES
from quits.db import Database, Expense, Participant, Trip
from quits.errors import ApiError, ErrorCode, not_found
from quits.splits import SPLIT_TYPES, resolve_split


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clean(value: object) -> str:
    """Trim a value that is supposed to be a name. Anything that is not a
    string reads as empty, so the §8 "non-empty after trimming" rule catches
    it with the documented code."""
    return value.strip() if isinstance(value, str) else ""


def _same_name(a: str, b: str) -> bool:
    # SPEC §3: unique per trip, case-insensitive, after trimming.
    return a.casefold() == b.casefold()


def _is_money(value: object) -> bool:
    # bool is an int in Python; it is never an amount.
    return isinstance(value, int) and not isinstance(value, bool)


def _new_token() -> str:
    # SPEC §4: cryptographically random, at least 128 bits, URL-safe.
    return secrets.token_urlsafe(24)


def _new_id(prefix: str) -> str:
    return f"{prefix}_{secrets.token_urlsafe(9)}"


@dataclass(frozen=True)
class ResolvedExpense:
    """An expense input that has passed every §8 rule."""

    description: str
    amount_cents: int
    paid_by: str
    date: str
    category: str | None
    split_type: str
    participant_ids: list[str]
    exact_cents: dict[str, int]
    basis_points: dict[str, int]
    created_by: str


class TripService:
    def __init__(self, db: Database):
        self.db = db

    # --- lookups ----------------------------------------------------------

    def _require_trip(self, token: str) -> Trip:
        trip = self.db.trip_by_token(token)
        if trip is None:
            raise not_found()
        return trip

    def _require_participant(self, trip: Trip, participant_id: str) -> Participant:
        participant = self.db.participant(trip.id, participant_id)
        if participant is None:
            raise not_found("That person is not in this trip.")
        return participant

    def _require_expense(self, trip: Trip, expense_id: str) -> Expense:
        expense = self.db.expense(trip.id, expense_id)
        if expense is None:
            raise not_found("That expense no longer exists.")
        return expense

    def _assert_name_available(
        self, trip: Trip, name: str, except_id: str | None = None
    ) -> None:
        for participant in self.db.participants_of(trip.id):
            if participant.id != except_id and _same_name(participant.name, name):
                raise ApiError(
                    ErrorCode.NAME_TAKEN,
                    f'"{name}" is already taken in this trip. '
                    f'Add something to tell you apart, like "{name} B".',
                    status_code=409,
                    field="name",
                    existingParticipantId=participant.id,
                )

    # --- trips ------------------------------------------------------------

    def create_trip(self, name: object, currency_label: object, creator_name: object):
        """SPEC §7.1. The creator becomes participant #1 and pre-lists nobody."""
        trip_name = _clean(name)
        if not trip_name:
            raise ApiError(ErrorCode.TRIP_NAME_EMPTY, "Give the trip a name.", field="name")

        creator = _clean(creator_name)
        if not creator:
            raise ApiError(ErrorCode.NAME_EMPTY, "Enter your name.", field="creatorName")

        now = _now()
        trip = Trip(
            id=_new_id("trip"),
            token=_new_token(),
            name=trip_name,
            # SPEC §4: display string only, default EUR.
            currency_label=_clean(currency_label) or "EUR",
            created_at=now,
            last_activity_at=now,
        )
        participant = Participant(
            id=_new_id("p"),
            trip_id=trip.id,
            name=creator,
            created_at=now,
        )
        self.db.add_trip(trip)
        self.db.add_participant(participant)
        return trip, participant

    def trip_view(self, token: str) -> dict:
        """SPEC §7.2. Everything the app renders, with balances and transfers
        computed here and stored nowhere."""
        trip = self._require_trip(token)
        participants = self.db.participants_of(trip.id)
        order = [p.id for p in participants]

        expenses = self.db.expenses_of(trip.id)
        split_rows = {e.id: self._ordered_splits(e, order) for e in expenses}

        balances = compute_balances(
            order, [(e.paid_by, e.amount_cents, split_rows[e.id]) for e in expenses]
        )

        return {
            "trip": trip,
            "participants": participants,
            "expenses": [(e, split_rows[e.id]) for e in expenses],
            "balances": balances,
            "transfers": compute_transfers(balances),
            "total_cents": sum(e.amount_cents for e in expenses),
        }

    def _ordered_splits(self, expense: Expense, order: list[str]) -> list[tuple[str, int]]:
        """Split rows in canonical participant order, whatever order storage
        hands them back in."""
        amounts = {s.participant_id: s.amount_cents for s in self.db.splits_of(expense.id)}
        return [(pid, amounts[pid]) for pid in order if pid in amounts]

    # --- participants -----------------------------------------------------

    def join(self, token: str, name: object) -> Participant:
        """SPEC §7.5. A taken name is rejected outright — no fuzzy matching,
        no "is this you?"."""
        trip = self._require_trip(token)
        clean = _clean(name)
        if not clean:
            raise ApiError(ErrorCode.NAME_EMPTY, "Enter your name.", field="name")
        self._assert_name_available(trip, clean)

        participant = Participant(
            id=_new_id("p"),
            trip_id=trip.id,
            name=clean,
            created_at=_now(),
        )
        self.db.add_participant(participant)
        self.db.touch_trip(trip.id, _now())
        return participant

    def claim(self, token: str, name: object) -> Participant:
        """SPEC §7.6 and §3: "this is me on another device". Binds to the
        existing participant and creates nothing, so it leaves
        last_activity_at alone."""
        trip = self._require_trip(token)
        clean = _clean(name)
        if not clean:
            raise ApiError(ErrorCode.NAME_EMPTY, "Enter your name.", field="name")

        for participant in self.db.participants_of(trip.id):
            if _same_name(participant.name, clean):
                return participant
        raise not_found(f'Nobody in this trip is called "{clean}".')

    def rename(self, token: str, participant_id: str, name: object) -> Participant:
        """SPEC §7.7. Anyone with the link may rename anyone."""
        trip = self._require_trip(token)
        participant = self._require_participant(trip, participant_id)

        clean = _clean(name)
        if not clean:
            raise ApiError(ErrorCode.NAME_EMPTY, "Enter a name.", field="name")
        self._assert_name_available(trip, clean, except_id=participant.id)

        self.db.rename_participant(participant.id, clean)
        self.db.touch_trip(trip.id, _now())
        return replace(participant, name=clean)

    def remove_participant(self, token: str, participant_id: str) -> None:
        """SPEC §7.8. Only when they have zero expenses as payer and zero split
        rows — removing someone who is on an expense would silently change what
        everyone else owes."""
        trip = self._require_trip(token)
        participant = self._require_participant(trip, participant_id)

        paid_count, split_count = self.db.usage_of(trip.id, participant.id)
        if paid_count or split_count:
            raise ApiError(
                ErrorCode.PARTICIPANT_IN_USE,
                f"{participant.name} is on existing expenses and cannot be removed.",
                status_code=409,
                paidCount=paid_count,
                splitCount=split_count,
            )

        self.db.remove_participant(participant.id)
        self.db.touch_trip(trip.id, _now())

    # --- expenses ---------------------------------------------------------

    def _validate_expense(self, trip: Trip, data, created_by_override: str | None = None):
        """Every SPEC §8 rule, in one place, for both create and update."""
        participants = self.db.participants_of(trip.id)
        known = {p.id for p in participants}

        description = _clean(data.description)
        if not description:
            raise ApiError(
                ErrorCode.DESCRIPTION_EMPTY,
                "Give the expense a description.",
                field="description",
            )

        amount_cents = data.amount_cents
        if not _is_money(amount_cents) or amount_cents <= 0:
            raise ApiError(
                ErrorCode.AMOUNT_NOT_POSITIVE,
                "Enter an amount greater than zero.",
                field="amountCents",
            )

        # SPEC §4: the payer is one participant, and is NOT constrained to be
        # in the split.
        if data.paid_by not in known:
            raise ApiError(
                ErrorCode.UNKNOWN_PARTICIPANT, "Choose who paid.", field="paidBy"
            )

        # openapi.yaml: on update `createdBy` is accepted but ignored, so the
        # original author survives an edit by someone else.
        created_by = created_by_override if created_by_override is not None else data.created_by
        if created_by not in known:
            raise ApiError(
                ErrorCode.UNKNOWN_PARTICIPANT,
                "Join the trip before adding an expense.",
                field="createdBy",
            )

        if data.split_type not in SPLIT_TYPES:
            raise ApiError(
                ErrorCode.INVALID_SPLIT_TYPE, "Choose how to split this.", field="splitType"
            )

        category = data.category
        if category is not None and category not in CATEGORIES:
            raise ApiError(
                ErrorCode.INVALID_CATEGORY, "That is not a known category.", field="category"
            )

        # Keep the included list in canonical participant order, so
        # distribute() breaks ties on ascending created_at (SPEC §5). Unknown
        # ids are dropped rather than rejected.
        requested = set(data.participant_ids or [])
        participant_ids = [p.id for p in participants if p.id in requested]
        if not participant_ids:
            raise ApiError(
                ErrorCode.NO_PARTICIPANTS_IN_SPLIT,
                "Include at least one person in the split.",
                field="participantIds",
            )

        exact_cents = data.exact_cents if isinstance(data.exact_cents, dict) else {}
        basis_points = data.basis_points if isinstance(data.basis_points, dict) else {}

        if data.split_type == "exact":
            entered = [exact_cents.get(pid, 0) for pid in participant_ids]
            if not all(_is_money(value) and value >= 0 for value in entered):
                raise ApiError(
                    ErrorCode.AMOUNT_NOT_POSITIVE,
                    "Split amounts cannot be negative.",
                    field="exactCents",
                )
            difference = amount_cents - sum(entered)
            if difference != 0:
                raise ApiError(
                    ErrorCode.EXACT_SUM_MISMATCH,
                    "The split amounts do not add up to the total.",
                    field="exactCents",
                    differenceCents=difference,
                )

        if data.split_type == "percent":
            entered = [basis_points.get(pid, 0) for pid in participant_ids]
            if not all(_is_money(value) and value >= 0 for value in entered):
                raise ApiError(
                    ErrorCode.PERCENT_SUM_MISMATCH,
                    "Percentages cannot be negative.",
                    field="basisPoints",
                    differenceBasisPoints=10000 - sum(v for v in entered if _is_money(v)),
                )
            difference = 10000 - sum(entered)
            if difference != 0:
                raise ApiError(
                    ErrorCode.PERCENT_SUM_MISMATCH,
                    "The percentages do not add up to 100%.",
                    field="basisPoints",
                    differenceBasisPoints=difference,
                )

        return ResolvedExpense(
            description=description,
            amount_cents=amount_cents,
            paid_by=data.paid_by,
            date=self._resolve_date(data.date),
            category=category,
            split_type=data.split_type,
            participant_ids=participant_ids,
            exact_cents=exact_cents,
            basis_points=basis_points,
            created_by=created_by,
        )

    @staticmethod
    def _resolve_date(value: object) -> str:
        """SPEC §4: defaults to today; any past date accepted, and any future
        one. Anything unparseable falls back to today — the only date the
        client can send comes from a date input."""
        if isinstance(value, str) and value:
            try:
                return date.fromisoformat(value).isoformat()
            except ValueError:
                pass
        return date.today().isoformat()

    def create_expense(self, token: str, data):
        """SPEC §7.10. Splits are resolved to cents at save time."""
        trip = self._require_trip(token)
        clean = self._validate_expense(trip, data)

        expense = Expense(
            id=_new_id("e"),
            trip_id=trip.id,
            description=clean.description,
            amount_cents=clean.amount_cents,
            paid_by=clean.paid_by,
            date=clean.date,
            category=clean.category,
            split_type=clean.split_type,
            created_by=clean.created_by,
            created_at=_now(),
        )
        self.db.add_expense(expense)
        splits = self._resolve(clean)
        self.db.replace_splits(expense.id, splits)
        self.db.touch_trip(trip.id, _now())
        return expense, splits

    def update_expense(self, token: str, expense_id: str, data):
        """SPEC §7.15. Splits are recomputed and replaced on every save,
        including when the mode changes."""
        trip = self._require_trip(token)
        expense = self._require_expense(trip, expense_id)
        clean = self._validate_expense(trip, data, created_by_override=expense.created_by)

        # `created_by` is deliberately absent: the original author survives an
        # edit by someone else.
        changes = {
            "description": clean.description,
            "amount_cents": clean.amount_cents,
            "paid_by": clean.paid_by,
            "date": clean.date,
            "category": clean.category,
            "split_type": clean.split_type,
        }
        self.db.update_expense(expense.id, **changes)

        splits = self._resolve(clean)
        self.db.replace_splits(expense.id, splits)
        self.db.touch_trip(trip.id, _now())
        return replace(expense, **changes), splits

    def delete_expense(self, token: str, expense_id: str) -> None:
        """SPEC §7.16 and §2: anyone with the link may delete any expense,
        including ones they did not enter."""
        trip = self._require_trip(token)
        expense = self._require_expense(trip, expense_id)
        self.db.remove_expense(expense.id)
        self.db.touch_trip(trip.id, _now())

    @staticmethod
    def _resolve(clean: ResolvedExpense) -> list[tuple[str, int]]:
        return resolve_split(
            clean.amount_cents,
            clean.split_type,
            clean.participant_ids,
            clean.exact_cents,
            clean.basis_points,
        )
