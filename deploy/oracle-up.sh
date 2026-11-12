#!/usr/bin/env bash
#
# Starts, or rebuilds, the Oracle's worker (oracle-worker/, docs/oracle.md) with the keys the server already has.
#
# Everything stays in the server's env file (tulmi/.env). The worker is given three keys and nothing else of the server's:
# ORACLE_WORKER_SECRET, OPENROUTER_API_KEY and OPENAI_API_KEY. Compose reads only the .env beside docker-compose.yml for
# itself, so this copies those three there, then builds and starts the worker. When tulmi/.env has no ORACLE_WORKER_SECRET
# it makes one, and when it has no ORACLE_WORKER_URL it sets it. Prints the keys it handled, never a value.
#
# Run it again after a key changes in tulmi/.env, or after a change under oracle-worker/ (ship.sh rebuilds the backend only):
#
#   ssh root@91.108.104.168 'cd ~/tulmi && ./deploy/oracle-up.sh && ./deploy/ship.sh'
set -euo pipefail
cd "$(dirname "$0")/.." || exit 1
SERVER_ENV="${ENV_FILE:-tulmi/.env}"
COMPOSE_ENV=".env"
[ -f "$SERVER_ENV" ] || { echo "No $SERVER_ENV here. Run this from the repo on the server."; exit 1; }
touch "$COMPOSE_ENV"

# The last value a file gives a key, as written (quotes and all), or nothing.
value() { sed -n "s/^$1=//p" "$2" | tail -n1; }
# Replaces the key's line in the file, or adds it. Writes in place, so the file keeps its owner and mode.
put() {
  local tmp; tmp=$(mktemp)
  grep -v "^$1=" "$3" > "$tmp" || true
  printf '%s=%s\n' "$1" "$2" >> "$tmp"
  cat "$tmp" > "$3"; rm -f "$tmp"
}

if [ -z "$(value ORACLE_WORKER_SECRET "$SERVER_ENV")" ]; then
  put ORACLE_WORKER_SECRET "$(openssl rand -hex 32)" "$SERVER_ENV"; echo "ORACLE_WORKER_SECRET: made, in $SERVER_ENV"
fi
if [ -z "$(value ORACLE_WORKER_URL "$SERVER_ENV")" ]; then
  put ORACLE_WORKER_URL "http://oracle-worker:8000" "$SERVER_ENV"; echo "ORACLE_WORKER_URL: set, in $SERVER_ENV"
fi

for k in ORACLE_WORKER_SECRET OPENROUTER_API_KEY OPENAI_API_KEY; do
  v=$(value "$k" "$SERVER_ENV")
  if [ -n "$v" ]; then put "$k" "$v" "$COMPOSE_ENV"; echo "$k: handed to the worker"
  elif [ -n "$(value "$k" "$COMPOSE_ENV")" ]; then echo "$k: not in $SERVER_ENV, so the worker keeps the one in $COMPOSE_ENV"
  else echo "$k: not set"; fi
done
[ -n "$(value OPENROUTER_API_KEY "$COMPOSE_ENV")" ] || { echo "The worker needs OPENROUTER_API_KEY: add it to $SERVER_ENV and run this again."; exit 1; }

docker compose --profile oracle up -d --build oracle-worker
echo "The worker is starting. Now ./deploy/ship.sh, so the backend reads ORACLE_WORKER_URL and ORACLE_WORKER_SECRET."
