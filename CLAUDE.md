# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

Plain Node.js/Express 5 HTTP API (ESM, `"type": "module"`, no TypeScript) backing a personal-finance/expense-tracking app. It is the shared backend for **two frontend clients**: the React web app (`web-plataformas-de-desarrollo`) and the Flutter app (`app_expense_manager`) — route/response shape changes here are cross-cutting and affect both.

No ORM: database access goes through a hand-rolled `executeQuery` wrapper (`db.js`) around the `postgres` (postgres.js) client, using raw SQL with `$1,$2...` placeholders. The `pg` package is a dependency but unused.

## Feature parity rule

Any change to the API's behavior (new endpoint, changed response shape, new field, new validation, new error code) affects **both** frontend clients and must be reflected in both: the React web app (`c:\Users\gonza\Desktop\web-plataformas-de-desarrollo`) and the Flutter app (`d:\proyectos_flutter\app_expense_manager`). Those two are meant to mirror each other's features on top of this same API.

**Exception**: this rule is about functional behavior, not UI — the clients' screens differ in size and interaction pattern, so their layouts can legitimately diverge even when the underlying API contract they consume is identical.

When making a contract-changing change here, call out explicitly whether the web and Flutter clients need updating (or already were) to match.

## Documentation update rule

The documentation for the whole system (this API + both clients) lives in the **web repo**, not here:

- `c:\Users\gonza\Desktop\web-plataformas-de-desarrollo\docs\` — functional requirements, non-functional requirements, use cases and their diagrams.
- `c:\Users\gonza\Desktop\web-plataformas-de-desarrollo\.claude\guides\` — development guides; `arquitectura-api.md` is the one for this repo. Read it before changing code here.

**Every change made in this repo must update, in the same change, whatever it leaves stale** in those two folders and in this `CLAUDE.md`. `.claude\guides\documentacion.md` (web repo) has the table of what to update for each kind of change — follow it. Document what the code actually does: a rule this API does not enforce is recorded as a known limitation, not as fulfilled.

At the end of every task, state which documentation files were updated, or say explicitly that none needed updating and why.

## Commands

```
node --watch index.js       # dev server (no "dev" alias beyond this — see package.json "dev" script)
npm run dev                  # same as above
npm test                     # vitest run
npm run test:watch           # vitest watch mode
npm run test:coverage        # vitest run --coverage
npx vitest run tests/gastos.controller.test.js              # run a single test file
npx vitest run tests/gastos.controller.test.js -t "<name>"  # run a single test by name
npx eslint .                  # lint (no npm script wraps this; eslint.config.js is flat config)
node seed.js                  # seed dev DB with fake data (truncates tables first — do not run against prod)
```

There is no `build` or `start` script; entry point is `index.js` (`node index.js` to run directly). Tests are pure unit tests — no live DB needed to run them: controller tests mock the service layer, and `tests/gastos.service.test.js` mocks the repositories to test business rules (ownership, remaining quotas).

## Architecture

Each resource follows the same layered pattern, e.g. for `gastos` (expenses):

```
routes/gastos.routes.js       → wires HTTP verbs to makeGastosController()
factories/gastos.factory.js   → manual DI: builds repository → service → controller
controller/gastos.controller.js → thin HTTP adapter (req/res only, no business logic)
services/gastos.service.js    → business rules; throws customError(ErrorCode.X) on domain errors
repositories/gastos.repository.js → raw SQL via executeQuery from db.js
```

There is no DI container/framework — factories instantiate everything by hand. When adding a resource, replicate this four-file structure rather than deviating from it.

**Routing** (`routes/index.js`, mounted at `/api` in `index.js`): `/api/auth/*` is public; `verifyToken` middleware gates everything else. Resource groups: `/user`, `/entidades-financieras` (accounts/cards), `/dashboard`, `/gastos` (expenses — the core resource), `/categorias`, `/compartidos` (shared expenses between users), `/settlement` ("hacer cuentas" settlement sessions and their snapshots).

**Auth**: JWT via `middleware/verify_token.js` — verifies `Authorization: Bearer <jwt>` with `JWT_SECRET`, sets `req.session` (decoded payload, at least `userId`), 401 if the token is missing, invalid or expired (the signal both clients use to log the user out). 403 is reserved for an authenticated user without permission on the resource (`NO_AUTORIZADO`).

**Ownership**: every public `GastosService` method takes `userId` and starts with `#getOwned(id, userId)`, which checks the expense's entity belongs to that user. New operations on a user-owned resource must do the same.

**Error handling**: `utils/errors.js` defines `CustomError`, an `ErrorCode` catalog (single source of truth: code → HTTP status + default Spanish message), and `customError(code, overrides)`. Services throw these instead of `throw new Error(...)`; a single `errorMiddleware` registered last in `index.js` translates them into JSON responses. Add new domain errors to the `CATALOG` rather than hand-rolling ad hoc errors.

**Config**: `config/env.js` loads `.env` via `dotenv` and exports `JWT_SECRET`/`DATABASE_URL` as named constants — other modules import these constants rather than reading `process.env` directly.

**Migrations**: there is no schema-migration tool (no Prisma/Knex/node-pg-migrate); the Postgres schema is managed outside this repo. `migrate.js` is misleadingly named — it's a one-off script that imports a legacy app's `data.json` export into the current schema, not a schema migrator.

## Conventions

- Domain terms and user-facing/log messages are in Spanish ("gastos"=expenses/purchases, "entidades financieras"=financial accounts, "compartidos"=shared expenses); keep new code consistent with that.
- `.env` and `data.json` are gitignored.
