# PDFly

Self-hosted, multi-tenant HTML-to-PDF service. See [docs/PLAN.md](docs/PLAN.md) for
the full design; this README covers getting it running.

**Status: Phase 2 (auth and dashboard shell) complete.** HTML in, PDF out, stored
and recorded, behind real accounts: registration, login, rotating refresh tokens,
a protected dashboard shell and a profile page. No watermarking or encryption yet,
and no email — verification and password reset wait for SMTP in Phase 6.

## Layout

```
apps/api      NestJS — config, logging, health, Prisma, auth, POST /v1/pdf.
apps/renderer Isolated Playwright/Chromium pool. HTML in, raw PDF out. No DB access.
apps/web      Next.js dashboard — shadcn/ui, auth, theme switching.
packages/    Shared code (empty until there is something genuinely shared).
docs/PLAN.md The build plan.
```

`worker` and the BullMQ queue (PLAN §2) arrive with async rendering in Phase 6.

## Prerequisites

- Node 24 (see `.nvmrc`)
- pnpm 11
- Docker, for Postgres, Redis and MinIO

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

# Machine credential. Still the single static development key until Phase 4
# mints real per-organization tokens; it resolves to the seeded `development`
# org, so run `pnpm db:seed` first.
curl -s localhost:3001/v1/pdf \
  -H "x-api-key: $DEV_API_KEY" \
  -H 'content-type: application/json' \
  -d '{"html":"<h1>Hello</h1>"}' | jq
```

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
