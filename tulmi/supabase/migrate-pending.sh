#!/bin/sh
#
# THE NEW MIGRATIONS, RUN WHILE THE NEW IMAGE IS BUILT (the `migrate` stage of tulmi/Dockerfile).
#
# A deploy (deploy/ship.sh: `docker compose up -d --build backend`, by hand or from GitHub) builds the new image before it touches the
# running server, and the image cannot be built unless this ends well. So new code never runs before the tables it uses, and when a
# migration fails the build stops and the server keeps serving the code it had. Its output is the deploy's.
#
# It runs every migration newer than tulmi/supabase/LIVE_MIGRATION (the last one known to be on the database), in order, each whole or
# not at all. They are written to be safe to run again, so one that has run already only runs once more. The image build keeps this
# step while the migrations, this file and LIVE_MIGRATION stay the same, so a deploy without a new migration does not run them again.
#
# Only a deploy build runs them (DEPLOY_MIGRATIONS=1, docker-compose.yml), with tulmi/.env given as a build secret: a build anywhere
# else (CI, a laptop) skips this. The database address is SUPABASE_DB_URL there, read as written (never through a shell or compose, so
# any character in it is kept) and never printed.
set -eu

DIR=/migrations
ENV_FILE=/run/secrets/app_env

if [ "${DEPLOY_MIGRATIONS:-0}" != "1" ]; then echo "migrations: not a deploy build, skipped"; exit 0; fi
[ -f "$ENV_FILE" ] || { echo "migrations: tulmi/.env was not given to the build (docker-compose.yml build.secrets). Not deploying."; exit 1; }

# One value from the env file: the last line that sets it, without quotes. Never sourced, so nothing else in it runs.
val() { sed -n "s/^$1=//p" "$ENV_FILE" | tail -n1 | tr -d '"\r'; }
DBURL="$(val SUPABASE_DB_URL)"
if [ -z "$DBURL" ]; then
  # A server with no database (everything in memory) has nothing to migrate; one with Supabase must be able to reach it.
  if [ -z "$(val SUPABASE_URL)" ]; then echo "migrations: no database configured, nothing to run"; exit 0; fi
  echo "migrations: SUPABASE_DB_URL is not in tulmi/.env (Supabase → Connect → Session pooler). Not deploying: the server is unchanged."
  exit 1
fi

last="$(tr -dc '0-9' < /LIVE_MIGRATION)"
[ -n "$last" ] || { echo "migrations: tulmi/supabase/LIVE_MIGRATION is empty"; exit 1; }
pending=""
for f in $(ls "$DIR" | grep -E '^[0-9]{4}_[A-Za-z0-9_.-]+\.sql$' | sort); do
  n="${f%%_*}"
  if [ "$(expr "$n" + 0)" -gt "$(expr "$last" + 0)" ]; then pending="$pending $f"; fi
done
if [ -z "$pending" ]; then echo "migrations: none newer than $last"; exit 0; fi

# What psql says is shown without the password in it (deploy/migrate.sh and the backup hand psql the address the same way).
rest="${DBURL#*://}"; creds="${rest%@*}"; pw=""
case "$creds" in *:*) pw="${creds#*:}" ;; esac
hide() { if [ -n "$pw" ]; then grep -v -i "password" | grep -vF -- "$pw"; else grep -v -i "password"; fi; }
export PGCONNECT_TIMEOUT=30

echo "migrations: running$pending"
for f in $pending; do
  if out="$(psql "$DBURL" -q -X -1 -v ON_ERROR_STOP=1 -f "$DIR/$f" 2>&1)"; then
    echo "  PASS  $f"
  else
    echo "  FAIL  $f"
    printf '%s\n' "$out" | hide | tail -n 5 | sed 's/^/        /'
    echo "Not deploying: the server is unchanged. Fix the migration and deploy again."
    exit 1
  fi
done
echo "migrations: done"
