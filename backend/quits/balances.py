"""SPEC §6: balances and the settlement view.

Transfers are a computed view. Nothing is stored, nothing can be marked paid,
and the app has no concept of an outstanding balance after people start
actually sending money.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Balance:
    participant_id: str
    paid_cents: int
    owed_cents: int

    @property
    def net_cents(self) -> int:
        return self.paid_cents - self.owed_cents


@dataclass(frozen=True)
class Transfer:
    from_participant_id: str
    to_participant_id: str
    amount_cents: int


def compute_balances(
    participant_ids: list[str],
    expenses: list[tuple[str, int, list[tuple[str, int]]]],
) -> list[Balance]:
    """Net balance per participant, in the order the participants are given.

    SPEC §6: (sum of amount_cents on expenses they paid) − (sum of their split
    rows). ``expenses`` is a list of ``(paid_by, amount_cents, splits)``.
    """
    paid = dict.fromkeys(participant_ids, 0)
    owed = dict.fromkeys(participant_ids, 0)

    for paid_by, amount_cents, splits in expenses:
        if paid_by in paid:
            paid[paid_by] += amount_cents
        for participant_id, split_amount in splits:
            if participant_id in owed:
                owed[participant_id] += split_amount

    return [Balance(pid, paid[pid], owed[pid]) for pid in participant_ids]


def compute_transfers(balances: list[Balance]) -> list[Transfer]:
    """The minimised transfer list.

    SPEC §6: computed greedily — repeatedly match the largest creditor against
    the largest debtor. Ties fall back to canonical participant order, so the
    same trip always renders the same list.
    """
    creditors = sorted(
        ((b.net_cents, i, b.participant_id) for i, b in enumerate(balances) if b.net_cents > 0),
        key=lambda row: (-row[0], row[1]),
    )
    debtors = sorted(
        ((-b.net_cents, i, b.participant_id) for i, b in enumerate(balances) if b.net_cents < 0),
        key=lambda row: (-row[0], row[1]),
    )

    creditor_amounts = [amount for amount, _, _ in creditors]
    debtor_amounts = [amount for amount, _, _ in debtors]

    transfers: list[Transfer] = []
    c = d = 0
    while c < len(creditors) and d < len(debtors):
        amount = min(creditor_amounts[c], debtor_amounts[d])
        if amount > 0:
            transfers.append(Transfer(debtors[d][2], creditors[c][2], amount))
        creditor_amounts[c] -= amount
        debtor_amounts[d] -= amount
        if creditor_amounts[c] == 0:
            c += 1
        if debtor_amounts[d] == 0:
            d += 1

    return transfers
