# Quits

Expense splitter for trips and events. Link-based, no accounts.

**`_docs/SPEC.md` is authoritative.** It defines the complete v1 scope. Read it
before writing code.

## Stack

- Backend: Python, managed with `uv`. **Framework not yet chosen — ask before
  scaffolding the backend.**
- Frontend: React + Vite, npm as package manager
- Database: SQLite, single file
- Tests: pytest on the backend. Frontend test runner not yet chosen — ask.

## Layout

```
_docs/       Specification and project documents
backend/     Python, uv project
frontend/    React + Vite
```

## Commands

Backend (from `backend/`):

- `uv sync` — install dependencies
- `uv run pytest` — the whole suite
- `uv run pytest tests/test_split.py` — one test file

Frontend (from `frontend/`):

- `npm install` — install dependencies
- `npm run dev` — dev server
- `npm run build` — production build

## Rules

### Scope

- Do not implement anything listed in §1 of `_docs/SPEC.md` ("Out of scope for
  v1"), even if it is a two-line change.
- If the spec is silent on a behaviour, **ask**. Do not invent it and do not
  infer it from how other expense apps work.
- If code and spec disagree, the spec is right. Report the mismatch; do not
  silently change the spec to match the code.
- Do not edit `_docs/SPEC.md`. Propose changes in chat instead.

### Decisions

- Do not add a dependency without asking. Backend dependencies go in
  `pyproject.toml`, frontend in `package.json`.
- Do not choose the backend framework, the frontend test runner, or the hosting
  target. Those are open decisions — ask.
- Do not add configuration, tooling, linters, CI or Docker unless asked.
- Do not create files outside the layout above without asking.

### Money

- All monetary values are **integer cents**. No floats touch money anywhere, in
  either backend or frontend.
- Every division of a total goes through the single `distribute()` function
  defined in §5. Do not write a second rounding path.
- Write the §5 rounding tests **before** implementing `distribute()`.
- Percentages are stored as integer basis points, never as floats.

### Behaviour

- There are no accounts, no login, no sessions, no passwords. Do not add them.
- Possession of the trip token is the only credential. Do not add roles or
  permission checks beyond that.
- All validation in §8 is enforced server-side. Client-side checks are feedback
  only, never the sole gate.
- UI language is English, formatting is `en-US`. Do not add an i18n layer.

### Git

- Do not commit or push without being asked.
- Never commit secrets, `.env` files, or the SQLite database file.
