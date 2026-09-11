# PDFly

Self-hosted, multi-tenant HTML-to-PDF service. See [docs/PLAN.md](docs/PLAN.md) for
the full design; this README covers getting it running.

**Status: Phase 1 (render core) complete.** HTML in, PDF out, stored and recorded.
No auth beyond a static dev key, no watermarking or encryption yet.

## Layout

```
apps/api      NestJS — config, logging, health, Prisma, POST /v1/pdf.
apps/renderer Isolated Playwright/Chromium pool. HTML in, raw PDF out. No DB access.
apps/web      Next.js dashboard — shadcn/ui, theme switching.
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

## Checks

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm format:check
```

CI runs exactly these against real Postgres and Redis service containers.

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
