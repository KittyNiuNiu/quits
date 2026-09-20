"""SPEC §5 — the distribution function.

These are written against the specification, before the implementation exists.
`distribute` is the only rounding path in the backend; nothing else divides a
total.
"""

import pytest

from quits.money import distribute


class TestRequiredTable:
    """The table SPEC §5 requires, verbatim."""

    def test_1000_cents_three_people_equal(self):
        assert distribute(1000, [1, 1, 1]) == [334, 333, 333]

    def test_1_cent_three_people_equal(self):
        assert distribute(1, [1, 1, 1]) == [1, 0, 0]

    def test_10000_cents_uneven_basis_points(self):
        assert distribute(10000, [3333, 3333, 3334]) == [3333, 3333, 3334]

    def test_10000_cents_short_basis_points_is_deterministic(self):
        first = distribute(10000, [3333, 3333, 3333])
        assert sum(first) == 10000
        for _ in range(5):
            assert distribute(10000, [3333, 3333, 3333]) == first


class TestSumGuarantee:
    """SPEC §5: sum(distribute(t, w)) == t for all inputs."""

    TOTALS = [0, 1, 2, 3, 7, 99, 100, 101, 999, 1000, 12345, 99999, 1_000_000]
    WEIGHTS = [
        [1],
        [1, 1],
        [1, 1, 1],
        [1] * 7,
        [3333, 3333, 3334],
        [3333, 3333, 3333],
        [1, 2, 3, 4],
        [5000, 2500, 2500],
        [1, 0, 0],
        [0, 0, 1],
        [9998, 1, 1],
    ]

    @pytest.mark.parametrize("total", TOTALS)
    @pytest.mark.parametrize("weights", WEIGHTS)
    def test_sums_to_total(self, total, weights):
        parts = distribute(total, weights)
        assert len(parts) == len(weights)
        assert sum(parts) == total
        assert all(isinstance(p, int) for p in parts)

    def test_holds_for_randomised_inputs(self):
        import random

        rng = random.Random(42)  # seeded, so a failure reproduces
        for _ in range(500):
            n = rng.randint(1, 8)
            weights = [rng.randint(0, 1000) for _ in range(n)]
            if sum(weights) == 0:
                weights[0] = 1
            total = rng.randint(0, 500_000)
            assert sum(distribute(total, weights)) == total


class TestLeftoverOrdering:
    """SPEC §5: leftovers go by descending remainder, ties by ascending
    participant created_at — which is the order the weights arrive in."""

    def test_earliest_participant_wins_a_tie(self):
        assert distribute(10, [1] * 7) == [2, 2, 2, 1, 1, 1, 1]

    def test_larger_remainder_beats_participant_order(self):
        # total 100, weights [1, 2]: bases are 33 and 66, remainders 1/3 and
        # 2/3. The leftover cent goes to the second participant.
        assert distribute(100, [1, 2]) == [33, 67]

    def test_zero_weight_gets_nothing(self):
        assert distribute(1000, [1, 0, 1]) == [500, 0, 500]


class TestRejectedInputs:
    def test_rejects_negative_total(self):
        with pytest.raises(ValueError):
            distribute(-1, [1, 1])

    def test_rejects_empty_weights(self):
        with pytest.raises(ValueError):
            distribute(100, [])

    def test_rejects_weights_summing_to_zero(self):
        with pytest.raises(ValueError):
            distribute(100, [0, 0])

    def test_rejects_negative_weight(self):
        with pytest.raises(ValueError):
            distribute(100, [2, -1])

    def test_rejects_non_integer_total(self):
        with pytest.raises((ValueError, TypeError)):
            distribute(10.5, [1, 1])

    def test_rejects_bool_as_weight(self):
        # bool is a subclass of int in Python; money must not accept it.
        with pytest.raises((ValueError, TypeError)):
            distribute(100, [True, 1])
