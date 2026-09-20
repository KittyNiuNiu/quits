"""Expense endpoints and SPEC §8 validation — openapi.yaml, SPEC §7.10 to §7.17."""

from fastapi.testclient import TestClient

from .conftest import expense_payload


def add(client: TestClient, token: str, payload: dict):
    return client.post(f"/api/trips/{token}/expenses", json=payload)


class TestCreate:
    def test_resolves_an_equal_split_to_cents(self, client: TestClient, trio: dict):
        token, anna, max_, sam = (
            trio["token"],
            trio["anna"]["id"],
            trio["max"]["id"],
            trio["sam"]["id"],
        )
        response = add(client, token, expense_payload(anna, participantIds=[anna, max_, sam]))
        assert response.status_code == 201
        assert response.json()["splits"] == [
            {"participantId": anna, "amountCents": 334},
            {"participantId": max_, "amountCents": 333},
            {"participantId": sam, "amountCents": 333},
        ]

    def test_returns_every_documented_field(self, client: TestClient, trip: dict):
        response = add(client, trip["token"], expense_payload(trip["anna"]["id"]))
        assert set(response.json()) == {
            "id",
            "description",
            "amountCents",
            "paidBy",
            "date",
            "category",
            "splitType",
            "createdBy",
            "createdAt",
            "splits",
        }

    def test_defaults_the_date_to_today(self, client: TestClient, trip: dict):
        payload = expense_payload(trip["anna"]["id"])
        payload.pop("date")
        body = add(client, trip["token"], payload).json()
        assert body["date"] == __import__("datetime").date.today().isoformat()

    def test_accepts_past_and_future_dates(self, client: TestClient, trip: dict):
        anna = trip["anna"]["id"]
        assert add(client, trip["token"], expense_payload(anna, date="2001-01-01")).json()["date"] == "2001-01-01"
        assert add(client, trip["token"], expense_payload(anna, date="2099-12-31")).json()["date"] == "2099-12-31"

    def test_payer_need_not_be_in_the_split(self, client: TestClient, trio: dict):
        # SPEC §4: Anna buys the ferry tickets and does not go.
        token, anna, max_, sam = (
            trio["token"],
            trio["anna"]["id"],
            trio["max"]["id"],
            trio["sam"]["id"],
        )
        body = add(
            client,
            token,
            expense_payload(anna, amountCents=1700, paidBy=anna, participantIds=[max_, sam]),
        ).json()
        assert [s["participantId"] for s in body["splits"]] == [max_, sam]

        balances = client.get(f"/api/trips/{token}").json()["balances"]
        assert next(b for b in balances if b["participantId"] == anna)["netCents"] == 1700

    def test_accepts_a_category_from_the_fixed_list(self, client: TestClient, trip: dict):
        body = add(client, trip["token"], expense_payload(trip["anna"]["id"], category="food")).json()
        assert body["category"] == "food"

    def test_accepts_no_category(self, client: TestClient, trip: dict):
        body = add(client, trip["token"], expense_payload(trip["anna"]["id"], category=None)).json()
        assert body["category"] is None

    def test_unknown_participants_are_dropped(self, client: TestClient, trip: dict):
        anna = trip["anna"]["id"]
        body = add(
            client, trip["token"], expense_payload(anna, participantIds=[anna, "p_ghost"])
        ).json()
        assert len(body["splits"]) == 1

    def test_split_rows_follow_canonical_participant_order(self, client: TestClient, trio: dict):
        token, anna, max_, sam = (
            trio["token"],
            trio["anna"]["id"],
            trio["max"]["id"],
            trio["sam"]["id"],
        )
        body = add(
            client, token, expense_payload(anna, participantIds=[sam, max_, anna])
        ).json()
        assert [s["participantId"] for s in body["splits"]] == [anna, max_, sam]

    def test_records_who_entered_it(self, client: TestClient, trio: dict):
        body = add(
            client,
            trio["token"],
            expense_payload(trio["anna"]["id"], createdBy=trio["max"]["id"]),
        ).json()
        assert body["createdBy"] == trio["max"]["id"]

    def test_expenses_are_listed_newest_first(self, client: TestClient, trip: dict):
        anna = trip["anna"]["id"]
        for description in ["First", "Second", "Third"]:
            add(client, trip["token"], expense_payload(anna, description=description))
        listed = [e["description"] for e in client.get(f"/api/trips/{trip['token']}").json()["expenses"]]
        assert listed == ["Third", "Second", "First"]


