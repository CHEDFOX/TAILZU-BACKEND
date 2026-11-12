#!/usr/bin/env bash
#
# Switches on the Oracle's worker (oracle-worker/, docs/oracle.md): run it once. The worker reads the server's env file (tulmi/.env), like
# the backend. This makes ORACLE_WORKER_SECRET there when it has none, sets ORACLE_WORKER_URL when it is not set, and builds and starts the
# worker; ./deploy/ship.sh then rebuilds and restarts it with the backend, so a change to it or to tulmi/.env reaches it too. Prints the keys
# it handled, never a value. (An earlier version copied three keys beside docker-compose.yml; it takes those copies away.)
#
#   ssh root@91.108.104.168 'cd ~/tulmi && ./deploy/oracle-up.sh && ./deploy/ship.sh'
set -euo pipefail
cd "$(dirname "$0")/.." || exit 1
SERVER_ENV="${ENV_FILE:-tulmi/.env}"
[ -f "$SERVER_ENV" ] || { echo "No $SERVER_ENV here. Run this from the repo on the server."; exit 1; }

# The last value the file gives a key, as written, or nothing.
value() { sed -n "s/^$1=//p" "$2" | tail -n1; }
# Takes the key's line out of the file, in place (the file keeps its owner and mode).
drop() {
  local tmp; tmp=$(mktemp)
  grep -v "^$1=" "$2" > "$tmp" || true
  cat "$tmp" > "$2"; rm -f "$tmp"
}
# Replaces the key's line in the file, or adds it.
put() { drop "$1" "$3"; printf '%s=%s\n' "$1" "$2" >> "$3"; }

if [ -z "$(value ORACLE_WORKER_SECRET "$SERVER_ENV")" ]; then
  put ORACLE_WORKER_SECRET "$(openssl rand -hex 32)" "$SERVER_ENV"; echo "ORACLE_WORKER_SECRET: made, in $SERVER_ENV"
fi
if [ -z "$(value ORACLE_WORKER_URL "$SERVER_ENV")" ]; then
  put ORACLE_WORKER_URL "http://oracle-worker:8000" "$SERVER_ENV"; echo "ORACLE_WORKER_URL: set, in $SERVER_ENV"
fi
[ -n "$(value OPENROUTER_API_KEY "$SERVER_ENV")" ] || { echo "The worker needs OPENROUTER_API_KEY: add it to $SERVER_ENV and run this again."; exit 1; }
[ -n "$(value OPENAI_API_KEY "$SERVER_ENV")" ] || echo "OPENAI_API_KEY: not in $SERVER_ENV, so each question shows the model the whole list (slower, dearer)"

if [ -f .env ]; then
  for k in ORACLE_WORKER_SECRET OPENROUTER_API_KEY OPENAI_API_KEY; do
    if grep -q "^$k=" .env; then drop "$k" .env; echo "$k: the old copy beside docker-compose.yml taken away (the worker reads $SERVER_ENV)"; fi
  done
fi

docker compose --profile oracle up -d --build oracle-worker
echo "The worker is starting. Now ./deploy/ship.sh, so the backend reads ORACLE_WORKER_URL and ORACLE_WORKER_SECRET."
