# The dashboard. It talks to the api over HTTP and holds no secrets of its
# own — the refresh cookie is scoped to the api's origin and never reaches
# this server.
FROM node:24-bookworm-slim AS base

ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH
RUN corepack enable

# ---------------------------------------------------------------------------
# Dependencies and build
# ---------------------------------------------------------------------------
FROM base AS build
WORKDIR /repo

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/

RUN pnpm install --frozen-lockfile --filter @pdfly/web...

COPY apps/web apps/web

# NEXT_PUBLIC_* is inlined at build time, so the api URL is baked into the
# bundle here rather than read at runtime. A deployment pointing at a
# different api needs a rebuild; that is how Next's public env works.
ARG NEXT_PUBLIC_API_URL=http://localhost:3001
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

RUN pnpm --filter @pdfly/web build

# ---------------------------------------------------------------------------
# Runtime
# ---------------------------------------------------------------------------
FROM base AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

COPY --from=build --chown=node:node /repo/node_modules ./node_modules
COPY --from=build --chown=node:node /repo/apps/web/node_modules ./apps/web/node_modules
COPY --from=build --chown=node:node /repo/apps/web/.next ./apps/web/.next
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public
COPY --from=build --chown=node:node /repo/apps/web/package.json ./apps/web/
COPY --from=build --chown=node:node /repo/apps/web/next.config.ts ./apps/web/

USER node
WORKDIR /app/apps/web

EXPOSE 3000

CMD ["../../node_modules/.bin/next", "start"]