class TestExactSplit:
    def test_uses_the_entered_amounts(self, client: TestClient, trio: dict):
        token, anna, max_ = trio["token"], trio["anna"]["id"], trio["max"]["id"]
        body = add(
            client,
            token,
            expense_payload(
                anna,
                splitType="exact",
                participantIds=[anna, max_],
                exactCents={anna: 750, max_: 250},
            ),
        ).json()
        assert body["splits"] == [
            {"participantId": anna, "amountCents": 750},
            {"participantId": max_, "amountCents": 250},
        ]

    def test_allows_a_zero_row(self, client: TestClient, trio: dict):
        token, anna, max_ = trio["token"], trio["anna"]["id"], trio["max"]["id"]
        body = add(
            client,
            token,
            expense_payload(
                anna,
                splitType="exact",
                participantIds=[anna, max_],
                exactCents={anna: 1000, max_: 0},
            ),
        ).json()
        assert body["splits"][1]["amountCents"] == 0

    def test_rejects_a_shortfall_and_reports_the_difference(self, client: TestClient, trio: dict):
        token, anna, max_ = trio["token"], trio["anna"]["id"], trio["max"]["id"]
        response = add(
            client,
            token,
            expense_payload(
                anna,
                splitType="exact",
                participantIds=[anna, max_],
                exactCents={anna: 600, max_: 300},
            ),
        )
        assert response.status_code == 422
        body = response.json()
        assert body["code"] == "exact_sum_mismatch"
        assert body["details"]["differenceCents"] == 100

    def test_rejects_an_overshoot_with_a_negative_difference(self, client: TestClient, trio: dict):
        token, anna, max_ = trio["token"], trio["anna"]["id"], trio["max"]["id"]
        response = add(
            client,
            token,
            expense_payload(
                anna,
                splitType="exact",
                participantIds=[anna, max_],
                exactCents={anna: 600, max_: 600},
            ),
        )
        assert response.json()["details"]["differenceCents"] == -200

    def test_rejects_a_negative_amount(self, client: TestClient, trio: dict):
        token, anna, max_ = trio["token"], trio["anna"]["id"], trio["max"]["id"]
        response = add(
            client,
            token,
            expense_payload(
                anna,
                splitType="exact",
                participantIds=[anna, max_],
                exactCents={anna: 1200, max_: -200},
            ),
        )
        assert response.status_code == 422
        assert response.json()["code"] == "amount_not_positive"


class TestPercentSplit:
    def test_treats_percentages_as_integer_basis_points(self, client: TestClient, trio: dict):
        token, anna, max_, sam = (
            trio["token"],
            trio["anna"]["id"],
            trio["max"]["id"],
            trio["sam"]["id"],
        )
        body = add(
            client,
            token,
            expense_payload(
                anna,
                amountCents=10000,
                splitType="percent",
                participantIds=[anna, max_, sam],
                basisPoints={anna: 3333, max_: 3333, sam: 3334},
            ),
        ).json()
        assert [s["amountCents"] for s in body["splits"]] == [3333, 3333, 3334]

    def test_still_sums_to_the_total_when_it_does_not_divide_cleanly(self, client: TestClient, trio: dict):
        token, anna, max_, sam = (
            trio["token"],
            trio["anna"]["id"],
            trio["max"]["id"],
            trio["sam"]["id"],
        )
        body = add(
            client,
            token,
            expense_payload(
                anna,
                amountCents=999,
                splitType="percent",
                participantIds=[anna, max_, sam],
                basisPoints={anna: 3333, max_: 3333, sam: 3334},
            ),
        ).json()
        assert sum(s["amountCents"] for s in body["splits"]) == 999

    def test_rejects_a_shortfall_and_reports_basis_points(self, client: TestClient, trio: dict):
        token, anna, max_ = trio["token"], trio["anna"]["id"], trio["max"]["id"]
        response = add(
            client,
            token,
            expense_payload(
                anna,
                splitType="percent",
                participantIds=[anna, max_],
                basisPoints={anna: 5000, max_: 4000},
            ),
        )
        assert response.status_code == 422
        body = response.json()
        assert body["code"] == "percent_sum_mismatch"
        assert body["details"]["differenceBasisPoints"] == 1000


