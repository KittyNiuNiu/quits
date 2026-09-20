"""Balances and settlement — openapi.yaml, SPEC §6 and §12."""

from fastapi.testclient import TestClient

from .conftest import expense_payload


def add(client: TestClient, token: str, **overrides):
    payload = expense_payload(overrides.pop("anna"), **overrides)
    return client.post(f"/api/trips/{token}/expenses", json=payload)


class TestBalances:
    def test_nets_paid_against_owed(self, client: TestClient, trio: dict):
        token, anna, max_ = trio["token"], trio["anna"]["id"], trio["max"]["id"]
        add(client, token, anna=anna, participantIds=[anna, max_])

        balances = client.get(f"/api/trips/{token}").json()["balances"]
        by_id = {b["participantId"]: b for b in balances}
        assert by_id[anna] == {
            "participantId": anna,
            "paidCents": 1000,
            "owedCents": 500,
            "netCents": 500,
        }
        assert by_id[max_]["netCents"] == -500

    def test_balances_follow_participant_order(self, client: TestClient, trio: dict):
        view = client.get(f"/api/trips/{trio['token']}").json()
        assert [b["participantId"] for b in view["balances"]] == [
            p["id"] for p in view["participants"]
        ]

    def test_a_trip_always_nets_to_zero(self, client: TestClient, trio: dict):
        token, anna, max_, sam = (
            trio["token"],
            trio["anna"]["id"],
            trio["max"]["id"],
            trio["sam"]["id"],
        )
        everyone = [anna, max_, sam]
        add(client, token, anna=anna, amountCents=1000, participantIds=everyone)
        add(client, token, anna=anna, amountCents=777, paidBy=max_, participantIds=everyone)
        add(client, token, anna=anna, amountCents=1, paidBy=sam, participantIds=[anna])

        balances = client.get(f"/api/trips/{token}").json()["balances"]
        assert sum(b["netCents"] for b in balances) == 0

    def test_trip_total_sums_every_expense(self, client: TestClient, trip: dict):
        token, anna = trip["token"], trip["anna"]["id"]
        add(client, token, anna=anna, amountCents=1000)
        add(client, token, anna=anna, amountCents=250)
        assert client.get(f"/api/trips/{token}").json()["totalCents"] == 1250


class TestTransfers:
    def test_single_debt_produces_one_transfer(self, client: TestClient, trio: dict):
        token, anna, max_ = trio["token"], trio["anna"]["id"], trio["max"]["id"]
        add(client, token, anna=anna, amountCents=9000, participantIds=[anna, max_])

        transfers = client.get(f"/api/trips/{token}").json()["transfers"]
        assert transfers == [
            {"fromParticipantId": max_, "toParticipantId": anna, "amountCents": 4500}
        ]

    def test_nothing_to_settle_when_square(self, client: TestClient, trip: dict):
        assert client.get(f"/api/trips/{trip['token']}").json()["transfers"] == []

    def test_settles_everyone_exactly(self, client: TestClient, trio: dict):
        token, anna, max_, sam = (
            trio["token"],
            trio["anna"]["id"],
            trio["max"]["id"],
            trio["sam"]["id"],
        )
        everyone = [anna, max_, sam]
        add(client, token, anna=anna, amountCents=1234, participantIds=everyone)
        add(client, token, anna=anna, amountCents=5000, paidBy=max_, participantIds=everyone)
        add(client, token, anna=anna, amountCents=99, paidBy=sam, participantIds=[anna, max_])

        view = client.get(f"/api/trips/{token}").json()
        settled = {b["participantId"]: b["netCents"] for b in view["balances"]}
        for transfer in view["transfers"]:
            assert transfer["amountCents"] > 0
            settled[transfer["fromParticipantId"]] += transfer["amountCents"]
            settled[transfer["toParticipantId"]] -= transfer["amountCents"]
        assert all(value == 0 for value in settled.values())

    def test_needs_at_most_n_minus_one_transfers(self, client: TestClient, trio: dict):
        token, anna, max_, sam = (
            trio["token"],
            trio["anna"]["id"],
            trio["max"]["id"],
            trio["sam"]["id"],
        )
        add(client, token, anna=anna, amountCents=3000, participantIds=[anna, max_, sam])
        view = client.get(f"/api/trips/{token}").json()
        assert len(view["transfers"]) <= len(view["participants"]) - 1

    def test_is_deterministic(self, client: TestClient, trio: dict):
        token, anna, max_, sam = (
            trio["token"],
            trio["anna"]["id"],
            trio["max"]["id"],
            trio["sam"]["id"],
        )
        add(client, token, anna=anna, amountCents=6000, participantIds=[anna, max_, sam])
        first = client.get(f"/api/trips/{token}").json()["transfers"]
        for _ in range(3):
            assert client.get(f"/api/trips/{token}").json()["transfers"] == first

    def test_nothing_about_transfers_is_stored(self, client: TestClient, trio: dict):
        # SPEC §6: a computed view. There is no endpoint to mark one paid.
        token = trio["token"]
        assert client.post(f"/api/trips/{token}/transfers", json={}).status_code == 404


