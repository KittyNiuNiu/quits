# Quits — Specification v1

Quits is a web app for splitting shared costs on trips and at events among
friends and family. One trip, a shared link, no accounts. The name is the end
state the app produces: everyone square.

This is the **complete** scope for v1. Everything in §1 is excluded
deliberately. Nothing there is a commitment for a later version — moving any of
it in is a new scoping decision.

**Stack:** Python backend managed with `uv`; Node.js frontend. Built with
Claude Code.

---

## 1. Out of scope for v1

None of the following are in v1:

- User accounts, login, passwords, OAuth
- Multiple currencies or exchange rates
- Weighted shares, itemised bills, tax/tip distribution
- Recording payments or partial settlements
- Offline support, PWA, native apps
- Receipt scanning, OCR, AI features
- Notifications or email of any kind
- Data export
- Manual trip deletion
- Internationalisation / language switching

---

## 2. Access model

There are **no accounts and no roles**. Possession of the trip link is the only
credential.

- The trip URL contains a secret token. Anyone with it has full read and write
  access to that trip.
- The trip creator has **no** elevated rights after creation.
- There is no recovery. A lost link means lost access, since there is no
  account to recover to. The create screen must state this.
- Anyone with the link may edit or delete any expense, including ones they did
  not enter. This is deliberate.

---

## 3. Identity

Participants identify themselves by name; the app never authenticates anyone.

**Creation:** the creator supplies a trip name, a currency label, and their own
name. They are participant #1. They do **not** pre-list other participants.

**Joining:** a visitor opens the link and is asked for their name. That name
creates a new participant and is bound to their browser via `localStorage`.

**Uniqueness:** participant names are unique within a trip, compared
case-insensitively after trimming whitespace. A taken name is rejected at entry
with a message telling the visitor to add a distinguishing suffix — the app does
**not** ask "is this you?" and does not attempt fuzzy matching.

**Device state:**

- Identity lives only in `localStorage` and is a UI convenience. All financial
  data lives in the trip.
- A "Not you? Switch" control reopens the identify screen, for shared phones.
- Cleared storage falls back to the identify screen. The existing name can be
  re-selected; this must not create a duplicate participant.
- The same person on a second device re-enters their name and, because of the
  uniqueness rule, is told the name is taken. Provide a "this is me on another
  device" path that binds to the existing participant rather than creating one.

**Effect of a known identity:** pre-fills the payer field on the expense form
and lets the balance view phrase things in second person ("You owe Max $45.00").

---

## 4. Data model

### Trip
| Field | Notes |
|---|---|
| `id` | Internal |
| `token` | Secret URL token, cryptographically random, ≥128 bits, URL-safe |
| `name` | Required |
| `currency_label` | Display string only. No conversion logic anywhere. Default `EUR` |
| `created_at` | |
| `last_activity_at` | Updated on any write to the trip or its expenses. Drives retention |

### Participant
| Field | Notes |
|---|---|
| `id` | Internal |
| `trip_id` | |
| `name` | Unique per trip, case-insensitive, trimmed |
| `created_at` | Defines the canonical participant ordering used by the rounding rule |

### Expense
| Field | Notes |
|---|---|
| `id` | Internal |
| `trip_id` | |
| `description` | Required |
| `amount_cents` | Integer, > 0 |
| `paid_by` | One participant. **Not** constrained to be in the split |
| `date` | Defaults to today; any past date accepted; future dates accepted |
| `category` | Optional, from the fixed list in §7 |
| `split_type` | `equal` \| `exact` \| `percent` |
| `created_by` | Participant who entered it. Displayed in the list |
| `created_at` | |

### ExpenseSplit
| Field | Notes |
|---|---|
| `expense_id` | |
| `participant_id` | |
| `amount_cents` | Integer, resolved at save time. May be 0 |

**The split table always stores resolved cents.** `split_type` records how the
rows were produced; nothing downstream reads it. Balance and settlement logic
sums `amount_cents` and never learns that split modes exist.

---

## 5. Money and rounding

**All monetary values are integer cents.** No floating-point arithmetic touches
money at any point, in either backend or frontend.

### The distribution function

All modes that require dividing a total route through one function:

```
distribute(total_cents: int, weights: list[int]) -> list[int]
```

Algorithm: largest remainder.

1. `base_i = (total_cents * w_i) // sum(weights)`
2. Distribute the `total_cents - sum(base)` leftover cents one each, in
   descending order of fractional remainder
3. Ties broken by **ascending participant `created_at`** — the earliest
   participant in the trip receives a leftover cent before a later one

Guarantee, asserted in tests: `sum(distribute(t, w)) == t` for all inputs.

Per mode:
- **Equal** — `weights = [1] * n`
- **Percent** — weights are **integer basis points** (3333 = 33.33%). Never
  store percentages as floats
- **Exact** — no distribution. The entered amounts are the split rows

