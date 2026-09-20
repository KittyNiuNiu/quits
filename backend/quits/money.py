"""Money primitives.

SPEC §5: all monetary values are integer cents and no floating-point
arithmetic touches money at any point. Percentages are integer basis points
(3333 = 33.33%), never floats.
"""

from __future__ import annotations


def _require_int(value: object, label: str) -> int:
    # bool is a subclass of int in Python. `True` must not pass for 1 when the
    # value is money.
    if isinstance(value, bool) or not isinstance(value, int):
        raise TypeError(f"{label} must be an integer, got {type(value).__name__}")
    return value


def distribute(total_cents: int, weights: list[int]) -> list[int]:
    """Split ``total_cents`` across ``weights`` by largest remainder.

    SPEC §5: this is the single distribution function. Every division of a
    total in the backend routes through here; there is no second rounding path.

    1. ``base_i = (total * w_i) // sum(weights)``
    2. hand out the leftover cents one each, in descending order of fractional
       remainder
    3. ties break by ascending participant ``created_at``

    Callers pass ``weights`` in canonical participant order (ascending
    ``created_at``), so step 3 is simply ascending index.

    Guarantee: ``sum(distribute(t, w)) == t`` for all accepted inputs.
    """
    _require_int(total_cents, "total_cents")
    if total_cents < 0:
        raise ValueError("total_cents must not be negative")

    if not weights:
        raise ValueError("weights must not be empty")

    for weight in weights:
        _require_int(weight, "weight")
        if weight < 0:
            raise ValueError("weights must not be negative")

    total_weight = sum(weights)
    if total_weight == 0:
        raise ValueError("weights must sum to more than zero")

    shares: list[int] = []
    remainders: list[int] = []
    for weight in weights:
        numerator = total_cents * weight
        shares.append(numerator // total_weight)
        remainders.append(numerator % total_weight)

    leftover = total_cents - sum(shares)

    # Largest remainder first; on a tie the earlier participant wins.
    order = sorted(range(len(weights)), key=lambda i: (-remainders[i], i))
    for position in range(leftover):
        shares[order[position % len(order)]] += 1

    return shares
