"""Request and response models.

The wire format is camelCase, matching `openapi.yaml` and the frontend; the
Python attributes stay snake_case and pydantic's alias generator bridges them.

Request models are deliberately permissive. Every rule in SPEC §8 is enforced
in `service.py` so that a bad request comes back with the documented error
code, rather than as pydantic's own validation shape which the client does not
understand.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class _Camel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class _Input(_Camel):
    model_config = ConfigDict(
        alias_generator=to_camel, populate_by_name=True, extra="ignore"
    )


# --- requests --------------------------------------------------------------


class CreateTripIn(_Input):
    name: Any = ""
    currency_label: Any = ""
    creator_name: Any = ""


class NameIn(_Input):
    name: Any = ""


class ExpenseIn(_Input):
    description: Any = ""
    amount_cents: Any = None
    paid_by: Any = None
    date: Any = None
    category: Any = None
    split_type: Any = None
    participant_ids: Any = None
    exact_cents: Any = None
    basis_points: Any = None
    created_by: Any = None


# --- responses -------------------------------------------------------------


class TripOut(_Camel):
    id: str
    token: str
    name: str
    currency_label: str
    created_at: str
    last_activity_at: str


class ParticipantOut(_Camel):
    id: str
    name: str
    created_at: str


class SplitOut(_Camel):
    participant_id: str
    amount_cents: int


class ExpenseOut(_Camel):
    id: str
    description: str
    amount_cents: int
    paid_by: str
    date: str
    category: str | None
    split_type: str
    created_by: str
    created_at: str
    splits: list[SplitOut]


class BalanceOut(_Camel):
    participant_id: str
    paid_cents: int
    owed_cents: int
    net_cents: int


class TransferOut(_Camel):
    from_participant_id: str
    to_participant_id: str
    amount_cents: int


class CreateTripOut(_Camel):
    trip: TripOut
    participant: ParticipantOut


class TripViewOut(_Camel):
    trip: TripOut
    participants: list[ParticipantOut]
    expenses: list[ExpenseOut]
    balances: list[BalanceOut]
    transfers: list[TransferOut]
    total_cents: int


class ErrorOut(_Camel):
    code: str
    message: str
    details: dict = {}
