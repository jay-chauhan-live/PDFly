# Deploying PDFly

PDFly deploys to a single host — **primary-server** — from a GitHub Actions
self-hosted runner that lives on that same host. Images are built on the box
that runs them; there is no registry.

```
push to main → CI (hosted runner) → Deploy (self-hosted, on primary-server)
                                      ├─ rsync the tree to /srv/pdfly
                                      ├─ docker compose build
                                      ├─ prisma migrate deploy
                                      ├─ docker compose up -d
                                      ├─ seed the admin (idempotent)
                                      ├─ health check
                                      └─ Slack: started / succeeded / failed
```

Deploy only runs when CI has passed on `main`. A red build never reaches
production.

---

## 1. What runs where

| Service                    | Image                                  | Network             | Exposed  |
| -------------------------- | -------------------------------------- | ------------------- | -------- |
| `web`                      | `apps/web/Dockerfile`                  | `frontend`          | 3000     |
| `api`                      | `apps/api/Dockerfile`                  | `backend`, `render` | 3001     |
| `renderer`                 | `apps/renderer/Dockerfile`             | `render` only       | no       |
| `egress-proxy`             | `ubuntu/squid`                         | `render`, `egress`  | no       |
| `postgres` `redis` `minio` | official                               | `backend`           | dev only |
| `api-migrate`              | `apps/api/Dockerfile` target `migrate` | `backend`           | one-shot |

**The network split is the important part.** `render` is an `internal: true`
network — no gateway, no route to the internet or the host. The renderer sits
there with exactly two peers: the api, which calls in, and the egress proxy,
which is its only way out and refuses private destinations at connect time.
Even a full compromise of the browser process reaches no data.

`api-migrate` exists because the Prisma CLI is a devDependency the runtime
image prunes away — and because a tool that can alter the schema has no
business inside the process serving traffic.

---

## 2. Server prerequisites

On primary-server:

```bash
# Docker Engine plus the compose plugin (not docker-compose v1)
curl -fsSL https://get.docker.com | sh
docker compose version

# rsync and git, which the deploy uses
sudo apt-get install -y rsync git curl
```

Create the deploy directory and its secrets. **Secrets live on the server, not
in GitHub** — the pipeline reads `/srv/pdfly/.env` and never prints it.

```bash
sudo install -d -o github-runner -g github-runner /srv/pdfly

# Generate the two keys. Do not reuse these between environments.
node -e "console.log('JWT_ACCESS_SECRET=' + require('crypto').randomBytes(32).toString('base64url'))"
node -e "console.log('ENCRYPTION_KEY=' + require('crypto').randomBytes(32).toString('base64'))"
node -e "console.log('WEBHOOK_SIGNING_SECRET=' + require('crypto').randomBytes(32).toString('base64url'))"

sudo -u github-runner tee /srv/pdfly/.env >/dev/null <<'EOF'
NODE_ENV=production

POSTGRES_USER=pdfly
POSTGRES_PASSWORD=<a real password>
POSTGRES_DB=pdfly
DATABASE_URL=postgresql://pdfly:<a real password>@postgres:5432/pdfly?schema=public

REDIS_URL=redis://redis:6379

S3_ENDPOINT=http://minio:9000
S3_BUCKET=pdfly
S3_ACCESS_KEY_ID=<key>
S3_SECRET_ACCESS_KEY=<secret>
S3_FORCE_PATH_STYLE=true

API_URL=https://pdfly.example.com
WEB_URL=https://pdfly.example.com
NEXT_PUBLIC_API_URL=https://api.pdfly.example.com

JWT_ACCESS_SECRET=<generated above>
ENCRYPTION_KEY=<generated above>
WEBHOOK_SIGNING_SECRET=<generated above>

# Never true in production: it would let a webhook URL reach the metadata
# endpoint and the internal network.
WEBHOOK_ALLOW_PRIVATE=false

QUEUE_CONCURRENCY=2
POOL_SIZE=2
RETENTION_DAYS=7
EOF

sudo chmod 600 /srv/pdfly/.env
```

The pipeline refuses to deploy if this file is missing any of
`DATABASE_URL`, `REDIS_URL`, `S3_*`, `JWT_ACCESS_SECRET`, `ENCRYPTION_KEY` or
`WEBHOOK_SIGNING_SECRET`, and it checks without printing them.

> **`ENCRYPTION_KEY` is not rotatable in place.** It decrypts stored SMTP
> passwords. Change it and every stored SMTP config becomes unreadable and has
> to be re-entered. Back it up somewhere other than this server.

---

## 3. The self-hosted runner

Get a registration token from **Settings → Actions → Runners → New self-hosted
runner**. It expires in about an hour.

```bash
git clone git@github.com:jay-chauhan-live/PDFly.git /tmp/pdfly
cd /tmp/pdfly

REPO=jay-chauhan-live/PDFly \
RUNNER_TOKEN=<token from GitHub> \
sudo -E ./scripts/setup-runner.sh
```

The script creates a `github-runner` system user, installs the runner under
`/opt/github-runner`, registers it with the labels
`self-hosted,linux,x64,primary-server`, and installs a systemd service.

```bash
sudo systemctl status 'actions.runner.*'      # is it up
sudo journalctl -u 'actions.runner.*' -f      # what is it doing
cd /opt/github-runner && sudo ./svc.sh stop   # stop accepting jobs
```

