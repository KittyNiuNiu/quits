"""The FastAPI application.

Routes are thin on purpose: resolve the service, hand over the request, shape
the response. Every rule lives in `service.py`, and storage behind `Database`.

The access model is SPEC §2: possession of the trip token is the only
credential, and it travels as a path segment. There is no Authorization
header, no cookie, no session and no role anywhere in this file — an unknown
token is simply a 404.
"""

from __future__ import annotations

from fastapi import Depends, FastAPI, Request, Response, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from quits.db import DatabaseFactory, Expense, Participant, Trip
from quits.errors import ApiError, ErrorCode
from quits.schemas import (
    BalanceOut,
    CreateTripIn,
    CreateTripOut,
    ExpenseIn,
    ExpenseOut,
    NameIn,
    ParticipantOut,
    SplitOut,
    TransferOut,
    TripOut,
    TripViewOut,
)
from quits.service import TripService
from quits.sql import create_database_factory

# The frontend dev server and its preview build. Production origins depend on
# the hosting target, which is still open (SPEC §11.3).
ALLOWED_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:4173",
    "http://127.0.0.1:4173",
]


def get_service(request: Request):
    """One unit of work per request.

    The transaction commits when the handler returns and rolls back if it
    raises, so a request rejected by SPEC §8 validation leaves nothing behind.
    """
    with request.app.state.database_factory() as db:
        yield TripService(db)


def _trip_out(trip: Trip) -> TripOut:
    return TripOut(
        id=trip.id,
        token=trip.token,
        name=trip.name,
        currency_label=trip.currency_label,
        created_at=trip.created_at,
        last_activity_at=trip.last_activity_at,
    )


def _participant_out(participant: Participant) -> ParticipantOut:
    return ParticipantOut(
        id=participant.id, name=participant.name, created_at=participant.created_at
    )


def _expense_out(expense: Expense, splits: list[tuple[str, int]]) -> ExpenseOut:
    return ExpenseOut(
        id=expense.id,
        description=expense.description,
        amount_cents=expense.amount_cents,
        paid_by=expense.paid_by,
        date=expense.date,
        category=expense.category,
        split_type=expense.split_type,
        created_by=expense.created_by,
        created_at=expense.created_at,
        splits=[SplitOut(participant_id=pid, amount_cents=amount) for pid, amount in splits],
    )


