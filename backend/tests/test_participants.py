"""Participant endpoints — openapi.yaml, SPEC §7.5 to §7.9 and §3."""

from fastapi.testclient import TestClient

from .conftest import expense_payload


class TestJoin:
    def test_creates_a_participant(self, client: TestClient, trip: dict):
        response = client.post(f"/api/trips/{trip['token']}/participants", json={"name": "Max"})
        assert response.status_code == 201
        assert response.json()["name"] == "Max"
        assert set(response.json()) == {"id", "name", "createdAt"}

    def test_rejects_a_taken_name_with_409(self, client: TestClient, trip: dict):
        response = client.post(f"/api/trips/{trip['token']}/participants", json={"name": "Anna"})
        assert response.status_code == 409
        body = response.json()
        assert body["code"] == "name_taken"
        assert body["details"]["field"] == "name"

    def test_compares_case_insensitively_after_trimming(self, client: TestClient, trip: dict):
        response = client.post(
            f"/api/trips/{trip['token']}/participants", json={"name": "  aNNa  "}
        )
        assert response.status_code == 409
        assert response.json()["code"] == "name_taken"

    def test_accepts_a_distinguishing_suffix(self, client: TestClient, trip: dict):
        # SPEC §3: the app tells the visitor to add a suffix rather than
        # asking "is this you?".
        response = client.post(f"/api/trips/{trip['token']}/participants", json={"name": "Anna B"})
        assert response.status_code == 201

    def test_rejects_an_empty_name(self, client: TestClient, trip: dict):
        response = client.post(f"/api/trips/{trip['token']}/participants", json={"name": "   "})
        assert response.status_code == 422
        assert response.json()["code"] == "name_empty"

    def test_the_same_name_is_free_in_a_different_trip(self, client: TestClient, trip: dict):
        other = client.post(
            "/api/trips",
            json={"name": "Porto", "currencyLabel": "EUR", "creatorName": "Ben"},
        ).json()["trip"]["token"]
        assert (
            client.post(f"/api/trips/{other}/participants", json={"name": "Anna"}).status_code
            == 201
        )

    def test_unknown_token_is_404(self, client: TestClient):
        assert client.post("/api/trips/nope/participants", json={"name": "Max"}).status_code == 404

    def test_participants_come_back_in_creation_order(self, client: TestClient, trip: dict):
        # This ordering is load-bearing: SPEC §5 breaks rounding ties on it.
        # Created in a tight loop, so same-millisecond timestamps must not
        # scramble the order.
        for name in ["Max", "Sam", "Bea", "Cal", "Dee"]:
            client.post(f"/api/trips/{trip['token']}/participants", json={"name": name})
        names = [p["name"] for p in client.get(f"/api/trips/{trip['token']}").json()["participants"]]
        assert names == ["Anna", "Max", "Sam", "Bea", "Cal", "Dee"]


class TestClaim:
    def test_binds_to_the_existing_participant(self, client: TestClient, trip: dict):
        response = client.post(
            f"/api/trips/{trip['token']}/participants/claim", json={"name": "Anna"}
        )
        assert response.status_code == 200
        assert response.json()["id"] == trip["anna"]["id"]

    def test_creates_nothing(self, client: TestClient, trip: dict):
        client.post(f"/api/trips/{trip['token']}/participants/claim", json={"name": "Anna"})
        assert len(client.get(f"/api/trips/{trip['token']}").json()["participants"]) == 1

    def test_matches_case_insensitively(self, client: TestClient, trip: dict):
        response = client.post(
            f"/api/trips/{trip['token']}/participants/claim", json={"name": "  anna "}
        )
        assert response.status_code == 200
        assert response.json()["id"] == trip["anna"]["id"]

    def test_unknown_name_is_404(self, client: TestClient, trip: dict):
        response = client.post(
            f"/api/trips/{trip['token']}/participants/claim", json={"name": "Nobody"}
        )
        assert response.status_code == 404
        assert response.json()["code"] == "not_found"

    def test_empty_name_is_422(self, client: TestClient, trip: dict):
        response = client.post(f"/api/trips/{trip['token']}/participants/claim", json={"name": " "})
        assert response.status_code == 422
        assert response.json()["code"] == "name_empty"

    def test_does_not_touch_last_activity(self, client: TestClient, trip: dict):
        # openapi.yaml: read-only despite being a POST.
        before = client.get(f"/api/trips/{trip['token']}").json()["trip"]["lastActivityAt"]
        client.post(f"/api/trips/{trip['token']}/participants/claim", json={"name": "Anna"})
        after = client.get(f"/api/trips/{trip['token']}").json()["trip"]["lastActivityAt"]
        assert after == before

    def test_claim_is_not_mistaken_for_a_participant_id(self, client: TestClient, trip: dict):
        # The literal path must win over the {participantId} pattern.
        response = client.post(
            f"/api/trips/{trip['token']}/participants/claim", json={"name": "Anna"}
        )
        assert response.status_code == 200