class TestDefinitionOfDone:
    """SPEC §12: ten expenses across all three modes, including one where the
    payer is not in the split."""

    def test_full_walkthrough(self, client: TestClient, trio: dict):
        token, anna, max_, sam = (
            trio["token"],
            trio["anna"]["id"],
            trio["max"]["id"],
            trio["sam"]["id"],
        )
        everyone = [anna, max_, sam]

        amounts = [1000, 1, 4500, 780, 3333, 24000, 2050, 999, 1700, 1299]
        add(client, token, anna=anna, description="Dinner", amountCents=1000, participantIds=everyone)
        add(client, token, anna=anna, description="Taxi", amountCents=1, paidBy=max_, participantIds=everyone)
        add(client, token, anna=anna, description="Museum", amountCents=4500, paidBy=sam,
            category="activities", participantIds=everyone)
        add(client, token, anna=anna, description="Coffee", amountCents=780, participantIds=[anna, max_])
        add(client, token, anna=anna, description="Groceries", amountCents=3333, paidBy=max_,
            splitType="percent", participantIds=everyone,
            basisPoints={anna: 3333, max_: 3333, sam: 3334})
        add(client, token, anna=anna, description="Hotel", amountCents=24000, paidBy=sam,
            category="accommodation", splitType="exact", participantIds=everyone,
            exactCents={anna: 8000, max_: 8000, sam: 8000})
        add(client, token, anna=anna, description="Beers", amountCents=2050, category="drinks",
            splitType="percent", participantIds=everyone,
            basisPoints={anna: 5000, max_: 2500, sam: 2500})
        add(client, token, anna=anna, description="Lunch", amountCents=999, splitType="exact",
            participantIds=everyone, exactCents={anna: 333, max_: 333, sam: 333})
        # The payer is not in this split.
        add(client, token, anna=anna, description="Ferry tickets", amountCents=1700,
            participantIds=[max_, sam])
        add(client, token, anna=anna, description="Sunscreen", amountCents=1299, paidBy=sam,
            category="shopping", participantIds=everyone)

        view = client.get(f"/api/trips/{token}").json()

        assert len(view["expenses"]) == 10
        assert view["totalCents"] == sum(amounts)

        # Every expense's splits add up to that expense.
        for expense in view["expenses"]:
            assert sum(s["amountCents"] for s in expense["splits"]) == expense["amountCents"]

        assert sum(b["netCents"] for b in view["balances"]) == 0

        settled = {b["participantId"]: b["netCents"] for b in view["balances"]}
        for transfer in view["transfers"]:
            settled[transfer["fromParticipantId"]] += transfer["amountCents"]
            settled[transfer["toParticipantId"]] -= transfer["amountCents"]
        assert all(value == 0 for value in settled.values())

        # SPEC §12.5: rename one, delete an unused one.
        client.patch(f"/api/trips/{token}/participants/{max_}", json={"name": "Maximilian"})
        curious = client.post(f"/api/trips/{token}/participants", json={"name": "Curious"}).json()
        assert client.delete(f"/api/trips/{token}/participants/{curious['id']}").status_code == 204

        final = client.get(f"/api/trips/{token}").json()
        assert [p["name"] for p in final["participants"]] == ["Anna", "Maximilian", "Sam"]