class TestValidation:
    """SPEC §8, enforced server-side."""

    def test_rejects_zero_amount(self, client: TestClient, trip: dict):
        response = add(client, trip["token"], expense_payload(trip["anna"]["id"], amountCents=0))
        assert response.status_code == 422
        assert response.json()["code"] == "amount_not_positive"

    def test_rejects_negative_amount(self, client: TestClient, trip: dict):
        response = add(client, trip["token"], expense_payload(trip["anna"]["id"], amountCents=-5))
        assert response.json()["code"] == "amount_not_positive"

    def test_rejects_a_fractional_amount(self, client: TestClient, trip: dict):
        # Money is always integer cents. No float reaches the ledger.
        response = add(client, trip["token"], expense_payload(trip["anna"]["id"], amountCents=10.5))
        assert response.status_code == 422
        assert response.json()["code"] == "amount_not_positive"

    def test_rejects_an_empty_description(self, client: TestClient, trip: dict):
        response = add(client, trip["token"], expense_payload(trip["anna"]["id"], description="  "))
        assert response.status_code == 422
        assert response.json()["code"] == "description_empty"

    def test_rejects_an_empty_split(self, client: TestClient, trip: dict):
        response = add(client, trip["token"], expense_payload(trip["anna"]["id"], participantIds=[]))
        assert response.status_code == 422
        assert response.json()["code"] == "no_participants_in_split"

    def test_rejects_an_unknown_payer(self, client: TestClient, trip: dict):
        response = add(client, trip["token"], expense_payload(trip["anna"]["id"], paidBy="p_ghost"))
        assert response.status_code == 422
        assert response.json()["code"] == "unknown_participant"
        assert response.json()["details"]["field"] == "paidBy"

    def test_rejects_an_unknown_author(self, client: TestClient, trip: dict):
        response = add(
            client, trip["token"], expense_payload(trip["anna"]["id"], createdBy="p_ghost")
        )
        assert response.status_code == 422
        assert response.json()["code"] == "unknown_participant"

    def test_rejects_a_category_outside_the_list(self, client: TestClient, trip: dict):
        response = add(
            client, trip["token"], expense_payload(trip["anna"]["id"], category="gambling")
        )
        assert response.status_code == 422
        assert response.json()["code"] == "invalid_category"

    def test_rejects_an_unknown_split_type(self, client: TestClient, trip: dict):
        response = add(
            client, trip["token"], expense_payload(trip["anna"]["id"], splitType="weighted")
        )
        assert response.status_code == 422
        assert response.json()["code"] == "invalid_split_type"

    def test_unknown_token_is_404(self, client: TestClient, trip: dict):
        response = add(client, "nope", expense_payload(trip["anna"]["id"]))
        assert response.status_code == 404


