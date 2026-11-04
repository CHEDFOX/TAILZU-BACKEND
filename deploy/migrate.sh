#!/usr/bin/env bash
#
# Runs database migrations (tulmi/supabase/migrations) on the live database, by number, from the server's env file, so the
# database address is never typed or printed. Each file runs whole or not at all; the migrations are written to be safe to run again.
#
#   ssh root@91.108.104.168 'cd ~/tulmi && git pull --ff-only && ./deploy/migrate.sh 0062 0063 0064 0065'
#   ssh root@91.108.104.168 'cd ~/tulmi && ./deploy/migrate.sh'                 lists the latest migrations
#
# Needs SUPABASE_DB_URL in tulmi/.env (Supabase → Connect → Session pooler, port 5432), the same line the nightly backup uses.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
ENV_FILE="${ENV_FILE:-tulmi/.env}"
DIR="tulmi/supabase/migrations"
PG_IMAGE="${PG_IMAGE:-postgres:17-alpine}"

if [ "$#" -eq 0 ]; then
  echo "Give the numbers to run, e.g.  ./deploy/migrate.sh 0062 0063"
  echo "The latest:"; ls "$DIR" | tail -n 6 | sed 's/^/  /'
  exit 0
fi

[ -f "$ENV_FILE" ] || { echo "No $ENV_FILE here. Run this from the repo on the server."; exit 1; }
DBURL="$(sed -n 's/^SUPABASE_DB_URL=//p' "$ENV_FILE" | tail -n1 | tr -d '"\r')"
if [ -z "$DBURL" ]; then
  echo "SUPABASE_DB_URL is not in $ENV_FILE. Either add it (Supabase → Connect → Session pooler) and run this again,"
  echo "or paste each file into Supabase → SQL Editor and press Run:"
  for n in "$@"; do ls "$DIR"/"$n"_*.sql 2>/dev/null | sed 's/^/  /'; done
  exit 1
fi
export DBURL

fail=0
for n in "$@"; do
  f=$(ls "$DIR"/"$n"_*.sql 2>/dev/null | head -n1)
  if [ -z "$f" ]; then echo "  FAIL  no migration $n"; fail=$((fail+1)); continue; fi
  if out=$(docker run -i --rm -e DBURL -e PGCONNECT_TIMEOUT=30 "$PG_IMAGE" sh -c 'psql "$DBURL" -q -X -1 -v ON_ERROR_STOP=1' < "$f" 2>&1); then
    echo "  PASS  $(basename "$f")"
  else
    echo "  FAIL  $(basename "$f")"; printf '%s\n' "$out" | grep -v -i "password" | tail -n 5 | sed 's/^/        /'; fail=$((fail+1))
  fi
done
[ "$fail" = "0" ] && echo "Done." || { echo "$fail failed."; exit 1; }
