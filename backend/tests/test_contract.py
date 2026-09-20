"""The parts of openapi.yaml that are not about one endpoint in particular:
the error envelope, the route table, the access model, and the database seam.
"""

from fastapi.testclient import TestClient

from quits.app import create_app
from quits.sql import create_database_factory
from .conftest import expense_payload

# Exactly the operations openapi.yaml declares. Nothing more is exposed.
DOCUMENTED_ROUTES = {
    ("POST", "/api/trips"),
    ("GET", "/api/trips/{token}"),
    ("POST", "/api/trips/{token}/participants"),
    ("POST", "/api/trips/{token}/participants/claim"),
    ("PATCH", "/api/trips/{token}/participants/{participant_id}"),
    ("DELETE", "/api/trips/{token}/participants/{participant_id}"),
    ("POST", "/api/trips/{token}/expenses"),
    ("PUT", "/api/trips/{token}/expenses/{expense_id}"),
    ("DELETE", "/api/trips/{token}/expenses/{expense_id}"),
}


class TestRouteTable:
    def test_exposes_exactly_the_documented_operations(self, client: TestClient):
        actual = {
            (method, route.path)
            for route in client.app.routes
            if getattr(route, "methods", None)
            for method in route.methods
            if method not in {"HEAD", "OPTIONS"} and route.path.startswith("/api")
        }
        assert actual == DOCUMENTED_ROUTES

    def test_has_no_trip_deletion_route(self, client: TestClient):
        # SPEC §1, §7.4, §9: deliberately absent, not forgotten.
        paths = {route.path for route in client.app.routes if getattr(route, "methods", None)}
        assert "/api/trips/{token}" in paths
        methods = {
            method
            for route in client.app.routes
            if getattr(route, "methods", None) and route.path == "/api/trips/{token}"
            for method in route.methods
        }
        assert "DELETE" not in methods


class TestErrorEnvelope:
    def test_every_error_has_code_and_message(self, client: TestClient, trip: dict):
        failures = [
            client.get("/api/trips/nope"),
            client.post("/api/trips", json={"name": "", "creatorName": "Anna"}),
            client.post(f"/api/trips/{trip['token']}/participants", json={"name": "Anna"}),
            client.post(
                f"/api/trips/{trip['token']}/expenses",
                json=expense_payload(trip["anna"]["id"], amountCents=0),
            ),
        ]
        for response in failures:
            body = response.json()
            assert response.status_code >= 400
            assert isinstance(body.get("code"), str) and body["code"]
            assert isinstance(body.get("message"), str) and body["message"]
            assert isinstance(body.get("details", {}), dict)

    def test_messages_are_human_readable(self, client: TestClient, trip: dict):
        # The frontend shows `message` verbatim, so it must be a sentence.
        body = client.post(
            f"/api/trips/{trip['token']}/participants", json={"name": "Anna"}
        ).json()
        assert "Anna" in body["message"]
        assert body["message"].endswith((".", "!", '"'))

    def test_a_malformed_body_still_returns_the_envelope(self, client: TestClient, trip: dict):
        response = client.post(
            f"/api/trips/{trip['token']}/participants",
            content=b"this is not json",
            headers={"Content-Type": "application/json"},
        )
        assert response.status_code >= 400
        body = response.json()
        assert isinstance(body.get("code"), str)
        assert isinstance(body.get("message"), str)

    def test_no_content_responses_carry_no_body(self, client: TestClient, trio: dict):
        response = client.delete(f"/api/trips/{trio['token']}/participants/{trio['sam']['id']}")
        assert response.status_code == 204
        assert response.content == b""


