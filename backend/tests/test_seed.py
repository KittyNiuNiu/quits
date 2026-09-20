"""The demo data is built through the service, so these assert that it is
coherent — not just that it loaded."""

from fastapi.testclient import TestClient

from quits.app import create_app
from quits.seed import seed_demo_trip, seed_demo_trip_if_empty
from quits.sql import create_database_factory


def _view() -> dict:
    factory = create_database_factory("sqlite://")
    trip = seed_demo_trip_if_empty(factory)
    client = TestClient(create_app(factory))
    return client.get(f"/api/trips/{trip.token}").json()


def test_seeds_one_trip_with_three_people():
    view = _view()
    assert view["trip"]["name"] == "Lisbon, March"
    assert [p["name"] for p in view["participants"]] == ["Anna", "Max", "Sam"]


def test_exercises_all_three_split_modes():
    modes = {e["splitType"] for e in _view()["expenses"]}
    assert modes == {"equal", "exact", "percent"}


def test_includes_an_expense_whose_payer_is_not_in_the_split():
    view = _view()
    assert any(
        expense["paidBy"] not in {s["participantId"] for s in expense["splits"]}
        for expense in view["expenses"]
    )


def test_includes_a_categorised_and_an_uncategorised_expense():
    categories = {e["category"] for e in _view()["expenses"]}
    assert None in categories
    assert len(categories - {None}) >= 4


def test_every_split_adds_up_to_its_expense():
    for expense in _view()["expenses"]:
        assert sum(s["amountCents"] for s in expense["splits"]) == expense["amountCents"]


def test_the_trip_nets_to_zero():
    assert sum(b["netCents"] for b in _view()["balances"]) == 0


def test_the_total_matches_the_expenses():
    view = _view()
    assert view["totalCents"] == sum(e["amountCents"] for e in view["expenses"])


def test_there_is_something_to_settle():
    # An all-square demo would show an empty balances screen, which defeats
    # the point of seeding.
    view = _view()
    assert len(view["transfers"]) >= 1
    assert all(t["amountCents"] > 0 for t in view["transfers"])


def test_the_transfer_list_settles_everyone_exactly():
    view = _view()
    settled = {b["participantId"]: b["netCents"] for b in view["balances"]}
    for transfer in view["transfers"]:
        settled[transfer["fromParticipantId"]] += transfer["amountCents"]
        settled[transfer["toParticipantId"]] -= transfer["amountCents"]
    assert all(value == 0 for value in settled.values())


def test_seeding_twice_produces_independent_trips():
    factory = create_database_factory("sqlite://")
    with factory() as db:
        first = seed_demo_trip(db)
        second = seed_demo_trip(db)
    assert first.token != second.token


def test_an_already_populated_database_is_not_seeded_again():
    # Storage survives a restart now, so seeding must not stack up a new demo
    # trip on every boot.
    factory = create_database_factory("sqlite://")
    assert seed_demo_trip_if_empty(factory) is not None
    assert seed_demo_trip_if_empty(factory) is None