### Required unit tests

| Input | Expected |
|---|---|
| 1000 cents, 3 people, equal | 334, 333, 333 |
| 1 cent, 3 people, equal | 1, 0, 0 |
| 10000 cents, weights 3333/3333/3334 | 3333, 3333, 3334 |
| 10000 cents, weights 3333/3333/3333 | sums to 10000, deterministic |
| Any total, any weights | sum of result equals total |

---

## 6. Balances and settlement

- **Net balance** per participant = (sum of `amount_cents` on expenses they paid)
  − (sum of their split rows).
- **Transfer list** — a minimised set of transfers computed greedily: repeatedly
  match the largest creditor against the largest debtor. Rendered as
  "Max pays Anna $45.00".
- Transfers are a **computed view**. Nothing is stored, nothing can be marked
  paid, and the app has no concept of outstanding balance after people start
  transferring money. State this in the UI and the README so it does not read
  as an unfinished feature.
- Also shown: trip total, and total paid per participant.

---

## 7. Functional requirements

### Trip
1. Create a trip: name, currency label, creator's name → returns the share link
2. Open a trip by token
3. Copy share link
4. No trip deletion (see §9)

### Participants
5. Join by entering a name; rejected if taken
6. Bind to an existing participant from a new device
7. Rename a participant, subject to the same uniqueness check. Reachable in two
   taps from the trip screen — under this join model, renaming is routine
8. Delete a participant **only** if they have zero expenses as payer and zero
   split rows. Otherwise the control is disabled with an explanation. This is
   the mechanism for removing people who joined out of curiosity and never
   participated
9. "Not you? Switch" identity control

### Expenses
10. Add an expense: description, amount, payer, date, optional category, split
    mode, included participants
11. Default included participants = **everyone currently in the trip**. Someone
    who joins later is not retroactively added to earlier expenses. The form
    shows the included list explicitly rather than implying "everyone"
12. Split mode `equal`: select participants, amounts derived
13. Split mode `exact`: per-participant amount inputs, with a live
    "$12.40 left to assign" indicator. Without that indicator the mode is
    unusable
14. Split mode `percent`: per-participant percentage inputs, same live indicator
    against 100%
15. Edit any expense, including switching split mode. Splits are recomputed and
    replaced on save
16. Delete any expense
17. Expense list, newest first, showing description, amount, payer, category and
    "added by <name>"

### Balances
18. Net balance per participant, phrased in second person for the identified
    participant
19. Minimised transfer list
20. Trip total and per-participant total paid

### Categories
21. Optional, from a fixed hardcoded list: Food, Drinks, Transport,
    Accommodation, Activities, Shopping, Other
22. Displayed as a label or icon in the expense list. **No** category breakdown
    screen, **no** per-category totals in v1

---

## 8. Validation

| Rule | Behaviour on failure |
|---|---|
| Amount > 0 | Reject |
| At least one participant in the split | Reject |
| `exact`: entered amounts sum exactly to `amount_cents` | Reject, show the difference |
| `percent`: basis points sum exactly to 10000 | Reject, show the difference |
| Participant name non-empty after trimming | Reject |
| Participant name unique per trip (case-insensitive) | Reject, name is taken |
| Trip name non-empty | Reject |
| Participant deletion only when unused | Control disabled, with reason |

Validation is enforced **server-side**. Client-side checks are for feedback only.

---

## 9. Lifecycle and retention

- Trips are deleted automatically **12 months after `last_activity_at`**.
- A scheduled job performs the deletion; cascade removes participants, expenses
  and splits.
- The retention period is stated on the create screen, since there is no account
  through which anyone could request deletion.
- There is no manual trip deletion: with a shared link and no owner, one
  careless tap would destroy shared data irreversibly.

---

## 10. Presentation

- **Mobile-first.** The primary situation is someone standing at a restaurant
  table on a phone. Desktop is a secondary, responsive case
- **English UI**, `en-US` number and date formatting: `$1,234.56`, `09/20/2026`
  - Note: the currency label is display-only, so a EUR trip renders as
    `1,234.56 €` or `EUR 1,234.56` depending on the label — decide one and be
    consistent
- Deployed at a public URL. An undeployed build does not satisfy this spec

---

## 11. Open decisions

Not yet settled; resolve before or during implementation:

1. Backend framework and database
2. Frontend framework
3. Hosting and deployment target
4. Exact currency-label rendering (see §10)
5. Whether the join screen appears before or after a read-only preview of the
   trip

---

## 12. Definition of done

On a phone, from a public URL:

1. Create a trip and copy its link
2. Open that link on a second device and join under a different name
3. Add ten expenses across all three split modes, including one where the payer
   is not in the split
4. See correct net balances and a transfer list
5. Rename a participant and delete an unused one
6. The rounding test suite passes

If all six hold, v1 is finished.