class TestAccessModel:
    """SPEC §2: possession of the trip token is the only credential."""

    def test_no_endpoint_asks_for_a_header_or_cookie(self, client: TestClient, trip: dict):
        # No Authorization, no cookie, no API key — and everything still works.
        assert client.get(f"/api/trips/{trip['token']}").status_code == 200

    def test_a_wrong_token_is_404_never_401_or_403(self, client: TestClient):
        for response in [
            client.get("/api/trips/wrong"),
            client.post("/api/trips/wrong/participants", json={"name": "X"}),
            client.delete("/api/trips/wrong/expenses/e_1"),
        ]:
            assert response.status_code == 404
            assert response.json()["code"] == "not_found"

    def test_holding_the_token_grants_full_write_access(self, client: TestClient, trio: dict):
        # No roles: the creator has no elevated rights, and Max may delete
        # what Anna entered.
        token, anna, max_ = trio["token"], trio["anna"]["id"], trio["max"]["id"]
        created = client.post(
            f"/api/trips/{token}/expenses", json=expense_payload(anna, createdBy=anna)
        ).json()
        assert client.delete(f"/api/trips/{token}/expenses/{created['id']}").status_code == 204

    def test_one_trips_token_gives_no_access_to_another(self, client: TestClient, trip: dict):
        other = client.post(
            "/api/trips", json={"name": "Porto", "currencyLabel": "EUR", "creatorName": "Ben"}
        ).json()
        response = client.delete(
            f"/api/trips/{trip['token']}/participants/{other['participant']['id']}"
        )
        assert response.status_code == 404


class TestDatabaseSeam:
    """Storage is swappable — that is the whole point of the seam."""

    def test_two_databases_do_not_share_state(self, trip: dict):
        fresh = TestClient(create_app(create_database_factory("sqlite://")))
        assert fresh.get(f"/api/trips/{trip['token']}").status_code == 404

    def test_the_app_writes_through_the_database_it_was_handed(self):
        factory = create_database_factory("sqlite://")
        client = TestClient(create_app(factory))
        client.post(
            "/api/trips", json={"name": "Lisbon", "currencyLabel": "EUR", "creatorName": "Anna"}
        )
        # Not a global, and not the app's own private engine.
        with factory() as db:
            assert db.any_trips()

    def test_a_rejected_write_leaves_nothing_behind(self, client: TestClient, trip: dict):
        # The unit of work rolls back, so a SPEC §8 rejection cannot leave a
        # half-written expense or an orphaned participant.
        before = client.get(f"/api/trips/{trip['token']}").json()
        response = client.post(
            f"/api/trips/{trip['token']}/expenses",
            json=expense_payload(trip["anna"]["id"], amountCents=0),
        )
        assert response.status_code == 422
        assert client.get(f"/api/trips/{trip['token']}").json() == before


class TestBrowserAccess:
    def test_allows_the_frontend_origin(self, client: TestClient, trip: dict):
        # The frontend runs on a different port, so without CORS the browser
        # blocks every call.
        response = client.get(
            f"/api/trips/{trip['token']}", headers={"Origin": "http://localhost:5173"}
        )
        assert response.headers.get("access-control-allow-origin") == "http://localhost:5173"

    def test_allows_the_methods_the_client_uses(self, client: TestClient, trip: dict):
        response = client.options(
            f"/api/trips/{trip['token']}/expenses/e_1",
            headers={
                "Origin": "http://localhost:5173",
                "Access-Control-Request-Method": "PUT",
                "Access-Control-Request-Headers": "content-type",
            },
        )
        assert response.status_code < 400
        allowed = response.headers.get("access-control-allow-methods", "")
        assert "PUT" in allowed or allowed == "*"


class TestNotFoundWording:
    """A missing route and a missing trip are different things, and the client
    shows `message` verbatim."""

    def test_an_unrouted_path_does_not_blame_the_trip_link(self, client: TestClient):
        for path in ["/", "/api", "/favicon.ico", "/api/nope"]:
            body = client.get(path).json()
            assert body["code"] == "not_found"
            assert "trip link" not in body["message"].lower(), path

    def test_an_unknown_token_does_blame_the_trip_link(self, client: TestClient):
        body = client.get("/api/trips/no-such-token").json()
        assert body["code"] == "not_found"
        assert "trip link" in body["message"].lower()

    def test_a_wrong_method_says_so(self, client: TestClient, trip: dict):
        response = client.delete(f"/api/trips/{trip['token']}")
        assert response.status_code == 405
        assert "method" in response.json()["message"].lower()
