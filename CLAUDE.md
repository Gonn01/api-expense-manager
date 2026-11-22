# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

Plain Node.js/Express 5 HTTP API (ESM, `"type": "module"`, no TypeScript) backing a personal-finance/expense-tracking app. It is the shared backend for **two frontend clients**: the React web app (`web-plataformas-de-desarrollo`) and the Flutter app (`app_expense_manager`) — route/response shape changes here are cross-cutting and affect both.

No ORM: database access goes through a hand-rolled `executeQuery` wrapper (`db.js`) around the `postgres` (postgres.js) client, using raw SQL with `$1,$2...` placeholders. The `pg` package is a dependency but unused.

**Transactions**: `db.js` also exposes `withTransaction(fn)`, `afterCommit(fn)` and `bestEffort(fn)`. The current transaction is carried in an `AsyncLocalStorage`, so `executeQuery` joins it automatically. Every service operation with more than one write runs as `return this.tx(async () => { … })`. Services take `runInTransaction` in their constructor; unit tests pass `(fn) => fn()`. Pusher notifications are deferred until COMMIT, and best-effort writes such as the entity history run in a savepoint. Full rules are in `.claude/guides/arquitectura-api.md` (section 5, "Transacciones").

## Feature parity rule

Any change to the API's behavior (new endpoint, changed response shape, new field, new validation, new error code) affects **both** frontend clients and must be reflected in both: the React web app (`web-plataformas-de-desarrollo`) and the Flutter app (`app_expense_manager`). Those two are meant to mirror each other's features on top of this same API.

**Exception**: this rule is about functional behavior, not UI — the clients' screens differ in size and interaction pattern, so their layouts can legitimately diverge even when the underlying API contract they consume is identical.

When making a contract-changing change here, call out explicitly whether the web and Flutter clients need updating (or already were) to match.

## Documentation update rule

- `.claude/guides/arquitectura-api.md` (this repo) — this API's architecture guide. Read it before changing code here.
- `docs/` in the web repo — the functional documentation for the whole system (this API + both clients) lives in the **web repo**, not here: functional requirements, non-functional requirements, use cases and their diagrams.
- The clients' architecture guides are in their own repos: `.claude/guides/arquitectura-web.md` in the web repo and `.claude/guides/arquitectura-flutter.md` in the Flutter repo.

**Every change made in this repo must update, in the same change, whatever it leaves stale** in this repo's architecture guide, in the web repo's `docs/` and in this `CLAUDE.md`. `.claude/guides/documentacion.md` in the web repo has the table of what to update for each kind of change — follow it. Document what the code actually does: a rule this API does not enforce is recorded as a known limitation, not as fulfilled.

**Every time an endpoint is added, removed or changed** (method, path, query params, body, auth or response data its scripts read), update the Postman collection in the same change: `postman/plataforma-gestion-deudas.postman_collection.json` in the web repo. It must keep covering every route of this API.

**No absolute paths in documentation**: each team member clones the repos in a different location, so never write machine-specific paths. Use paths relative to the repo root, and refer to another project by its repo name (e.g. `docs/` in the web repo).

At the end of every task, state which documentation files were updated, or say explicitly that none needed updating and why.

## No code comments rule

**Do not write comments in code** — in any of the three projects (this API, the web app, the Flutter app). No `//`, `/* */` or JSDoc `/** */`, not even section markers. Code must explain itself through names and structure; the "why" of a business rule belongs in the web repo's `docs/` or the architecture guide, not in the source. When editing a file that still has a comment, remove it.

Only tool directives are allowed (`eslint-disable*`).

## Commands

```
node --watch index.js       # dev server (no "dev" alias beyond this — see package.json "dev" script)
npm run dev                  # same as above
npm test                     # vitest run
npm run test:watch           # vitest watch mode
npm run test:coverage        # vitest run --coverage
npm run test:integration     # HTTP tests against a temporary local Postgres (needs PostgreSQL binaries; PG_BIN overrides their folder)
npx vitest run tests/gastos.controller.test.js              # run a single test file
npx vitest run tests/gastos.controller.test.js -t "<name>"  # run a single test by name
npx eslint .                  # lint (no npm script wraps this; eslint.config.js is flat config)
```

