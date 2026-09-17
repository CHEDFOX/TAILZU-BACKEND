#!/usr/bin/env bash
# Prove the desktop purchase path, touching no account and spending nothing.
#
# Run from ~/tulmi:   ./tulmi/scripts/paytest.sh
#
# WHY NO USER ID IS NEEDED. Every decision the server makes about a purchase —
# is this event ours, is the entitlement ours, is there an account to attach it
# to — happens BEFORE the database write. Those are all exercised here against
# nothing. The write itself is proven by a synthetic user id: the table has
# `user_id references auth.users(id)`, so the row is refused by the foreign
# key. A refusal at that exact point is the proof, because reaching it means
# the secret, the filter, the service client and the table are all working.
set -u
API=http://127.0.0.1:8770
ENVF=tulmi/.env
# Deliberately synthetic, and not a shape Supabase mints.
GHOST=00000000-0000-4000-8000-0000000000ff
pass=0; fail=0
ok(){ echo "  PASS  $1"; pass=$((pass+1)); }
no(){ echo "  FAIL  $1"; fail=$((fail+1)); }

[ -f "$ENVF" ] || { echo "run this from ~/tulmi"; exit 1; }
# A .env value can arrive wrapped in quotes, and a file ever edited on Windows
# carries a trailing CR. Either one makes the header differ from what the
# server holds by a character nobody can see, and then EVERY call is 401 —
# including the one meant to prove a bad secret is rejected, which passes for
# the wrong reason. Both are stripped here.
val(){ grep -m1 "^$1=" $ENVF | cut -d= -f2- | tr -d '\r' | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'\$//"; }
SEC=$(val REVENUECAT_WEBHOOK_SECRET)
WANT=$(val REVENUECAT_ENTITLEMENT); WANT=${WANT:-pro}
[ -n "$SEC" ] || { echo "no REVENUECAT_WEBHOOK_SECRET — the webhook refuses everything"; exit 1; }
echo "entitlement filter: '$WANT'"
echo "webhook secret: ${#SEC} chars"

send(){ curl -s -X POST $API/v1/billing/revenuecat -H "Authorization: ${2:-$SEC}" \
        -H 'Content-Type: application/json' -d "$1"; }
evt(){ printf '{"event":{"type":"%s","app_user_id":"%s","entitlement_ids":["%s"],"environment":"PRODUCTION","store":"paddle"}}' "$1" "$2" "$3"; }
boot(){ curl -s -X POST $API/v1/app/bootstrap -H 'Content-Type: application/json' \
  -d "{\"launchCount\":1,\"capabilities\":{\"platform\":\"ios\",\"components\":[],\"device\":{\"formFactor\":\"$1\",\"width\":1120,\"height\":780}}}"; }

echo; echo "1. what a desktop is offered"
D=$(boot desktop); P=$(boot phone)
case "$D" in *'paywall.web.url'*) ok "a desktop is offered a purchase link";;
  *) no "no paywall.web.url — REVENUECAT_WEB_PAYWALL_URL unset, or the container did not restart";; esac
case "$D" in *'{app_user_id}'*|*'app_user_id='*) ok "the link carries a slot for the user id";;
  *) no "no {app_user_id} in the link — every purchase would be anonymous";; esac
case "$P" in *'paywall.web.url'*) no "a PHONE was offered the link — the anti-steering rule Apple rejects for";;
  *) ok "a phone is not offered it";; esac
case "$D" in *'desktop.shell'*) ok "the desktop chrome is being served";;
  *) no "no desktop.shell — this deploy predates that change";; esac
case "$D" in *'"paywall.blockUntilEntitled":false'*) ok "no desktop is locked out of a paywall it cannot pass";;
  *) no "blockUntilEntitled is true for a desktop";; esac

echo; echo "2. the webhook refuses what it should"
B=$(send "$(evt INITIAL_PURCHASE "$GHOST" "$WANT")" "wrong-secret")
case "$B" in *unauthorized*) ok "a bad secret is rejected";;
  *) no "a bad secret was NOT rejected: $B";; esac

LIVE=$(send "$(evt CANCELLATION "$GHOST" "$WANT")")
case "$LIVE" in *unauthorized*)
  echo
  echo "  STOP — the real secret is being rejected too, so everything below would"
  echo "  fail for one reason. The value in $ENVF does not match what the running"
  echo "  container holds. Either it was changed without a restart:"
  echo "      cd ~/tulmi && docker compose up -d --build backend"
  echo "  or the container reads a different file — check env_file in compose.yml."
  exit 1;; esac

A=$(send "$(evt INITIAL_PURCHASE '$RCAnonymousID:deadbeef' "$WANT")")
case "$A" in *'no Supabase user id'*) ok "an anonymous purchase is refused, and says why";;
  *) no "an anonymous purchase was not refused: $A";; esac

X=$(send "$(evt INITIAL_PURCHASE "$GHOST" "some-other-thing")")
case "$X" in *'event is for'*) ok "a purchase of something else in the project grants nothing";;
  *) no "a foreign entitlement was not filtered out: $X";; esac

I=$(send "$(evt TEST "$GHOST" "$WANT")")
case "$I" in *'ignored event'*) ok "an event type we do not act on is ignored";;
  *) no "an unknown event was not ignored: $I";; esac

C=$(send "$(evt CANCELLATION "$GHOST" "$WANT")")
case "$C" in *'runs to expiry'*) ok "cancelling does not revoke — they paid to the end of the period";;
  *) no "a cancellation was treated as a revoke: $C";; esac

echo; echo "3. the write reaches the database"
W=$(send "$(evt INITIAL_PURCHASE "$GHOST" "$WANT")")
case "$W" in
  *'"ok":true'*)
    no "a purchase for a non-existent user was WRITTEN — the foreign key is missing"
    send "$(evt EXPIRATION "$GHOST" "$WANT")" >/dev/null ;;
  *foreign*key*|*violates*)
    ok "filter passed, Supabase reached, row refused by the foreign key — exactly right" ;;
  *'no service client'*)
    no "SUPABASE_SERVICE_KEY is not set — no purchase can ever be recorded" ;;
  *) no "unexpected: $W" ;;
esac

echo; echo "$pass passed, $fail failed  (no account touched)"
[ "$fail" -eq 0 ] || exit 1
