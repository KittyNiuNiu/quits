# Quits

Splitting shared costs on trips and at events, among people who would rather
not install anything. One trip, one link, no accounts. The name is the end
state the app produces: everyone square.

Someone creates a trip and shares the link. Everyone who opens it enters a
name, adds what they paid, and sees who owes whom. There is nothing to sign up
for and nothing to install.

> **Status:** v1 is implemented and tested end to end, and runs locally.
> It is not deployed yet — the hosting target is still an open decision
> (SPEC §11.3), and SPEC §10 does not consider the project finished until it
> is reachable from a public URL.

---

## Quick start

Two processes: an API and a web app.

```sh
# Terminal 1 — the API on :8000
cd backend
uv sync
uv run uvicorn quits.app:app --reload

# Terminal 2 — the web app on :5173
cd frontend
npm install
npm run dev
```

On its first run the backend creates `backend/quits.db` and seeds a demo trip,
then prints the link:

```
  Database  sqlite:///./quits.db
  Seeded an empty database with a demo trip.
    Frontend  http://localhost:5173/t/<token>
```

Open that URL. The trip is stored, so the link keeps working across restarts.

To work on the UI without running a backend at all:

```sh
cd frontend && npm run dev:mock
```

---

## What it does

| | |
|---|---|
| **Trips** | Create one with a name, a currency label and your own name. Share the link. |
| **People** | Join by entering a name. Rename anyone. Remove anyone who is not yet on an expense. |
| **Expenses** | Description, amount, who paid, date, optional category, and who it is split between. |
| **Splitting** | Equally, by exact amounts, or by percentage — each with a live "left to assign" indicator. |
| **Balances** | Net position per person, the trip total, what each person paid, and a minimised list of transfers that settles everyone. |

The payer does not have to be in the split — buying tickets for other people
is a normal thing to do, and the app treats it as one.

---

## How it is built

```
_docs/SPEC.md    The specification. Authoritative.
openapi.yaml     The API contract, shared by both halves.
backend/         Python, FastAPI, SQLAlchemy, SQLite. Managed with uv.
frontend/        React, Vite. Managed with npm.
```

Each half has its own README with the details:
[backend/README.md](backend/README.md) · [frontend/README.md](frontend/README.md)

### The spec comes first

`_docs/SPEC.md` defines the complete v1 scope, and the code follows it rather
than the other way round. Where something here looks like a gap — no login, no
trip deletion, no way to record a payment — it is a decision recorded in the
spec, not an unfinished edge. Section references appear throughout the code for
exactly that reason.

### Money is integer cents, everywhere

No floating-point value touches an amount at any point, in either half.
Parsing `"12.40"` into `1240` is string manipulation, not a multiplication;
formatting back out slices a digit string rather than dividing. Percentages
are stored as integer basis points, so 33.33% is `3333`.

Every division of a total routes through a single `distribute()` function
using the largest-remainder method, with leftover cents going to the earliest
participant on a tie. It is the only rounding path in the codebase — the split
resolver calls it, the live preview in the expense form calls it, and the
percentage reconstruction when you reopen an expense calls it. Its tests were
written before it was, and they assert that the parts always sum back to the
whole.

That is why participant creation order is load-bearing and guaranteed by the
database rather than assumed: who receives the odd cent depends on it.

### Settling up is a computed view

The transfer list is recalculated from the expenses every time it is opened.
**Quits records no payments and nothing can be marked as paid.** Once you have
sent someone the money, it is settled between you.

This is deliberate rather than unfinished. Recording partial settlements is
out of scope for v1, and a half-tracked balance that nobody updates is worse
than none at all.

### The link is the only credential

There are no accounts, no passwords, no sessions and no roles. Whoever holds a
trip's link has full read and write access to that trip, including editing and
deleting entries they did not make. The person who created the trip has no
special rights afterwards.

The trade is stated plainly on the create screen: a lost link cannot be
recovered, because there is no account to recover it to. Trips are deleted
automatically twelve months after the last change, and there is no manual
delete — with a shared link and no owner, one careless tap would destroy
everyone's data.

### One contract, two implementations

Every backend call the web app makes goes through a single services layer. No
component builds a URL or calls `fetch`. Two implementations satisfy the same
contract — the real HTTP client, and an in-browser mock that makes the whole
app work with no server — and a test fails if they ever drift apart.

`openapi.yaml` documents all nine endpoints and was verified call-for-call
against the client that consumes them.

### Storage is swappable

The backend talks to a protocol with no SQL in it. SQLAlchemy lives behind
that seam, and the database is chosen by one environment variable:

```sh
QUITS_DATABASE_URL=sqlite:///./quits.db          # the default
QUITS_DATABASE_URL=postgresql+psycopg://…/quits  # after `uv add psycopg[binary]`
```

Dialect-specific behaviour is confined to two functions, and tests assert it
stays there, so a PostgreSQL URL does not inherit SQLite's workarounds.

---

## Tests

```sh
cd backend  && uv run pytest    # 299 tests
cd frontend && npm test         # 320 tests
```

Neither suite needs a running server. The backend builds a fresh in-memory
SQLite database per test — the real storage implementation, not a stand-in —
and the frontend suite is pinned to the in-browser mock so it can never make a
network call.

What they cover, beyond the obvious:

- **Rounding.** The table the spec requires, plus a randomised sweep asserting
  the parts always sum to the total.
- **Validation.** Every server-side rule, including the exact and percentage
  sums reporting how far off they are. Client-side checks are feedback only
  and never the gate.
- **The whole walkthrough.** Ten expenses across all three split modes,
  including one where the payer is outside the split, ending in balances that
  net to zero and a transfer list that settles everyone exactly.
- **Properties, not just cases.** That no money column is a float, that
  dialect-specific options stay dialect-specific, and that the HTTP client
  never leaks into a test run.

---

## Decisions

The spec left several questions open (§11). These were settled during
implementation and are recorded here because the spec itself is not edited:

| Question | Decision |
|---|---|
| Backend framework | FastAPI |
| Database | SQLite via SQLAlchemy, swappable by URL |
| Frontend test runner | Vitest with Testing Library |
| Routing | React Router |
| Currency rendering (§11.4) | A prefix: `EUR 1,234.56`. Works for any label, one rule and no special cases. |
| Join screen (§11.5) | A read-only preview comes first. Someone checking the numbers never becomes a participant. |
| Hosting (§11.3) | **Still open.** |

---

## Deliberately absent

Listed in SPEC §1 and excluded on purpose, not overlooked: accounts and login,
multiple currencies or conversion, weighted shares and itemised bills,
recording payments or partial settlements, offline support, receipt scanning,
notifications of any kind, data export, manual trip deletion, and
internationalisation.

Moving any of them into scope is a new decision, not a small change.

---

Built with [Claude Code](https://claude.com/claude-code) for the zoomcamp AI
dev tools course, 2026.