class TestUpdate:
    def test_replaces_the_splits_when_the_amount_changes(self, client: TestClient, trio: dict):
        token, anna, max_ = trio["token"], trio["anna"]["id"], trio["max"]["id"]
        created = add(
            client, token, expense_payload(anna, participantIds=[anna, max_])
        ).json()
        response = client.put(
            f"/api/trips/{token}/expenses/{created['id']}",
            json=expense_payload(anna, amountCents=2000, participantIds=[anna, max_]),
        )
        assert response.status_code == 200
        assert [s["amountCents"] for s in response.json()["splits"]] == [1000, 1000]

    def test_recomputes_when_the_split_mode_changes(self, client: TestClient, trio: dict):
        token, anna, max_ = trio["token"], trio["anna"]["id"], trio["max"]["id"]
        created = add(client, token, expense_payload(anna, participantIds=[anna, max_])).json()
        response = client.put(
            f"/api/trips/{token}/expenses/{created['id']}",
            json=expense_payload(
                anna,
                splitType="exact",
                participantIds=[anna, max_],
                exactCents={anna: 900, max_: 100},
            ),
        )
        assert response.json()["splitType"] == "exact"
        assert [s["amountCents"] for s in response.json()["splits"]] == [900, 100]

    def test_drops_a_participant_removed_from_the_split(self, client: TestClient, trio: dict):
        token, anna, max_ = trio["token"], trio["anna"]["id"], trio["max"]["id"]
        created = add(client, token, expense_payload(anna, participantIds=[anna, max_])).json()
        client.put(
            f"/api/trips/{token}/expenses/{created['id']}",
            json=expense_payload(anna, participantIds=[anna]),
        )
        balances = client.get(f"/api/trips/{token}").json()["balances"]
        assert next(b for b in balances if b["participantId"] == max_)["owedCents"] == 0

    def test_ignores_created_by_and_keeps_the_original_author(self, client: TestClient, trio: dict):
        # openapi.yaml: the client sends it, the server must not write it.
        token, anna, max_ = trio["token"], trio["anna"]["id"], trio["max"]["id"]
        created = add(client, token, expense_payload(anna, createdBy=anna)).json()
        response = client.put(
            f"/api/trips/{token}/expenses/{created['id']}",
            json=expense_payload(anna, createdBy=max_),
        )
        assert response.json()["createdBy"] == anna

    def test_still_validates(self, client: TestClient, trip: dict):
        token, anna = trip["token"], trip["anna"]["id"]
        created = add(client, token, expense_payload(anna)).json()
        response = client.put(
            f"/api/trips/{token}/expenses/{created['id']}",
            json=expense_payload(anna, amountCents=0),
        )
        assert response.status_code == 422
        assert response.json()["code"] == "amount_not_positive"

    def test_unknown_expense_is_404(self, client: TestClient, trip: dict):
        response = client.put(
            f"/api/trips/{trip['token']}/expenses/e_nope",
            json=expense_payload(trip["anna"]["id"]),
        )
        assert response.status_code == 404


class TestDelete:
    def test_removes_the_expense_and_its_splits(self, client: TestClient, trio: dict):
        token, anna, max_ = trio["token"], trio["anna"]["id"], trio["max"]["id"]
        created = add(client, token, expense_payload(anna, participantIds=[anna, max_])).json()

        response = client.delete(f"/api/trips/{token}/expenses/{created['id']}")
        assert response.status_code == 204
        assert response.content == b""

        view = client.get(f"/api/trips/{token}").json()
        assert view["expenses"] == []
        assert view["totalCents"] == 0
        assert all(b["netCents"] == 0 for b in view["balances"])

    def test_anyone_with_the_link_may_delete_what_they_did_not_enter(self, client: TestClient, trio: dict):
        # SPEC §2: deliberate. The link is the only credential.
        token, anna, max_ = trio["token"], trio["anna"]["id"], trio["max"]["id"]
        created = add(client, token, expense_payload(anna, createdBy=max_)).json()
        assert client.delete(f"/api/trips/{token}/expenses/{created['id']}").status_code == 204

    def test_unknown_expense_is_404(self, client: TestClient, trip: dict):
        assert (
            client.delete(f"/api/trips/{trip['token']}/expenses/e_nope").status_code == 404
        )