> **The runner user is in the `docker` group, which is root-equivalent on this
> host.** That is inherent to letting CI deploy containers here. It is also why
> the runner has its own account rather than reusing a person's, and why this
> repository should not accept workflow changes from untrusted forks.

---

## 4. GitHub configuration

**Secrets** (Settings → Secrets and variables → Actions → Secrets):

| Secret                | Needed   | What it is                                                                                    |
| --------------------- | -------- | --------------------------------------------------------------------------------------------- |
| `SLACK_WEBHOOK_URL`   | optional | Incoming webhook. Without it, deploys work and say so in the log.                             |
| `SEED_ADMIN_PASSWORD` | optional | First administrator's password. Omitted, one is generated and printed once in the deploy log. |

**Variables** (same page → Variables):

| Variable            | Default             | What it is                                               |
| ------------------- | ------------------- | -------------------------------------------------------- |
| `SEED_ADMIN_EMAIL`  | `admin@pdfly.local` | First administrator's sign-in address                    |
| `SEED_ADMIN_NAME`   | `Administrator`     | Display name                                             |
| `SEED_ADMIN_ORG`    | `PDFly`             | Organization name                                        |
| `DEPLOY_HEALTH_URL` | —                   | Public health URL, linked from the Slack success message |

### The Slack webhook

1. https://api.slack.com/apps → **Create New App** → From scratch
2. **Incoming Webhooks** → enable → **Add New Webhook to Workspace**
3. Pick the channel, copy the `https://hooks.slack.com/services/...` URL
4. Save it as the `SLACK_WEBHOOK_URL` secret

Messages use Block Kit inside an attachment. The attachment is what carries
the coloured stripe down the left — Block Kit alone has no colour:

| State              | Colour          | When                                |
| ------------------ | --------------- | ----------------------------------- |
| Deploy started     | blue `#3b82f6`  | as the job begins                   |
| Deploy succeeded   | green `#22c55e` | health check passed                 |
| Deploy rolled back | amber `#f59e0b` | failed, previous release restored   |
| Deploy failed      | red `#ef4444`   | failed with nothing to roll back to |

Each message carries the environment, branch, commit (linked), who triggered
it, how long it took, and buttons to the run and the commit.

Try it without deploying:

```bash
SLACK_WEBHOOK_URL=<url> \
GITHUB_REPOSITORY=jay-chauhan-live/PDFly \
GITHUB_SHA=$(git rev-parse HEAD) \
GITHUB_REF_NAME=main GITHUB_ACTOR=$USER GITHUB_RUN_ID=1 \
node scripts/slack-notify.mjs succeeded
```

---

## 5. The first deploy

1. Server prerequisites and `/srv/pdfly/.env` (§2)
2. Runner registered and running (§3)
3. Secrets and variables set (§4)
4. Push to `main`, or **Actions → Deploy → Run workflow**

The first run has no `RELEASE_SHA`, so there is nothing to roll back to — a
failure leaves the stack partly up and says so in Slack rather than pretending
it recovered.

The admin seeder runs on every deploy and is idempotent. On the first one it
creates the organization and owner; after that it finds the user and leaves it
completely alone, password included. **A redeploy never resets credentials.**

If `SEED_ADMIN_PASSWORD` is unset, the generated password appears once in the
deploy log. Sign in and change it.

---

## 6. Rollback

Automatic on failure, when there is a previous release:

- the tree is checked out at the previous `RELEASE_SHA`, rebuilt and restarted
- Slack gets the amber **rolled back** message

**The database is deliberately not rolled back.** A migration that has applied
may already have data written against it, and reversing it automatically is how
that data is lost. Migrations are expected to be backwards compatible with one
release; a rollback that genuinely needs a schema change is a human decision.

By hand:

```bash
cd /srv/pdfly
cat RELEASE_SHA                  # what is deployed now
git -C /path/to/checkout checkout <older-sha>
# rsync it over, then:
set -a; . ./.env; set +a
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

---

## 7. Day two

```bash
cd /srv/pdfly
set -a; . ./.env; set +a
export C="-f docker-compose.yml -f docker-compose.prod.yml"

docker compose $C ps                         # what is running
docker compose $C logs -f api                # follow the api
docker compose $C logs --tail 200 renderer   # recent renderer output
curl -s localhost:3001/health | jq           # dependencies

docker compose $C restart api                # restart one service
docker compose $C --profile tools run --rm api-migrate   # migrate by hand
docker compose $C run --rm --no-deps api node apps/api/dist/cli/seed-admin.js
```

**Backups.** Nothing here backs up Postgres. Set that up before you have
customers:

```bash
docker compose $C exec -T postgres \
  pg_dump -U pdfly pdfly | gzip > "pdfly-$(date +%F).sql.gz"
```

**Retention** runs nightly at 03:00 UTC inside the api, deleting documents past
their expiry and the objects behind them. One instance takes a Redis lock, so
it does not matter how many api containers are running.
`RETENTION_SWEEP_ENABLED=false` turns it off.

---

## 8. What is deliberately not here

- **TLS.** Put a reverse proxy (Caddy, nginx, Cloudflare) in front. The api
  and web containers speak plain HTTP on the host.
- **Multiple hosts.** Images are built on the box that runs them. More than
  one server means a registry — the pipeline would push to GHCR and pull here.
- **Zero-downtime deploys.** `up -d` recreates changed containers; there is a
  few seconds of downtime. Blue/green needs a load balancer.
- **Log shipping and metrics.** Logs are structured JSON on stdout, ready for
  a collector, but nothing collects them yet.
