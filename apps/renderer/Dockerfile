# The renderer runs attacker-supplied markup in a real browser. Everything
# here exists to contain that (PLAN §11).
#
# The Playwright base image is used deliberately: it carries the exact
# Chromium build the pinned Playwright version expects, plus the system
# libraries that build needs. Installing Chromium separately is how you end up
# with a version skew that fails at render time rather than at build time.
FROM mcr.microsoft.com/playwright:v1.63.0-noble AS base

ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    NODE_ENV=production
RUN corepack enable

# ---------------------------------------------------------------------------
# Dependencies and build
# ---------------------------------------------------------------------------
FROM base AS build
WORKDIR /repo

# The lockfile and manifests first, so a source-only change does not reinstall
# the world.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/renderer/package.json apps/renderer/
COPY packages/net-guard/package.json packages/net-guard/

RUN pnpm install --frozen-lockfile --filter @pdfly/renderer... --filter @pdfly/net-guard

COPY packages/net-guard packages/net-guard
COPY apps/renderer apps/renderer

RUN pnpm --filter @pdfly/net-guard build && pnpm --filter @pdfly/renderer build

# Drops devDependencies from the tree that gets copied forward. CI=true
# because pnpm will not purge a modules directory without a TTY otherwise.
RUN CI=true pnpm prune --prod

# ---------------------------------------------------------------------------
# Runtime
# ---------------------------------------------------------------------------
FROM base AS runtime
WORKDIR /app

# `pwuser` ships with the Playwright image and is not root. Chromium's own
# sandbox still works — PLAN §11 is explicit that `--no-sandbox` is not the
# answer, so the container is given the privileges the sandbox needs instead
# (see the seccomp profile and cap_add in docker-compose.prod.yml).
COPY --from=build --chown=pwuser:pwuser /repo/node_modules ./node_modules
COPY --from=build --chown=pwuser:pwuser /repo/packages/net-guard ./packages/net-guard
COPY --from=build --chown=pwuser:pwuser /repo/apps/renderer/node_modules ./apps/renderer/node_modules
COPY --from=build --chown=pwuser:pwuser /repo/apps/renderer/dist ./apps/renderer/dist
COPY --from=build --chown=pwuser:pwuser /repo/apps/renderer/package.json ./apps/renderer/

USER pwuser

EXPOSE 3002

# No shell form: the process is PID 1 and must receive SIGTERM directly, or
# the pool never gets its chance to close browsers on shutdown.
CMD ["node", "apps/renderer/dist/main.js"]
