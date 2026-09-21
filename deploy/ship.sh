#!/usr/bin/env bash
#
# Pull, rebuild, and then PROVE the thing that matters is live.
#
# A deploy that returns 200 on /healthz has proved that a process started, and
# nothing else. The fault that cost real money — the server filtering on an
# entitlement nobody's dashboard grants — is invisible to every check of that
# kind: the webhook answers 200, the log says nothing, and the purchase simply
# does not arrive. So the last check here asks the server what it filters on
# and reads the answer back.
#
#   ssh root@91.108.104.168 'cd ~/tulmi && ./deploy/ship.sh'
#
# Safe to run repeatedly. It writes nothing to the database: the webhook probe
# is refused before any row is touched, and the secret is read from the env
# file without ever being printed.

set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

API="${API:-https://api.tailzu.space}"
ENV_FILE="${ENV_FILE:-tulmi/.env}"
# The entitlement as the RevenueCat dashboard spells it. The server must agree.
WANT_ENTITLEMENT="${WANT_ENTITLEMENT:-TAILZU AIR}"

pass=0; fail=0
ok()   { printf '  \033[32mPASS\033[0m  %s\n' "$1"; pass=$((pass+1)); }
bad()  { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; fail=$((fail+1)); }
step() { printf '\n\033[1m%s\033[0m\n' "$1"; }

# ---------------------------------------------------------------- pull + build
# CHECK=1 runs the proof without touching the deploy — for asking "is the
# server actually right?" without rebuilding it first.
if [ "${CHECK:-}" = "1" ]; then
  step "Checking only (CHECK=1)"
else
step "Pulling"
git pull --ff-only || { echo "pull failed — resolve it and run again"; exit 1; }
printf '  at %s\n' "$(git log --oneline -1)"

step "Rebuilding"
docker compose up -d --build backend || { echo "build failed"; exit 1; }

step "Waiting for the container"
for i in $(seq 1 60); do
  code=$(curl -sS -o /dev/null -w '%{http_code}' "$API/healthz" 2>/dev/null)
  [ "$code" = "200" ] && break
  sleep 2
done
[ "${code:-}" = "200" ] && ok "healthz answers ($((i*2))s)" || bad "healthz never answered"
fi

# --------------------------------------------------------------------- serving
step "Serving"
code=$(curl -sS -o /dev/null -w '%{http_code}' "$API/v1/site")
[ "$code" = "200" ] && ok "site copy" || bad "site copy → $code"

code=$(curl -sS -o /dev/null -w '%{http_code}' -I "$API/downloads/Tailzu-Setup.exe")
case "$code" in
  200) ok "windows installer published" ;;
  404) bad "windows installer missing — scp it to ~/tulmi/downloads/" ;;
  *)   bad "windows installer → $code" ;;
esac

# --------------------------------------------------------------------- payments
step "Payments"

# The endpoint that grants every subscription. Open, it is a free subscription
# for anyone who finds the URL.
code=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$API/v1/billing/revenuecat" \
  -H 'Content-Type: application/json' -d '{}')
case "$code" in
  401) ok "webhook refuses an unsigned call" ;;
  503) bad "webhook has no REVENUECAT_WEBHOOK_SECRET — no purchase can ever grant anything" ;;
  404) bad "webhook is not routed to the backend — check nginx" ;;
  *)   bad "webhook answered $code to an unsigned call (expected 401)" ;;
esac

# The secret the server is actually holding — the bytes the webhook compares
# against — read straight out of the running container. The env file is only
# the fallback, for a machine without docker, and it is read the way compose
# reads it: the last line wins, quotes come off, a Windows line ending is not
# part of the value. A naive grep of the file sent the quotes and got a 401
# from a server that was configured correctly.
secret_from_container() {
  docker compose exec -T backend printenv REVENUECAT_WEBHOOK_SECRET 2>/dev/null | tr -d '\r\n'
}
secret_from_file() {
  grep -E '^(export )?REVENUECAT_WEBHOOK_SECRET=' "$ENV_FILE" 2>/dev/null | tail -n1 \
    | cut -d= -f2- | tr -d '\r' \
    | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' \
          -e "s/^'\(.*\)'\$/\1/" -e 's/^"\(.*\)"$/\1/'
}
FILE_SECRET=$(secret_from_file)
SECRET=$(secret_from_container)
if [ -n "$SECRET" ]; then src="the running container"; else SECRET="$FILE_SECRET"; src="$ENV_FILE"; fi

