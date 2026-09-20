# Quits — backend

FastAPI, managed with `uv`. Implements `openapi.yaml` at the repository root,
which is derived from the frontend's API client. `_docs/SPEC.md` is
authoritative for behaviour.

## Running it

```sh
uv sync                                   # install
uv run pytest                             # the whole suite
uv run pytest tests/test_split.py         # the §5 rounding table
uv run uvicorn quits.app:app --reload     # http://localhost:8000
```

Interactive docs at `/docs` once it is running.

To point the frontend at it:

```sh
cd ../frontend && VITE_API_BASE_URL=http://localhost:8000 npm run dev
```

## The database

SQLite via SQLAlchemy, configured by one environment variable:

```sh
QUITS_DATABASE_URL=sqlite:///./quits.db     # the default
QUITS_DATABASE_URL=sqlite:////tmp/scratch.db
QUITS_DATABASE_URL=sqlite://                # in memory, which the tests use
```

Unset, it defaults to `sqlite:///./quits.db` — a single file in the backend
directory, gitignored. Missing tables are created at startup.

### Database-agnostic

`db.py` defines the seam: plain dataclasses and a `Database` protocol with no
SQL in it. `sql.py` is the only module that knows SQLAlchemy exists, and it
uses portable column types and Core constructs throughout, so the connection
URL picks the dialect.

Adding PostgreSQL later is two steps and no code change here:

```sh
uv add "psycopg[binary]"
QUITS_DATABASE_URL=postgresql+psycopg://user:pass@host/quits uv run uvicorn quits.app:app
```

The dialect-specific code is deliberately confined to two functions in
`sql.py`, each with the reason it exists:

- `_engine_options` — SQLite needs `check_same_thread=False` because FastAPI
  runs the endpoints in a threadpool, and an in-memory SQLite database needs a
  single shared connection or every pooled connection gets its own empty
  database. Other engines get neither.
- `_register_dialect_hooks` — SQLite ignores foreign keys unless asked per
  connection. Other engines enforce them already.

`test_database.py` asserts those stay SQLite-only, and that no money column is
ever a `Float` or `Numeric` (SPEC §5).

### One transaction per request

`create_app` takes a *factory*, not a database. Each request opens one unit of
work that commits when the handler returns and rolls back if it raises — so a
request rejected by SPEC §8 validation leaves nothing behind. It is also how
each test gets an isolated database.

Writes are addressed by id and never by mutating a returned record. The
records handed back are frozen snapshots. The earlier in-memory store returned
live objects, so `expense.amount_cents = x` happened to persist; against a
database that is a silent no-op, and the protocol now makes it impossible to
write that way by accident.

### Demo data

`uvicorn quits.app:app` seeds one trip **only when the database has no trips
in it**, so a fresh install has something to look at and an existing database
is never added to. It prints the link:

```
  Demo trip ready — the mock database is seeded.
    API       http://localhost:8000/api/trips/<token>
    Frontend  http://localhost:5173/t/<token>
```

Three people, ten expenses across all three split modes, one expense whose
payer is not in the split, and balances that produce a real transfer list.

`seed.py` builds it through `TripService`, never by writing rows, so the
fixture has to pass every SPEC §8 rule and every split goes through
`distribute()`. If it ever described something the API would reject, startup
fails instead of leaving impossible data in the database.

The trip is now stored, so **the link survives restarts** — the server prints
`Existing data found — not seeding.` and the same URL keeps working. To start
over, delete the database file (or point `QUITS_DATABASE_URL` somewhere else)
and restart.

Tests build their own in-memory database per case and never see this data.

## Layout

```
quits/
  app.py         FastAPI app factory, routes, error shaping, CORS
  service.py     domain operations and every SPEC §8 rule
  db.py          the storage seam: records and the Database protocol, no SQL
  sql.py         SQLAlchemy implementation, engine, schema, unit of work
  schemas.py     request and response models (camelCase on the wire)
  money.py       distribute() — the single rounding path
  splits.py      split mode -> resolved cents
  balances.py    net balances and the greedy settlement list
  categories.py  the fixed category list
  errors.py      ApiError and the shared error codes
tests/
  test_split.py        SPEC §5 rounding, written before distribute()
  test_trips.py        create and read
  test_participants.py join, claim, rename, remove
  test_expenses.py     create, update, delete, and all §8 validation
  test_balances.py     balances, transfers, the §12 walkthrough
  test_contract.py     error envelope, route table, access model, db seam
```

## Access model

There is no authentication in the usual sense (SPEC §2). No accounts, no
sessions, no roles, no headers. Possession of the trip token is the only
credential and it travels as a path segment:

- `POST /api/trips` is public — it is what issues a token.
- Everything under `/api/trips/{token}` is guarded by that token.

An unknown token is `404 not_found`, never 401 or 403: with no roles there is
nothing else access could depend on, and it avoids confirming which tokens
exist. Keep the token out of access logs — it is in the request path.

## Money

Integer cents everywhere; no float touches money. Percentages are integer
basis points. Every division of a total goes through `distribute()` in
`money.py`, using largest remainder with ties broken by ascending participant
`created_at` — which is why `participants_of` sorts by `(created_at, seq)`.
`seq` stands in for the autoincrement key a real database provides, because
two participants can be created inside the same microsecond and the rounding
tie-break must not depend on a random id.

Its tests were written before it was.

## Known toolchain issue on this machine

`uv sync` installs the project in editable mode via a `.pth` file, and on
macOS uv writes that file with the `UF_HIDDEN` flag. Python 3.14's `site`
module skips hidden `.pth` files, so the editable install silently does
nothing and `import quits` fails outside the test runner.

The package layout is flat (`backend/quits/`, not `backend/src/quits/`) so
nothing depends on that `.pth`: pytest imports it from the project root, and
uvicorn from the working directory. Both commands above work as written.

If you need `import quits` to work from an arbitrary directory:

```sh
chflags nohidden .venv/lib/python3.14/site-packages/*.pth
```

That has to be repeated after any sync that rewrites the file.
