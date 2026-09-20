# Quits — frontend

React + Vite. `_docs/SPEC.md` is authoritative; this implements §2–§8 and §10
of it for the browser.

## Running it

```sh
npm install
npm run dev      # http://localhost:5173 — talks to the backend on :8000
npm run dev:mock # http://localhost:5173 — no backend needed
npm test         # the whole suite
npm run build    # production build
```

`npm run dev` expects the backend running on `http://localhost:8000`:

```sh
cd ../backend && uv run uvicorn quits.app:app --reload
```

`npm run dev:mock` runs the app with no server at all, against a complete
in-browser implementation of the same contract. Useful for UI work, and it is
what the test suite runs against.

## The services layer

Every backend call in the app goes through `src/services/`. No component
contains a `fetch`, a URL, or a storage key.

| File | What it is |
|---|---|
| `contract.js` | The method list, the shapes, and a startup guard |
| `errors.js` | `ApiError` and the error codes, one per §8 rule |
| `mockBackend.js` | In-browser implementation, backed by `localStorage` |
| `httpBackend.js` | Real HTTP implementation, waiting on a backend |
| `index.js` | Picks one and exports `api` |

Components import `api` from `src/services/index.js` and nothing else:

```js
import { api } from '../services/index.js'
const view = await api.getTrip(token)
```

`index.js` picks one, in this order:

1. under the test runner (`VITEST`) — the mock, so tests stay offline and
   deterministic
2. `VITE_API_MOCK=true` — the mock, for running the UI with no server
3. `VITE_API_BASE_URL` — that server
4. otherwise — `http://localhost:8000`

The real backend is the default. The mock is opt-in, so a misconfigured app
fails loudly against a missing server rather than quietly serving different
data out of `localStorage`.

Nothing else in the app knows which one is live, and `contract.test.js` fails
if the two ever drift apart — or if the HTTP backend ever leaks into a test
run.

**Deployments must set `VITE_API_BASE_URL` at build time.** It is baked into
the bundle, and a build without it calls `localhost:8000`, which in a browser
means the viewer's own machine. The app logs a warning in production builds
when that happens. There is no production default here because the hosting
target is still an open decision (SPEC §11.3).

The mock is written the way a server would be: it owns the data, enforces
every §8 rule itself, and computes balances and transfers before returning
them. The UI cannot reach around it. That is what makes it worth trusting as a
stand-in — the client-side checks in the forms are feedback, exactly as §8
requires, and the mock is the thing that actually says no.

Mock data lives under the `quits.mock.v1` key in `localStorage`, so a refresh
or a second tab behaves like a shared trip. Clearing site data resets it.

### Routes the HTTP backend expects

These are a proposal, not a decision — the backend framework is still open
(§11.1). `httpBackend.js` is the only file to change if they land differently.

```
POST   /api/trips
GET    /api/trips/:token
POST   /api/trips/:token/participants
POST   /api/trips/:token/participants/claim
PATCH  /api/trips/:token/participants/:id
DELETE /api/trips/:token/participants/:id
POST   /api/trips/:token/expenses
PUT    /api/trips/:token/expenses/:id
DELETE /api/trips/:token/expenses/:id
```

Errors come back as `{ code, message, details }`, where `code` is one of the
values in `errors.js`.

## Money

All amounts are integer cents and no float touches money anywhere. Parsing
`"12.40"` into `1240` is string surgery, not a multiplication, and formatting
back out slices a digit string rather than dividing. Percentages are integer
basis points.

Every division of a total goes through `distribute()` in `src/lib/money.js`.
It is the only rounding path in the codebase — `resolveSplit()` calls it for
equal and percent splits, the expense form calls it for the live per-person
preview, and `deriveBasisPoints()` calls it to rebuild percentages when you
reopen a percent expense. Its tests were written before it was.

Splits are stored as resolved cents. `splitType` only records how the rows
were produced; balances and settlement sum `amountCents` and never learn that
split modes exist.

## Settling up is a computed view

The transfer list is recalculated from the expenses every time it is opened.
Quits records no payments and nothing can be marked as paid. Once you have
sent someone the money, it is settled between you.

This is deliberate, not unfinished: recording partial settlements is out of
scope for v1 (§1), and a half-tracked balance that nobody updates is worse
than none.

## Decisions taken here

The spec left these open (§11). They were settled in conversation before this
code was written, and are recorded here because the spec cannot be edited:

- **Currency rendering (§11.4)** — the label is a prefix: `EUR 1,234.56`. It
  works for any label, including ones that are not currency codes, and there
  is one rule rather than a table of special cases.
- **Join screen (§11.5)** — a read-only preview comes first. A visitor sees
  the trip and is asked for a name only when they try to change something, so
  someone who just wants to check the numbers never becomes a participant.
- **Test runner** — Vitest with Testing Library, sharing Vite's config.
- **Routing** — React Router.

Still open, and not decided here: the backend framework, the database, and the
hosting target. §10 requires a public deployment, which this repo does not yet
have.

## Layout

```
src/
  lib/          money, splits, balances, categories, dates, storage, identity
  services/     the backend contract and its two implementations
  hooks/        useTrip, useIdentity
  components/   expense form and list, balances, people, join, share, modal
  pages/        create trip, trip, not found
  test/         setup and the render helper
```

Tests sit next to what they test. 316 of them:

- `lib/money.test.js` — the §5 rounding table, the sum guarantee over a
  randomised sweep, and the parse/format edges a float would get wrong
- `lib/splits.test.js`, `lib/balances.test.js` — split resolution, net
  balances, greedy settlement
- `services/mockBackend.test.js` — every §8 rule, plus the §12
  definition-of-done walkthrough end to end
- `services/contract.test.js` — both implementations stay interchangeable
- `pages/*.test.jsx` — the real screens driven through real clicks: join, the
  taken-name path, all three split modes with their live indicators, editing,
  deleting, balances, rename and remove
