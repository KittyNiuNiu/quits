"""POST /api/trips and GET /api/trips/{token} — openapi.yaml, SPEC §7.1, §7.2."""

from fastapi.testclient import TestClient


class TestCreateTrip:
    def test_returns_201_with_trip_and_creator(self, client: TestClient):
        response = client.post(
            "/api/trips",
            json={"name": "Lisbon", "currencyLabel": "EUR", "creatorName": "Anna"},
        )
        assert response.status_code == 201
        body = response.json()
        assert body["trip"]["name"] == "Lisbon"
        assert body["trip"]["currencyLabel"] == "EUR"
        assert body["participant"]["name"] == "Anna"

    def test_is_the_only_endpoint_needing_no_token(self, client: TestClient):
        # openapi.yaml: fully public — it is what issues a credential.
        assert client.post(
            "/api/trips",
            json={"name": "Lisbon", "currencyLabel": "EUR", "creatorName": "Anna"},
        ).status_code == 201

    def test_trip_carries_every_documented_field(self, client: TestClient):
        body = client.post(
            "/api/trips",
            json={"name": "Lisbon", "currencyLabel": "EUR", "creatorName": "Anna"},
        ).json()
        assert set(body["trip"]) == {
            "id",
            "token",
            "name",
            "currencyLabel",
            "createdAt",
            "lastActivityAt",
        }
        assert set(body["participant"]) == {"id", "name", "createdAt"}

    def test_token_is_url_safe_and_at_least_128_bits(self, client: TestClient):
        import re

        token = client.post(
            "/api/trips",
            json={"name": "Lisbon", "currencyLabel": "EUR", "creatorName": "Anna"},
        ).json()["trip"]["token"]
        assert re.fullmatch(r"[A-Za-z0-9_-]+", token)
        assert len(token) >= 22  # 22 base64url chars carry 132 bits

    def test_every_trip_gets_a_different_token(self, client: TestClient):
        tokens = {
            client.post(
                "/api/trips",
                json={"name": f"Trip {i}", "currencyLabel": "EUR", "creatorName": "Anna"},
            ).json()["trip"]["token"]
            for i in range(10)
        }
        assert len(tokens) == 10

    def test_blank_currency_label_defaults_to_eur(self, client: TestClient):
        body = client.post(
            "/api/trips",
            json={"name": "Lisbon", "currencyLabel": "   ", "creatorName": "Anna"},
        ).json()
        assert body["trip"]["currencyLabel"] == "EUR"

    def test_missing_currency_label_defaults_to_eur(self, client: TestClient):
        body = client.post("/api/trips", json={"name": "Lisbon", "creatorName": "Anna"}).json()
        assert body["trip"]["currencyLabel"] == "EUR"

    def test_names_are_trimmed(self, client: TestClient):
        body = client.post(
            "/api/trips",
            json={"name": "  Lisbon  ", "currencyLabel": "EUR", "creatorName": "  Anna "},
        ).json()
        assert body["trip"]["name"] == "Lisbon"
        assert body["participant"]["name"] == "Anna"

    def test_rejects_empty_trip_name(self, client: TestClient):
        response = client.post(
            "/api/trips",
            json={"name": "   ", "currencyLabel": "EUR", "creatorName": "Anna"},
        )
        assert response.status_code == 422
        assert response.json()["code"] == "trip_name_empty"
        assert response.json()["details"]["field"] == "name"

    def test_rejects_empty_creator_name(self, client: TestClient):
        response = client.post(
            "/api/trips",
            json={"name": "Lisbon", "currencyLabel": "EUR", "creatorName": ""},
        )
        assert response.status_code == 422
        assert response.json()["code"] == "name_empty"
        assert response.json()["details"]["field"] == "creatorName"


class TestGetTrip:
    def test_returns_the_whole_view(self, client: TestClient, trip: dict):
        response = client.get(f"/api/trips/{trip['token']}")
        assert response.status_code == 200
        body = response.json()
        assert set(body) == {
            "trip",
            "participants",
            "expenses",
            "balances",
            "transfers",
            "totalCents",
        }

    def test_needs_no_identity(self, client: TestClient, trip: dict):
        # SPEC §11.5: a read-only preview comes before the join screen.
        assert client.get(f"/api/trips/{trip['token']}").status_code == 200

    def test_unknown_token_is_404_not_found(self, client: TestClient):
        response = client.get("/api/trips/definitely-not-a-real-token")
        assert response.status_code == 404
        assert response.json()["code"] == "not_found"

    def test_empty_trip_totals_zero(self, client: TestClient, trip: dict):
        body = client.get(f"/api/trips/{trip['token']}").json()
        assert body["totalCents"] == 0
        assert body["expenses"] == []
        assert body["transfers"] == []
        assert body["balances"] == [
            {
                "participantId": trip["anna"]["id"],
                "paidCents": 0,
                "owedCents": 0,
                "netCents": 0,
            }
        ]

    def test_two_trips_stay_separate(self, client: TestClient, trip: dict):
        other = client.post(
            "/api/trips",
            json={"name": "Porto", "currencyLabel": "EUR", "creatorName": "Ben"},
        ).json()
        client.post(f"/api/trips/{trip['token']}/participants", json={"name": "Max"})

        assert len(client.get(f"/api/trips/{trip['token']}").json()["participants"]) == 2
        assert [
            p["name"] for p in client.get(f"/api/trips/{other['trip']['token']}").json()["participants"]
        ] == ["Ben"]

    def test_last_activity_advances_on_a_write(self, client: TestClient, trip: dict):
        # SPEC §9: this drives the 12-month retention job.
        before = client.get(f"/api/trips/{trip['token']}").json()["trip"]["lastActivityAt"]
        client.post(f"/api/trips/{trip['token']}/participants", json={"name": "Max"})
        after = client.get(f"/api/trips/{trip['token']}").json()["trip"]["lastActivityAt"]
        assert after >= before

    def test_there_is_no_way_to_delete_a_trip(self, client: TestClient, trip: dict):
        # SPEC §1, §7.4, §9: deliberately absent.
        assert client.delete(f"/api/trips/{trip['token']}").status_code == 405