There is no `build` or `start` script; entry point is `index.js` (`node index.js` to run directly). `npm test` runs pure unit tests — no live DB needed: controller tests mock the service layer, `tests/gastos.service.test.js` mocks the repositories to test business rules (ownership, remaining quotas), and `tests/routes.authorization.test.js` mounts the real routes over a mocked DB to check that every protected route rejects invalid tokens (add new routes to its `PROTECTED_ROUTES`). `tests/integration/` creates a throwaway Postgres from `migrations/schema.sql` plus the migrations in `PENDING_MIGRATIONS` (`support/global-setup.js`), refuses non-local connections and fakes Pusher. After running a migration in production, regenerate `schema.sql` and remove it from that list. `it.fails` tests named `BUG CONOCIDO` document open bugs: when one is fixed, the test fails until it becomes a plain `it`.

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

**Routing** (`routes/index.js`, mounted at `/api` in `index.js`): `/api/auth/*` and `/api/health` (DB ping: 200 or 503) are public; `verifyToken` middleware gates everything else. Resource groups: `/user`, `/entidades-financieras` (accounts/cards), `/dashboard`, `/gastos` (expenses — the core resource), `/categorias`, `/notificaciones` (persisted notification feed, with shared-expense actions under `/notificaciones/pendientes`), `/settlement` ("hacer cuentas" settlement sessions and their snapshots).

**Auth**: JWT via `middleware/verify_token.js` — verifies `Authorization: Bearer <jwt>` with `JWT_SECRET`, sets `req.session` (decoded payload, at least `userId`), 401 if the token is missing, invalid or expired (the signal both clients use to log the user out). 403 is reserved for an authenticated user without permission on the resource (`NO_AUTORIZADO`).

**Ownership**: every public `GastosService` method takes `userId` and starts with `#getOwned(id, userId)`, which checks the expense's entity belongs to that user. New operations on a user-owned resource must do the same.

**User columns**: any query that returns `users` rows selects/returns `USER_PUBLIC_COLUMNS` (`repositories/user-columns.js`), never `SELECT *`. The password hash never leaves the API: only `AuthRepository.findUserWithPasswordByEmail` reads it, and `AuthService.login` strips it before responding.

**Error handling**: `utils/errors.js` defines `CustomError`, an `ErrorCode` catalog (single source of truth: code → HTTP status + default Spanish message), and `customError(code, overrides)`. Services throw these instead of `throw new Error(...)`; a single `errorMiddleware` registered last in `index.js` translates them into JSON responses. Add new domain errors to the `CATALOG` rather than hand-rolling ad hoc errors.

**Config**: `config/env.js` loads `.env` via `dotenv` and exports `JWT_SECRET`/`DATABASE_URL`/`BEAMS_INSTANCE_ID`/`BEAMS_SECRET_KEY` as named constants — other modules import these constants rather than reading `process.env` directly.

**Notifications**: `triggerCompartidos` (`utils/pusher.js`) also stores every `PusherEvent` for its recipient in `notifications` after COMMIT, except the actor's own action (`utils/notifications.js`).

**Push**: `triggerCompartidos` (`utils/pusher.js`) also sends an Android push through Pusher Beams (`utils/push-notifications.js`) after COMMIT. A new Pusher event needs its text in `utils/push-messages.js`.

**Migrations**: there is no schema-migration tool (no Prisma/Knex/node-pg-migrate); the Postgres schema is managed outside this repo. Schema changes are written as `migrations/manual/<date>_<reason>.sql` and run by hand against the database before deploying the code that needs them.

## Conventions

- Domain terms and user-facing/log messages are in Spanish ("gastos"=expenses/purchases, "entidades financieras"=financial accounts, "compartidos"=shared expenses); keep new code consistent with that.
- `.env` and `data.json` are gitignored.
