# PDFly

Self-hosted, multi-tenant HTML-to-PDF service. This README covers getting it
running.

The build plan it was written against (`docs/PLAN.md`) is kept locally and is
not published; the `PLAN §n` citations throughout the code refer to its
sections.

**Status: Phase 5 (protection and watermarking) complete.** The feature set the
service exists for: AES-256 password protection with individual permission bits,
text and image watermarks stamped on every page, and both wired into the
playground. No email yet — verification and password reset wait for SMTP in
Phase 6, along with async rendering and webhooks.

## Layout

```
apps/api      NestJS — config, logging, health, Prisma, auth, rendering, documents.
apps/renderer Isolated Playwright/Chromium pool. HTML in, raw PDF out. No DB access.
apps/web      Next.js dashboard — auth, playground, history, tokens, usage.
packages/    Shared code (empty until there is something genuinely shared).
```

`worker` and the BullMQ queue (PLAN §2) arrive with async rendering in Phase 6.

## Prerequisites

- Node 24 (see `.nvmrc`)
- pnpm 11
- Docker, for Postgres, Redis and MinIO
- `qpdf`, for password protection — `brew install qpdf` or `apt install qpdf`.
  Everything else works without it; `/health` reports it as down so a missing
  binary is a startup problem rather than a customer's problem.

## Getting started

```bash
cp .env.example .env          # then set ENCRYPTION_KEY, see below
pnpm install
pnpm infra:up                 # postgres + redis + minio, bucket created automatically
pnpm db:generate              # generate the Prisma client
pnpm db:migrate               # apply migrations
pnpm dev                      # api on :3001, web on :3000
```

Generate a real encryption key before running anything that touches SMTP config:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Verify the api is up:

```bash
curl -s localhost:3001/health | jq
# {"status":"ok","info":{"postgres":{"status":"up"},"redis":{"status":"up"}}, ...}
```

| Service       | URL                                          |
| ------------- | -------------------------------------------- |
| web           | http://localhost:3000                        |
| api           | http://localhost:3001 (routes under `/v1`)   |
| api health    | http://localhost:3001/health                 |
| MinIO console | http://localhost:9001 (`pdfly` / see `.env`) |

## Signing in

Register at <http://localhost:3000/register>. The first user of an organization
owns it; the organization is created in the same transaction, because a user with
no org has nothing to own.

Every route authenticates. Two credentials resolve to the same request context:

```bash
# Dashboard session — access token in the body, refresh token in an httpOnly
# cookie scoped to /v1/auth.
curl -s localhost:3001/v1/auth/login -c jar.txt \
  -H 'content-type: application/json' \
  -d '{"email":"you@example.com","password":"correct horse battery staple"}' | jq

# Machine credential. Mint one at /settings/tokens, or use the one `pnpm db:seed`
# prints — it is shown once and never recoverable, exactly like a real one.
curl -s localhost:3001/v1/pdf \
  -H "Authorization: Bearer $PDFLY_TOKEN" \
  -H 'content-type: application/json' \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"html":"<h1>Hello</h1>"}' | jq
```

Which credential arrived decides how the render is recorded: a dashboard session
has a user behind it, so the document is attributed to them and marked `ui`; an
API token has nobody, so it is marked `api`.

## Endpoints so far

```
POST   /v1/pdf                 render, watermark, encrypt, store, record
POST   /v1/pdf/preview         render and stamp; never encrypts, stores nothing
GET    /v1/documents           list — search, status, source, date, keyset paging
GET    /v1/documents/:id       metadata and the options it was rendered with
GET    /v1/documents/:id/file  short-lived signed download URL
DELETE /v1/documents/:id       removes the row and the stored object
GET    /v1/usage               today, month to date, a daily series, durations
GET    /v1/tokens              POST /v1/tokens   DELETE /v1/tokens/:id
POST   /v1/auth/{register,login,refresh,logout}   GET /v1/auth/me
PATCH  /v1/users/me            POST /v1/users/me/password
```

Every response carries `X-RateLimit-Limit`, `-Remaining` and `-Reset`. Renders
accept an `Idempotency-Key`; a retry with the same key returns the original
document and `Idempotent-Replay: true` rather than rendering again.

Token scopes: `pdf:render`, `documents:read`, `documents:delete`. A route that
needs one answers 403 — not 401 — when a valid credential lacks it.

`/health` is deliberately unauthenticated — a load balancer has no credential to
present.

