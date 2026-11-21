#!/bin/sh
# Installs MagpieCRM with Docker on this machine:
#
#   curl -fsSL https://raw.githubusercontent.com/magpiecrm/magpie-crm-app/main/install.sh | sh
#
# It makes a folder, ./magpiecrm, holding docker-compose.yml, a .env with new
# secrets and your first login, and data/ for the database and uploads, then
# starts the latest release. Run it again in the same place to upgrade: .env,
# docker-compose.yml and data/ are kept.
#
# Optional settings, e.g. `curl … | MAGPIE_PORT=8080 sh`:
#   MAGPIE_DIR      the folder (default ./magpiecrm)
#   MAGPIE_PORT     the port it answers on (default 3000)
#   MAGPIE_VERSION  a release, e.g. 0.9.145 (default the latest)
#   MAGPIE_EMAIL    your login's email (asked for when not set)
set -eu

REPO=magpiecrm/magpie-crm-app
DIR=${MAGPIE_DIR:-magpiecrm}

say() { printf '%s\n' "$*"; }
fail() { printf '\nmagpiecrm: %s\n' "$*" >&2; exit 1; }
random() { head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'; }
# Rewrites one KEY=value line of .env in place, keeping the file's permissions.
set_setting() { sed "s|^$1=.*|$1=$2|" .env > .env.new && cat .env.new > .env && rm -f .env.new; }

# Docker, through sudo if this user can't reach it directly.
command -v docker >/dev/null 2>&1 || fail "Docker isn't installed: https://docs.docker.com/get-docker/"
DOCKER=docker
if ! docker info >/dev/null 2>&1; then
  if command -v sudo >/dev/null 2>&1 && sudo docker info >/dev/null 2>&1; then
    DOCKER="sudo docker"
  else
    fail "can't reach Docker. Is it running, and is this user allowed to use it?"
  fi
fi
$DOCKER compose version >/dev/null 2>&1 || fail "needs Docker Compose v2 (the 'docker compose' command)"

VERSION=${MAGPIE_VERSION:-}
if [ -z "$VERSION" ]; then
  VERSION=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" |
    sed -n 's/.*"tag_name": *"v\{0,1\}\([^"]*\)".*/\1/p' | head -n 1) || true
  [ -n "$VERSION" ] || fail "couldn't look up the latest release. Set MAGPIE_VERSION to one from https://github.com/$REPO/releases"
fi
VERSION=${VERSION#v}

# A first install needs an email for its login; an upgrade already has one.
EMAIL=
if [ ! -f "$DIR/.env" ]; then
  EMAIL=${MAGPIE_EMAIL:-}
  # Piped into sh, stdin is this script: ask on the terminal instead.
  if [ -z "$EMAIL" ] && (exec </dev/tty) 2>/dev/null; then
    printf 'Your email, to sign in with: ' >/dev/tty
    read -r EMAIL </dev/tty || true
  fi
  case $EMAIL in
    *@*.*) ;;
    *) fail "needs an email to sign in with. Run it again in a terminal, or with MAGPIE_EMAIL=you@example.com" ;;
  esac
fi

mkdir -p "$DIR/data"
cd "$DIR"

if [ -f .env ]; then
  say "Upgrading the MagpieCRM in $(pwd) to $VERSION. Its settings and data stay as they are."
  set_setting MAGPIE_VERSION "$VERSION"
  if [ -n "${MAGPIE_PORT:-}" ]; then set_setting MAGPIE_PORT "$MAGPIE_PORT"; fi
  PASSWORD=
else
  PASSWORD=$(random | cut -c1-20)
  umask 077
  cat > .env <<EOF
# MagpieCRM's settings. Every option:
# https://github.com/$REPO#configuration
# Keep this file private, and never change the secrets below once it's running:
# logins you save in the app (sending providers, inboxes) are encrypted with them.

MAGPIE_VERSION=$VERSION
MAGPIE_PORT=${MAGPIE_PORT:-3000}

# Your first login. Change the password, and add people, in Settings -> Team and login.
AUTH_EMAIL=$EMAIL
AUTH_PASSWORD=$PASSWORD

TRACKING_SECRET=$(random)
SUPPRESSION_SECRET=$(random)
WEBHOOK_SECRET=$(random)

# This copy's address on the internet, for the links in the emails it sends
# (unsubscribe, tracking). Set it before you send: https, on your own domain.
# PUBLIC_URL=https://crm.example.com
EOF
  umask 022
fi

if [ ! -f docker-compose.yml ]; then
  cat > docker-compose.yml <<'EOF'
# MagpieCRM: https://github.com/magpiecrm/magpie-crm-app
# Settings are in .env; the database and uploads in ./data (back this folder up).
# To upgrade, run the installer again here, or set MAGPIE_VERSION in .env and
# `docker compose up -d`.
services:
  magpiecrm:
    image: ghcr.io/magpiecrm/magpie-crm-app:${MAGPIE_VERSION}
    platform: linux/amd64
    restart: unless-stopped
    ports:
      - "${MAGPIE_PORT:-3000}:3000"
    env_file: .env
    environment:
      NODE_ENV: production
      HOME: /data
      DATABASE_PATH: /data/local_db.json
    volumes:
      - ./data:/data
EOF
fi

say "Downloading MagpieCRM $VERSION (about 1 GB the first time)..."
$DOCKER compose pull -q
$DOCKER compose up -d

PORT=$(sed -n 's/^MAGPIE_PORT=//p' .env)
PORT=${PORT:-3000}
printf 'Starting'
i=0
until curl -fsS -o /dev/null --max-time 5 "http://127.0.0.1:$PORT/login" 2>/dev/null; do
  i=$((i + 1))
  [ "$i" -lt 60 ] || fail "it hasn't answered on port $PORT after two minutes. See what it says: cd $(pwd) && $DOCKER compose logs"
  printf '.'
  sleep 2
done

say ""
say ""
say "MagpieCRM $VERSION is running at http://localhost:$PORT"
if [ -n "$PASSWORD" ]; then
  say ""
  say "  Sign in with  $EMAIL"
  say "  Password      $PASSWORD   (also in $(pwd)/.env; change it in Settings)"
fi
say ""
say "Next:"
say "  - Settings -> Sending: connect your SMTP server or email provider."
say "  - Settings -> Data source: add a SocialFetch key for prospect search."
say "  - Before you send, put it behind https on your own domain and set PUBLIC_URL in .env."
say ""
say "Logs: cd $(pwd) && $DOCKER compose logs -f"
say "Upgrade: curl -fsSL https://raw.githubusercontent.com/$REPO/main/install.sh | MAGPIE_DIR=$(pwd) sh"
