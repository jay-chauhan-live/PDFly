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

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY packages/net-guard/package.json packages/net-guard/

RUN pnpm install --frozen-lockfile --filter @pdfly/api... --filter @pdfly/net-guard

COPY packages/net-guard packages/net-guard
COPY apps/api apps/api

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

# ---------------------------------------------------------------------------
# Migrations
# ---------------------------------------------------------------------------
# Its own stage because the Prisma CLI is a devDependency and the runtime
# image below prunes those away. Shipping the CLI into the running service
# would mean carrying a schema-altering tool in the process exposed to the
# internet — this keeps it in an image that only exists during a deploy.
FROM build AS migrate
WORKDIR /repo/apps/api
CMD ["pnpm", "exec", "prisma", "migrate", "deploy"]

# ---------------------------------------------------------------------------
# Runtime
# ---------------------------------------------------------------------------
FROM build AS pruned
# pnpm refuses to purge a modules directory without a TTY unless it is told
# it is running unattended.
RUN CI=true pnpm prune --prod

FROM base AS runtime
WORKDIR /app

ENV NODE_ENV=production

COPY --from=pruned --chown=node:node /repo/node_modules ./node_modules
COPY --from=pruned --chown=node:node /repo/packages/net-guard ./packages/net-guard
COPY --from=pruned --chown=node:node /repo/apps/api/node_modules ./apps/api/node_modules
COPY --from=pruned --chown=node:node /repo/apps/api/dist ./apps/api/dist
COPY --from=pruned --chown=node:node /repo/apps/api/package.json ./apps/api/
# The schema travels with the image: the generated client reads it at runtime,
# and `dist/cli/seed-admin.js` needs the client to work.
COPY --from=pruned --chown=node:node /repo/apps/api/prisma ./apps/api/prisma

USER node

EXPOSE 3001

CMD ["node", "apps/api/dist/main.js"]