def create_app(database_factory: DatabaseFactory | None = None) -> FastAPI:
    """Build an app around a database.

    The factory is a parameter so tests get an isolated database per case, and
    so the engine is chosen at the call site rather than baked in. Omitted, it
    comes from QUITS_DATABASE_URL (see `sql.py`).
    """
    app = FastAPI(
        title="Quits API",
        version="1.0.0",
        description=(
            "Expense splitting for trips and events. Possession of the trip "
            "token is the only credential (SPEC §2)."
        ),
    )
    app.state.database_factory = (
        database_factory if database_factory is not None else create_database_factory()
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=ALLOWED_ORIGINS,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type"],
    )

    # --- error shaping ----------------------------------------------------
    # Every failure leaves as {code, message, details}. The client dispatches
    # on `code` and shows `message` verbatim.

    @app.exception_handler(ApiError)
    async def _api_error(_: Request, error: ApiError) -> JSONResponse:
        return JSONResponse(status_code=error.status_code, content=error.to_body())

    @app.exception_handler(RequestValidationError)
    async def _malformed(_: Request, error: RequestValidationError) -> JSONResponse:
        # Reached only for a body the documented codes cannot describe — not
        # JSON at all, say. The frontend cannot produce one.
        return JSONResponse(
            status_code=422,
            content={
                "code": ErrorCode.INVALID_REQUEST,
                "message": "That request could not be read.",
                "details": {},
            },
        )

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_: Request, error: StarletteHTTPException) -> JSONResponse:
        # Starlette raises these for addresses and methods the router does not
        # have. A missing route is not a missing trip, so this must not claim
        # the trip link is invalid — a request for "/" never carried one.
        # Genuine token lookups raise ApiError from the service and keep their
        # own wording.
        if error.status_code == 404:
            code = ErrorCode.NOT_FOUND
            message = "There is nothing at that address."
        elif error.status_code == 405:
            code = ErrorCode.INVALID_REQUEST
            message = "That method is not allowed on this endpoint."
        else:
            code = ErrorCode.INVALID_REQUEST
            message = str(error.detail)
        return JSONResponse(
            status_code=error.status_code,
            content={"code": code, "message": message, "details": {}},
        )

    # --- trips ------------------------------------------------------------

    @app.post(
        "/api/trips",
        response_model=CreateTripOut,
        status_code=status.HTTP_201_CREATED,
        tags=["Trips"],
        summary="Create a trip",
    )
    def create_trip(body: CreateTripIn, service: TripService = Depends(get_service)):
        """SPEC §7.1. The only endpoint needing no credential — it is what
        issues one."""
        trip, participant = service.create_trip(body.name, body.currency_label, body.creator_name)
        return CreateTripOut(trip=_trip_out(trip), participant=_participant_out(participant))

    @app.get(
        "/api/trips/{token}",
        response_model=TripViewOut,
        tags=["Trips"],
        summary="Read a trip in full",
    )
    def get_trip(token: str, service: TripService = Depends(get_service)):
        """SPEC §7.2. Readable without an identity — the preview comes before
        the join screen (SPEC §11.5)."""
        view = service.trip_view(token)
        return TripViewOut(
            trip=_trip_out(view["trip"]),
            participants=[_participant_out(p) for p in view["participants"]],
            expenses=[_expense_out(e, splits) for e, splits in view["expenses"]],
            balances=[
                BalanceOut(
                    participant_id=b.participant_id,
                    paid_cents=b.paid_cents,
                    owed_cents=b.owed_cents,
                    net_cents=b.net_cents,
                )
                for b in view["balances"]
            ],
            transfers=[
                TransferOut(
                    from_participant_id=t.from_participant_id,
                    to_participant_id=t.to_participant_id,
                    amount_cents=t.amount_cents,
                )
                for t in view["transfers"]
            ],
            total_cents=view["total_cents"],
        )

    # NOTE: there is deliberately no DELETE for a trip (SPEC §1, §7.4, §9).

    # --- participants -----------------------------------------------------

    @app.post(
        "/api/trips/{token}/participants",
        response_model=ParticipantOut,
        status_code=status.HTTP_201_CREATED,
        tags=["Participants"],
        summary="Join a trip under a new name",
    )
    def join_trip(token: str, body: NameIn, service: TripService = Depends(get_service)):
        """SPEC §7.5."""
        return _participant_out(service.join(token, body.name))

    @app.post(
        "/api/trips/{token}/participants/claim",
        response_model=ParticipantOut,
        tags=["Participants"],
        summary="Bind to an existing participant from another device",
    )
    def claim_participant(
        token: str, body: NameIn, service: TripService = Depends(get_service)
    ):
        """SPEC §7.6. Read-only despite being a POST: it creates nothing."""
        return _participant_out(service.claim(token, body.name))

    @app.patch(
        "/api/trips/{token}/participants/{participant_id}",
        response_model=ParticipantOut,
        tags=["Participants"],
        summary="Rename a participant",
    )
    def rename_participant(
        token: str,
        participant_id: str,
        body: NameIn,
        service: TripService = Depends(get_service),
    ):
        """SPEC §7.7."""
        return _participant_out(service.rename(token, participant_id, body.name))

    @app.delete(
        "/api/trips/{token}/participants/{participant_id}",
        status_code=status.HTTP_204_NO_CONTENT,
        response_class=Response,
        tags=["Participants"],
        summary="Remove a participant",
    )
    def delete_participant(
        token: str, participant_id: str, service: TripService = Depends(get_service)
    ):
        """SPEC §7.8. Only when they are on no expenses at all."""
        service.remove_participant(token, participant_id)
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    # --- expenses ---------------------------------------------------------

    @app.post(
        "/api/trips/{token}/expenses",
        response_model=ExpenseOut,
        status_code=status.HTTP_201_CREATED,
        tags=["Expenses"],
        summary="Add an expense",
    )
    def create_expense(
        token: str, body: ExpenseIn, service: TripService = Depends(get_service)
    ):
        """SPEC §7.10."""
        expense, splits = service.create_expense(token, body)
        return _expense_out(expense, splits)

    @app.put(
        "/api/trips/{token}/expenses/{expense_id}",
        response_model=ExpenseOut,
        tags=["Expenses"],
        summary="Replace an expense",
    )
    def update_expense(
        token: str,
        expense_id: str,
        body: ExpenseIn,
        service: TripService = Depends(get_service),
    ):
        """SPEC §7.15. `createdBy` is accepted but ignored."""
        expense, splits = service.update_expense(token, expense_id, body)
        return _expense_out(expense, splits)

    @app.delete(
        "/api/trips/{token}/expenses/{expense_id}",
        status_code=status.HTTP_204_NO_CONTENT,
        response_class=Response,
        tags=["Expenses"],
        summary="Delete an expense",
    )
    def delete_expense(
        token: str, expense_id: str, service: TripService = Depends(get_service)
    ):
        """SPEC §7.16."""
        service.delete_expense(token, expense_id)
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    return app


def _serve_app() -> FastAPI:
    """The app `uvicorn quits.app:app` serves.

    Connects to QUITS_DATABASE_URL, creates any missing tables, and seeds the
    demo trip only when the database has no trips at all — so a fresh install
    has something to look at, and an existing database is never added to.
    """
    from quits.seed import seed_demo_trip_if_empty
    from quits.sql import database_url

    url = database_url()
    factory = create_database_factory(url)
    trip = seed_demo_trip_if_empty(factory)

    print(f"\n  Database  {url}", flush=True)
    if trip is not None:
        print(
            "  Seeded an empty database with a demo trip.\n"
            f"    API       http://localhost:8000/api/trips/{trip.token}\n"
            f"    Frontend  http://localhost:5173/t/{trip.token}\n",
            flush=True,
        )
    else:
        print("  Existing data found — not seeding.\n", flush=True)

    return create_app(factory)


_served_app: FastAPI | None = None


def __getattr__(name: str):
    """Build the served app only when `uvicorn quits.app:app` asks for it.

    Importing this module must not connect to a database or create files —
    tests import `create_app` from here and supply their own.
    """
    global _served_app
    if name == "app":
        if _served_app is None:
            _served_app = _serve_app()
        return _served_app
    raise AttributeError(name)
