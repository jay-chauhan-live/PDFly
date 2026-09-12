# The api holds the database credentials and the encryption key. It renders
# nothing itself — that is the renderer's job, in its own container.
FROM node:24-bookworm-slim AS base

ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH
RUN corepack enable

# qpdf applies PDF encryption (PLAN §3). It is an external binary rather than
# an npm dependency, so the image has to install it the way CI does.
RUN apt-get update \
 && apt-get install -y --no-install-recommends qpdf openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# ---------------------------------------------------------------------------
# Dependencies and build
# ---------------------------------------------------------------------------
FROM base AS build
WORKDIR /repo

# Every workspace manifest, so pnpm reconstructs the full dependency graph and
# links the workspace's own packages (net-guard) into their consumers exactly
# as it does in development. A partial set silently skips those links.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/renderer/package.json apps/renderer/
COPY packages/net-guard/package.json packages/net-guard/

# Source before install: a COPY over the workspace tree after install would
# clobber the symlinks pnpm creates for workspace packages (net-guard).
COPY packages/net-guard packages/net-guard
COPY apps/api apps/api

RUN pnpm install --frozen-lockfile --filter @pdfly/api...

# The Prisma client is generated, not vendored, and the build needs its types.
#
# `prisma generate` never connects, but prisma.config.ts resolves
# `env('DATABASE_URL')` eagerly and fails without it. A placeholder satisfies
# that; the real URL arrives from the environment at runtime, and is never
# baked into the image.
RUN DATABASE_URL="postgresql://build:build@localhost:5432/build?schema=public" \
    pnpm --filter @pdfly/api exec prisma generate \
 && pnpm --filter @pdfly/net-guard build \
 && pnpm --filter @pdfly/api build

# A self-contained deploy of just the api: real, flat node_modules with the
# workspace's net-guard folded in. pnpm's default node_modules is a symlink
# farm into a shared store that does not survive a copy into another image;
# `pnpm deploy` resolves that into one portable directory. --legacy because
# the workspace does not use injected dependencies.
RUN pnpm --filter=@pdfly/api --legacy deploy --prod /prod/api

# ---------------------------------------------------------------------------
# Migrations
# ---------------------------------------------------------------------------
# Its own stage because the Prisma CLI is a devDependency the deployed runtime
# does not carry. Shipping the CLI into the running service would mean a
# schema-altering tool in the process exposed to the internet; this keeps it in
# an image that only exists during a deploy.
FROM build AS migrate
WORKDIR /repo/apps/api
CMD ["pnpm", "exec", "prisma", "migrate", "deploy"]

# ---------------------------------------------------------------------------
# Runtime
# ---------------------------------------------------------------------------
FROM base AS runtime
WORKDIR /app

ENV NODE_ENV=production

# The whole app, self-contained: dist, prisma/, package.json and node_modules.
COPY --from=build --chown=node:node /prod/api ./

USER node

EXPOSE 3001

CMD ["node", "dist/main.js"]