## Checks

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm format:check
```

CI runs exactly these against real Postgres and Redis service containers. `pnpm test`
needs Redis running locally too (`pnpm infra:up`): refresh-token rotation is an atomic
Lua script, and its behaviour under concurrency is the part worth testing, which a
hand-written fake cannot reproduce.

## Notes for anyone picking this up

- **The api is an ESM package.** NestJS 12 ships `"type": "module"`, so relative
  imports need explicit `.js` extensions and `__dirname` is unavailable. The
  Prisma client is generated as ESM to match.
- **Prisma 7 has no query engine binary.** The connection URL lives in
  `apps/api/prisma.config.ts` for the CLI and in the `@prisma/adapter-pg` driver
  adapter at runtime — deliberately not in `schema.prisma`.
- **Two indexes are raw SQL**, in `20260911054204_search_and_default_constraints`:
  the `to_tsvector(title)` GIN index for document search, and the partial unique
  index enforcing one default SMTP config per organization. The schema language
  cannot express either.
- **The root `.env` is the single source of truth** in development. Both apps read
  it, so their ports and credentials cannot drift apart.
- **Logging redacts credentials by path** (`apps/api/src/common/logger.options.ts`).
  PDF passwords must never reach a log sink (PLAN §3, §11); when the render
  pipeline lands in Phase 1, keep that list current.
- **ESLint is pinned to 9**, not 10: `eslint-config-next`'s parser crashes on
  ESLint 10, and its jsx-a11y rules are worth keeping for PLAN §9.
- **One guard resolves both credentials.** `AuthGuard` is registered globally, so
  every route authenticates unless it opts out with `@Public()`. A dashboard JWT
  and the static development API key both become the same
  `{ orgId, userId?, scopes }` on `request.ctx`, and nothing downstream may care
  which arrived (PLAN §5).
- **Refresh tokens are opaque, not JWTs.** `<familyId>.<secret>` with only the
  secret's sha256 in Redis. Every refresh rotates the secret; presenting a spent
  one revokes the whole family, which signs the user out everywhere. That is the
  right answer to a token that may have leaked, since we cannot tell the holders
  apart.
- **The access token never leaves memory** in the browser — no `localStorage`,
  because anything script can read, injected script can read. A reload recovers
  the session from the `httpOnly` refresh cookie instead.
- **Route protection in the dashboard is UX, not security.** The refresh cookie
  is scoped to the api's `/v1/auth` path, so Next's server never sees it and
  middleware could not read it. Every endpoint enforces auth itself.
- **The order of the pipeline is not negotiable:** render, watermark, encrypt,
  store. An encrypted PDF cannot be stamped, and Chromium cannot produce an
  encrypted one in the first place — which is exactly why steps three and four
  live outside the browser.
- **Watermarks are stamped, not injected.** A CSS overlay before rendering is
  cheaper, but it sits inside the caller's document where their styles can
  override it, and `position: fixed` repeating on every printed page is
  unreliable across Chromium versions. Stamping with pdf-lib afterwards is
  deterministic and covers pages the HTML never anticipated.
- **qpdf's arguments travel over stdin, never argv.** The process table is
  readable by every other process on the host, so a password passed as a
  command-line argument is a password disclosed. `qpdf @-` reads its arguments
  from standard input; a test asserts that nothing but `@-` ever reaches argv.
- **An omitted owner password is generated and thrown away.** Leaving it unset
  makes the permission bits trivially removable, and qpdf refuses the
  combination outright. Nobody, including us, can lift the restrictions after
  the fact — which is the honest reading of "restrict this document".
- **Passwords are never stored** (PLAN §3). `options_json` records
  `hasUserPassword: true` and the permission bits, never the values, and it is
  built by naming what goes in rather than by deleting what must not — so a
  password-shaped field added later is excluded by default.
  `src/pdf/password-hygiene.spec.ts` is the audit: it renders with sentinel
  passwords and checks the document row, the recorded options, the stored
  object, the failure path and the logger's redaction list.
- **Playground previews are deliberately not documents.** The editor re-renders
  on a debounce as you type; persisting each of those would bury the real
  history and fill object storage with drafts. `POST /v1/pdf/preview` renders
  and returns, and skipping the upload is what makes the live pane quick.
- **The submitted HTML is never stored** — only the options it was rendered
  with (PLAN §4). "Open settings in playground" carries those across; it cannot
  bring the markup back.
- **Document search is a trigram index, not full text.** Titles are short and
  the box searches as you type, so "inv" must match "invoice-001" — a substring
  match that `to_tsvector` cannot serve. See the third migration.
- **Listing uses keyset pagination**, not offsets: renders arrive at the top of
  the list constantly, and an offset would skip or repeat rows as they do.
- **Tokens are `pdfly_live_<prefix>_<secret>`.** PLAN §5 still writes
  `ink_live_`, from the project's earlier name. Only `sha256(whole token)` is
  stored; the prefix is an indexed lookup key so verification is one read and a
  constant-time digest comparison. Do not split a token on `_` — base64url's
  alphabet contains it, so about half of all secrets do too.
- **`last_used_at` is throttled to one write per token per minute.** It answers
  "is anything still using this?", which does not need to be exact, and writing
  to Postgres on every authenticated request would cost real money for no real
  information.
- **Rate limits are per credential, not per organization.** One runaway script
  must not starve every other integration the same customer runs. Unauthenticated
  routes fall back to the client address, which is what matters for password
  guessing. Health probes are exempt: infrastructure has no credential and no
  way to back off.
- **Usage never counts the documents table.** Counters live in Redis and flush to
  `usage_daily` every minute; the dashboard reads the rollup plus whatever has
  not flushed yet, so a render from ten seconds ago still appears. Durations are
  the exception — a distribution is not a counter, so p50/p95 come from the day's
  documents via `percentile_cont`.
- **Monaco is bundled, not fetched from a CDN.** `@monaco-editor/react` defaults
  to jsDelivr; pointing it at the npm package keeps the dashboard working
  offline and its version pinned to the lockfile. The worker entry points need
  the one-line shims in `components/playground/` because a bare specifier
  inside `new URL(...)` is not something the bundler can follow.
