#!/usr/bin/env bash
#
# Registers this machine as a GitHub Actions self-hosted runner for PDFly.
#
# Run it ON primary-server, as a user with sudo. It is idempotent: running it
# again reconfigures the existing runner rather than stacking up duplicates.
#
#   REPO=jay-chauhan-live/PDFly \
#   RUNNER_TOKEN=<from GitHub> \
#   sudo -E ./scripts/setup-runner.sh
#
# Get RUNNER_TOKEN from:
#   Settings → Actions → Runners → New self-hosted runner
# It expires in about an hour, so fetch it immediately before running this.

set -euo pipefail

REPO="${REPO:?set REPO, e.g. jay-chauhan-live/PDFly}"
RUNNER_TOKEN="${RUNNER_TOKEN:?set RUNNER_TOKEN from the GitHub runner page}"
RUNNER_NAME="${RUNNER_NAME:-primary-server}"
RUNNER_LABELS="${RUNNER_LABELS:-self-hosted,linux,x64,primary-server}"
RUNNER_USER="${RUNNER_USER:-github-runner}"
RUNNER_HOME="${RUNNER_HOME:-/opt/github-runner}"
RUNNER_VERSION="${RUNNER_VERSION:-2.331.0}"

log() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }

if [[ $EUID -ne 0 ]]; then
  echo "This needs root (it creates a user and installs a systemd service)." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Prerequisites
# ---------------------------------------------------------------------------
log "Checking prerequisites"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is not installed. Install Docker Engine and the compose plugin first:" >&2
  echo "  https://docs.docker.com/engine/install/" >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "The docker compose plugin is missing (docker-compose v1 is not enough)." >&2
  exit 1
fi

apt-get update -qq
apt-get install -y -qq --no-install-recommends curl tar jq ca-certificates git

echo "docker:  $(docker --version)"
echo "compose: $(docker compose version --short)"

# ---------------------------------------------------------------------------
# Runner user
# ---------------------------------------------------------------------------
log "Preparing the runner user"

# A dedicated non-login user. The runner executes whatever is in the workflow,
# so it should not be root and should not be a user anyone signs in as.
if ! id -u "$RUNNER_USER" >/dev/null 2>&1; then
  useradd --system --create-home --home-dir "$RUNNER_HOME" --shell /usr/sbin/nologin "$RUNNER_USER"
  echo "created $RUNNER_USER"
else
  echo "$RUNNER_USER already exists"
fi

# The deploy drives docker, so the runner needs the docker group. Worth being
# clear-eyed about: docker group membership is root-equivalent on this host.
# That is inherent to letting CI deploy containers here, and the reason the
# runner user exists at all rather than reusing a person's account.
usermod -aG docker "$RUNNER_USER"

install -d -o "$RUNNER_USER" -g "$RUNNER_USER" "$RUNNER_HOME"

# ---------------------------------------------------------------------------
# Runner software
# ---------------------------------------------------------------------------
log "Installing the runner (v${RUNNER_VERSION})"

ARCH="$(uname -m)"
case "$ARCH" in
  x86_64)  RUNNER_ARCH="x64" ;;
  aarch64) RUNNER_ARCH="arm64" ;;
  *) echo "Unsupported architecture: $ARCH" >&2; exit 1 ;;
esac

TARBALL="actions-runner-linux-${RUNNER_ARCH}-${RUNNER_VERSION}.tar.gz"

if [[ ! -x "$RUNNER_HOME/config.sh" ]]; then
  curl -fsSL -o "/tmp/$TARBALL" \
    "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/${TARBALL}"
  tar xzf "/tmp/$TARBALL" -C "$RUNNER_HOME"
  rm -f "/tmp/$TARBALL"
  chown -R "$RUNNER_USER:$RUNNER_USER" "$RUNNER_HOME"
  echo "unpacked into $RUNNER_HOME"
else
  echo "runner already unpacked"
fi

# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------
log "Registering with $REPO"

# Remove an existing registration first so re-running does not create a second
# runner competing for the same jobs.
if [[ -f "$RUNNER_HOME/.runner" ]]; then
  echo "removing the previous registration"
  systemctl stop "actions.runner.$(echo "$REPO" | tr '/' '-').${RUNNER_NAME}.service" 2>/dev/null || true
  sudo -u "$RUNNER_USER" "$RUNNER_HOME/config.sh" remove --token "$RUNNER_TOKEN" || true
fi

sudo -u "$RUNNER_USER" "$RUNNER_HOME/config.sh" \
  --url "https://github.com/${REPO}" \
  --token "$RUNNER_TOKEN" \
  --name "$RUNNER_NAME" \
  --labels "$RUNNER_LABELS" \
  --work "_work" \
  --unattended \
  --replace

# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------
log "Installing the systemd service"

cd "$RUNNER_HOME"
./svc.sh install "$RUNNER_USER"
./svc.sh start

sleep 2
./svc.sh status || true

log "Done"
cat <<EOF

The runner is registered as "${RUNNER_NAME}" with labels: ${RUNNER_LABELS}

Next:
  1. Add the repository secrets and variables listed in docs/DEPLOYMENT.md
  2. Create the deploy directory and its .env:

       sudo install -d -o ${RUNNER_USER} -g ${RUNNER_USER} /srv/pdfly
       sudo -u ${RUNNER_USER} cp /path/to/.env /srv/pdfly/.env
       sudo chmod 600 /srv/pdfly/.env

  3. Push to main, or run the "Deploy" workflow by hand.

Useful:
  sudo systemctl status 'actions.runner.*'      # is it up
  sudo journalctl -u 'actions.runner.*' -f      # what is it doing
  cd ${RUNNER_HOME} && sudo ./svc.sh stop       # stop accepting jobs
EOF
