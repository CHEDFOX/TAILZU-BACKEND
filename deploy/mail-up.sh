#!/usr/bin/env bash
#
# Switches on the mail worker (mail-worker/, docs/mail.md): run it once. The mailboxes live on the mail server Xooteq Mail runs on this VPS
# (/opt/postal), which stays as it is. This takes that server's admin login, its mail domain and the VPS's address into the server's env
# file (tulmi/.env, which the worker reads like the backend), makes the worker's two secrets and its address, builds and starts it on the
# mail server's network, and registers the worker's own new-mail webhook there (beside Xooteq Mail's, which is not touched). After that,
# ./deploy/ship.sh rebuilds and restarts it with the backend. Prints the keys it handled, never a value.
#
#   ssh root@91.108.104.168 'cd ~/tulmi && ./deploy/mail-up.sh && ./deploy/ship.sh'
set -euo pipefail
cd "$(dirname "$0")/.." || exit 1
SERVER_ENV="${ENV_FILE:-tulmi/.env}"
POSTAL_ENV="${POSTAL_ENV:-/opt/postal/.env}"
[ -f "$SERVER_ENV" ] || { echo "No $SERVER_ENV here. Run this from the repo on the server."; exit 1; }
[ -f "$POSTAL_ENV" ] || { echo "No $POSTAL_ENV: the mail server (xooteq-mail's workspace-setup.sh) must be set up on this VPS first."; exit 1; }

# The last value a file gives a key, as written, or nothing.
value() { sed -n "s/^$1=//p" "$2" | tail -n1; }
# Takes the key's line out of the file, in place (the file keeps its owner and mode).
drop() {
  local tmp; tmp=$(mktemp)
  grep -v "^$1=" "$2" > "$tmp" || true
  cat "$tmp" > "$2"; rm -f "$tmp"
}
# Replaces the key's line in the file, or adds it.
put() { drop "$1" "$3"; printf '%s=%s\n' "$1" "$2" >> "$3"; }

# The mail server's own values: its admin login (to make each business's mailbox), the platform's mail domain and the VPS's address
# (the DNS records a business adds).
for k in STALWART_ADMIN_USER STALWART_ADMIN_SECRET MAIL_DOMAIN VPS_IP; do
  v=$(value "$k" "$POSTAL_ENV")
  [ -n "$v" ] || { echo "$k is not in $POSTAL_ENV: run xooteq-mail's workspace-setup.sh first."; exit 1; }
  if [ "$(value "$k" "$SERVER_ENV")" != "$v" ]; then put "$k" "$v" "$SERVER_ENV"; echo "$k: taken from the mail server, into $SERVER_ENV"; fi
done
for k in MAIL_WORKER_SECRET MAIL_WEBHOOK_SECRET; do
  if [ -z "$(value "$k" "$SERVER_ENV")" ]; then put "$k" "$(openssl rand -hex 32)" "$SERVER_ENV"; echo "$k: made, in $SERVER_ENV"; fi
done
if [ -z "$(value MAIL_WORKER_URL "$SERVER_ENV")" ]; then put MAIL_WORKER_URL "http://mail-worker:5300" "$SERVER_ENV"; echo "MAIL_WORKER_URL: set, in $SERVER_ENV"; fi
[ -n "$(value OPENROUTER_API_KEY "$SERVER_ENV")" ] || { echo "The mail's AI needs OPENROUTER_API_KEY: add it to $SERVER_ENV and run this again."; exit 1; }

# The mail server's Docker network (compose reads MAIL_STALWART_NETWORK from the .env beside docker-compose.yml, else postal_default).
NET=$( [ -f .env ] && value MAIL_STALWART_NETWORK .env || true ); NET=${NET:-postal_default}
docker network inspect "$NET" >/dev/null 2>&1 || { echo "No Docker network $NET: is the mail server running? (If its network has another name, put MAIL_STALWART_NETWORK=<it> in the .env beside docker-compose.yml.)"; exit 1; }

docker compose --profile mail up -d --build mail-worker
ready=""
for i in $(seq 1 30); do
  ready=$(docker compose exec -T mail-worker wget -qO- http://127.0.0.1:5300/healthz 2>/dev/null || true)
  printf '%s' "$ready" | grep -q '"ok":true' && break
  sleep 2
done
printf '%s' "$ready" | grep -q '"ok":true' || { echo "The worker did not start: docker compose logs mail-worker"; exit 1; }
printf '%s' "$ready" | grep -q '"ready":true' || echo "The worker is up but not set up: $(printf '%s' "$ready" | sed -n 's/.*"missing":\(\[[^]]*\]\).*/\1/p')"
docker compose exec -T mail-worker node --disable-warning=ExperimentalWarning server/cli.ts webhook
echo "The worker is up, and the mail server tells it of new mail. Now ./deploy/ship.sh, so the backend reads MAIL_WORKER_URL and MAIL_WORKER_SECRET."