if [ -z "$SECRET" ]; then
  bad "no REVENUECAT_WEBHOOK_SECRET in $ENV_FILE"
else
  # The file and the container disagree only when the file was edited after
  # the last build — a CHECK=1 run on a stale container. Compared here, in the
  # shell, so neither value is ever printed.
  if [ -n "$FILE_SECRET" ] && [ "$src" = "the running container" ] && [ "$FILE_SECRET" != "$SECRET" ]; then
    bad "$ENV_FILE changed since the container was built — run again without CHECK=1"
  fi
  n=$(grep -cE '^(export )?REVENUECAT_WEBHOOK_SECRET=' "$ENV_FILE" 2>/dev/null)
  [ "${n:-0}" -gt 1 ] && bad "REVENUECAT_WEBHOOK_SECRET is set $n times in $ENV_FILE — the last one wins; delete the others"

  # THE ONE THAT WOULD HAVE CAUGHT IT.
  #
  # An event naming an entitlement that is deliberately not ours is refused,
  # and the refusal NAMES what the server does filter on. So the answer to
  # "which entitlement is this server configured for" comes from the server
  # itself rather than from a file somebody meant to edit.
  #
  # Nothing is written: the filter returns before the database is touched, and
  # the user id is random and belongs to nobody.
  body=$(curl -sS -X POST "$API/v1/billing/revenuecat" \
    -H "Authorization: $SECRET" -H 'Content-Type: application/json' \
    -d '{"event":{"type":"INITIAL_PURCHASE","app_user_id":"00000000-0000-4000-8000-000000000000","entitlement_ids":["ship-sh-probe"],"store":"APP_STORE","environment":"PRODUCTION"}}')
  if [ -z "$body" ]; then
    bad "webhook returned nothing to a signed call"
  elif printf '%s' "$body" | grep -qi "not $WANT_ENTITLEMENT"; then
    ok "webhook accepts its secret, and filters on $WANT_ENTITLEMENT"
    # The one thing no command on this machine can prove: that RevenueCat is
    # sending THIS secret. Its dashboard can — Webhooks → Send test event → 200.
    printf '        (RevenueCat sending the same secret: prove it with Send test event → 200)\n'
  elif printf '%s' "$body" | grep -qi 'unauthorized'; then
    bad "the server rejects the secret read from $src"
  else
    bad "server is NOT filtering on $WANT_ENTITLEMENT — every purchase is charged and granted nothing"
    printf '        it said: %s\n' "$body"
  fi
fi

# What a phone is told before anyone signs in. A bootstrap that cannot answer
# is an app that cannot open.
boot=$(curl -sS -X POST "$API/v1/app/bootstrap" \
  -H 'Content-Type: application/json' -d '{"capabilities":{"device":{}}}')
printf '%s' "$boot" | grep -q '"schemaVersion"' \
  && ok "bootstrap answers a signed-out app" \
  || bad "bootstrap did not answer"

# The desktop's purchase link. Absent, its paywall is drawn with dead rows.
if printf '%s' "$boot" | grep -q 'paywall.web.url'; then
  bad "paywall.web.url reached a PHONE — an external purchase link in an iOS build is what Apple rejects for"
else
  ok "no external purchase link is sent to a phone"
fi
desk=$(curl -sS -X POST "$API/v1/app/bootstrap" -H 'Content-Type: application/json' \
  -d '{"capabilities":{"device":{"formFactor":"desktop"}}}')
printf '%s' "$desk" | grep -q 'paywall.web.url' \
  && ok "the desktop is given its purchase link" \
  || bad "no REVENUECAT_WEB_PAYWALL_URL — the desktop paywall cannot sell"

# ----------------------------------------------------------------------- verdict
printf '\n\033[1m%s passed, %s failed\033[0m\n' "$pass" "$fail"
[ "$fail" -eq 0 ] || exit 1
