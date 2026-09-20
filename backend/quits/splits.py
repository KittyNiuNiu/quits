"""Turning a split mode plus its inputs into resolved cents.

SPEC §4: the split table always stores resolved cents. ``split_type`` records
how the rows were produced; nothing downstream reads it.
"""

from __future__ import annotations

from quits.money import distribute

SPLIT_TYPES: tuple[str, ...] = ("equal", "exact", "percent")


def resolve_split(
    amount_cents: int,
    split_type: str,
    participant_ids: list[str],
    exact_cents: dict[str, int] | None = None,
    basis_points: dict[str, int] | None = None,
) -> list[tuple[str, int]]:
    """Resolve a split into ``(participant_id, amount_cents)`` pairs.

    ``participant_ids`` must already be in canonical order — ascending
    ``created_at`` — so that distribute()'s tie-break lands on the right
    person.
    """
    if split_type not in SPLIT_TYPES:
        raise ValueError(f"unknown split type {split_type!r}")
    if not participant_ids:
        raise ValueError("a split needs at least one participant")

    if split_type == "exact":
        # SPEC §5: exact does not distribute. The entered amounts are the rows.
        entered = exact_cents or {}
        return [(pid, entered.get(pid, 0)) for pid in participant_ids]

    if split_type == "equal":
        weights = [1] * len(participant_ids)
    else:
        points = basis_points or {}
        weights = [points.get(pid, 0) for pid in participant_ids]

    amounts = distribute(amount_cents, weights)
    return list(zip(participant_ids, amounts))
