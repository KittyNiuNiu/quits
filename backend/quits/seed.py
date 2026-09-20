"""Demo data for the mock database.

A trip with enough in it to be worth looking at: three people, all three split
modes, an expense whose payer is not in the split, categorised and
uncategorised entries, and balances that produce a non-trivial transfer list.

Everything is created through `TripService`, never by writing rows directly.
That means the seed obeys every SPEC §8 rule and every split goes through
`distribute()` — if this file ever describes something the API would reject,
startup fails loudly instead of leaving impossible data in the database.

This exists only to make an empty in-memory database useful during
development. It is not part of the product: nothing in the API creates or
references it, and it disappears with the database on restart.
"""

from __future__ import annotations

from quits.db import Database, DatabaseFactory, Trip
from quits.schemas import ExpenseIn
from quits.service import TripService

# (description, amount_cents, payer, date, category, split_type, who, extra)
_EXPENSES = [
    ("Taxi from the airport", 2400, "Max", "2026-03-12", "transport", "equal", "all", {}),
    ("Hotel Baixa, three nights", 42000, "Sam", "2026-03-12", "accommodation", "exact", "all",
     {"exact": {"Anna": 14000, "Max": 14000, "Sam": 14000}}),
    ("Dinner at Ramiro", 8450, "Anna", "2026-03-12", "food", "equal", "all", {}),
    ("Tram 28 tickets", 1830, "Anna", "2026-03-13", "transport", "equal", "all", {}),
    ("Pastéis de Belém", 745, "Sam", "2026-03-13", "food", "equal", "all", {}),
    # The payer is not in the split: Anna books the lesson for the other two
    # and sits it out (SPEC §4).
    ("Surf lesson", 12000, "Anna", "2026-03-14", "activities", "equal", "max+sam", {}),
    ("Ginjinha round", 960, "Max", "2026-03-14", "drinks", "percent", "all",
     {"percent": {"Anna": 3333, "Max": 3333, "Sam": 3334}}),
    # Anna does most of the cooking, so she takes half.
    ("Groceries for the flat", 3312, "Max", "2026-03-15", "shopping", "percent", "all",
     {"percent": {"Anna": 5000, "Max": 2500, "Sam": 2500}}),
    ("Museum tickets", 3600, "Sam", "2026-03-15", "activities", "equal", "anna+sam", {}),
    # No category — it is optional (SPEC §7.21).
    ("Sunscreen and a hat", 899, "Anna", "2026-03-16", None, "equal", "all", {}),
]


def seed_demo_trip_if_empty(factory: DatabaseFactory) -> Trip | None:
    """Seed one demo trip, but only into a database with no trips in it.

    With storage that survives a restart, seeding unconditionally would add
    another demo trip every time the server started.
    """
    with factory() as db:
        if db.any_trips():
            return None
        return seed_demo_trip(db)


def seed_demo_trip(db: Database) -> Trip:
    """Fill `db` with one demo trip and return it."""
    service = TripService(db)

    trip, anna = service.create_trip("Lisbon, March", "EUR", "Anna")
    people = {
        "Anna": anna.id,
        "Max": service.join(trip.token, "Max").id,
        "Sam": service.join(trip.token, "Sam").id,
    }
    everyone = list(people.values())
    groups = {
        "all": everyone,
        "max+sam": [people["Max"], people["Sam"]],
        "anna+sam": [people["Anna"], people["Sam"]],
    }

    for description, amount, payer, date, category, split_type, group, extra in _EXPENSES:
        participant_ids = groups[group]
        service.create_expense(
            trip.token,
            ExpenseIn(
                description=description,
                amount_cents=amount,
                paid_by=people[payer],
                date=date,
                category=category,
                split_type=split_type,
                participant_ids=participant_ids,
                exact_cents={people[n]: c for n, c in extra.get("exact", {}).items()},
                basis_points={people[n]: b for n, b in extra.get("percent", {}).items()},
                # Not always the payer — the list shows "added by <name>".
                created_by=people["Anna"] if payer != "Sam" else people["Sam"],
            ),
        )

    return trip