class TestRename:
    def test_renames(self, client: TestClient, trip: dict):
        response = client.patch(
            f"/api/trips/{trip['token']}/participants/{trip['anna']['id']}",
            json={"name": "Anna K"},
        )
        assert response.status_code == 200
        assert response.json()["name"] == "Anna K"

    def test_applies_the_same_uniqueness_check(self, client: TestClient, trio: dict):
        response = client.patch(
            f"/api/trips/{trio['token']}/participants/{trio['max']['id']}",
            json={"name": "anna"},
        )
        assert response.status_code == 409
        assert response.json()["code"] == "name_taken"

    def test_allows_recasing_your_own_name(self, client: TestClient, trip: dict):
        response = client.patch(
            f"/api/trips/{trip['token']}/participants/{trip['anna']['id']}",
            json={"name": "ANNA"},
        )
        assert response.status_code == 200
        assert response.json()["name"] == "ANNA"

    def test_rejects_an_empty_name(self, client: TestClient, trip: dict):
        response = client.patch(
            f"/api/trips/{trip['token']}/participants/{trip['anna']['id']}", json={"name": " "}
        )
        assert response.status_code == 422
        assert response.json()["code"] == "name_empty"

    def test_unknown_participant_is_404(self, client: TestClient, trip: dict):
        response = client.patch(
            f"/api/trips/{trip['token']}/participants/p_nope", json={"name": "X"}
        )
        assert response.status_code == 404
        assert response.json()["code"] == "not_found"

    def test_expenses_stay_attached_through_a_rename(self, client: TestClient, trip: dict):
        token, anna = trip["token"], trip["anna"]["id"]
        client.post(f"/api/trips/{token}/expenses", json=expense_payload(anna))
        client.patch(f"/api/trips/{token}/participants/{anna}", json={"name": "Anna K"})
        balances = client.get(f"/api/trips/{token}").json()["balances"]
        assert balances[0]["paidCents"] == 1000

    def test_cannot_rename_someone_in_another_trip(self, client: TestClient, trip: dict):
        other = client.post(
            "/api/trips",
            json={"name": "Porto", "currencyLabel": "EUR", "creatorName": "Ben"},
        ).json()
        response = client.patch(
            f"/api/trips/{trip['token']}/participants/{other['participant']['id']}",
            json={"name": "Hijacked"},
        )
        assert response.status_code == 404


class TestDelete:
    def test_removes_someone_who_never_took_part(self, client: TestClient, trio: dict):
        response = client.delete(
            f"/api/trips/{trio['token']}/participants/{trio['sam']['id']}"
        )
        assert response.status_code == 204
        assert response.content == b""
        names = [p["name"] for p in client.get(f"/api/trips/{trio['token']}").json()["participants"]]
        assert names == ["Anna", "Max"]

    def test_refuses_someone_in_a_split(self, client: TestClient, trio: dict):
        token, anna, max_ = trio["token"], trio["anna"]["id"], trio["max"]["id"]
        client.post(
            f"/api/trips/{token}/expenses",
            json=expense_payload(anna, participantIds=[anna, max_]),
        )
        response = client.delete(f"/api/trips/{token}/participants/{max_}")
        assert response.status_code == 409
        body = response.json()
        assert body["code"] == "participant_in_use"
        assert body["details"]["splitCount"] == 1
        assert body["details"]["paidCount"] == 0

    def test_refuses_someone_who_paid_but_is_not_in_the_split(self, client: TestClient, trio: dict):
        token, anna, max_ = trio["token"], trio["anna"]["id"], trio["max"]["id"]
        client.post(
            f"/api/trips/{token}/expenses",
            json=expense_payload(anna, paidBy=max_, participantIds=[anna]),
        )
        response = client.delete(f"/api/trips/{token}/participants/{max_}")
        assert response.status_code == 409
        assert response.json()["details"]["paidCount"] == 1
        assert response.json()["details"]["splitCount"] == 0

    def test_allowed_once_the_last_expense_is_gone(self, client: TestClient, trio: dict):
        token, anna, max_ = trio["token"], trio["anna"]["id"], trio["max"]["id"]
        created = client.post(
            f"/api/trips/{token}/expenses",
            json=expense_payload(anna, participantIds=[anna, max_]),
        ).json()
        client.delete(f"/api/trips/{token}/expenses/{created['id']}")
        assert client.delete(f"/api/trips/{token}/participants/{max_}").status_code == 204

    def test_unknown_participant_is_404(self, client: TestClient, trip: dict):
        assert (
            client.delete(f"/api/trips/{trip['token']}/participants/p_nope").status_code == 404
        )
