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
# `$$` in the file is how you tell Compose to pass a literal `$` through, so
# the process receives one `$` where the file holds two. Undone here, or this
# script compares the file's spelling against the container's value and reports
# a mismatch that is only in its own reading.
val(){ grep -m1 "^$1=" $ENVF | cut -d= -f2- | tr -d '\r' \
        | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'\$//" -e 's/\$\$/$/g'; }
SEC=$(val REVENUECAT_WEBHOOK_SECRET)
WANT=$(val REVENUECAT_ENTITLEMENT); WANT=${WANT:-pro}
[ -n "$SEC" ] || { echo "no REVENUECAT_WEBHOOK_SECRET — the webhook refuses everything"; exit 1; }
echo "entitlement filter: '$WANT'"
echo "webhook secret: ${#SEC} chars"

send(){ curl -s -X POST $API/v1/billing/revenuecat -H "Authorization: ${2:-$SEC}" \
        -H 'Content-Type: application/json' -d "$1"; }
evt(){ printf '{"event":{"type":"%s","app_user_id":"%s","entitlement_ids":["%s"],"environment":"PRODUCTION","store":"app_store"}}' "$1" "$2" "$3"; }
boot(){ curl -s -X POST $API/v1/app/bootstrap -H 'Content-Type: application/json' \
  -d "{\"launchCount\":1,\"capabilities\":{\"platform\":\"ios\",\"components\":[],\"device\":{\"formFactor\":\"$1\",\"width\":1120,\"height\":780}}}"; }

echo; echo "1. what a desktop is offered"
D=$(boot desktop); P=$(boot phone)
case "$D" in *'paywall.web.url'*) ok "a desktop is offered a purchase link";;
  *) no "no paywall.web.url — REVENUECAT_WEB_PAYWALL_URL unset, or the container did not restart";; esac
case "$D" in *'{app_user_id}'*|*'app_user_id='*) ok "the link carries a slot for the user id";;
  *'"paywall.web.url":"https://tailzu.space/pay'*) ok "the desktop adds ?app_user_id= to tailzu.space/pay, which reads it";;
  *) echo "  NOTE  no {app_user_id} in the link: the desktop appends ?app_user_id=, right for a Web Purchase Link, wrong for a hosted paywall link";; esac
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

echo; echo "4. the checkout the desktop opens (Razorpay)"
URL=$(printf '%s' "$D" | grep -o '"paywall.web.url":"[^"]*"' | cut -d'"' -f4)
echo "  link: ${URL:-none}"
case "$URL" in
  https://tailzu.space/pay*) ok "the link is tailzu.space/pay";;
  "") no "no link at all — set REVENUECAT_WEB_PAYWALL_URL=https://tailzu.space/pay in $ENVF, then: docker compose up -d backend";;
  *) echo "  NOTE  not our pay page; checks below cover tailzu.space/pay only";;
esac
CODE=$(curl -s -o /dev/null -w '%{http_code}' "$API/pay")
if [ "$CODE" = 302 ]; then
  echo "  NOTE  Tailzu is free (FREE_FOR_ALL): /pay sends people to /pricing, and nothing is sold."
  echo "        The checks below still prove the webhook, so it is ready the day that is switched off."
  echo "        To prove a live payment meanwhile: put your account id in PAY_TESTERS, then"
  echo "        ./tulmi/scripts/paylink.sh <account id> prints the page that only you can buy on."
else
  PAGE=$(curl -s "$API/pay")
  case "$PAGE" in *'data-state="loading"'*) ok "the pay page is open for checkout";;
    *'data-state="off"'*) no "the pay page says checkout is not open — RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET missing, or no plan price could be read";;
    *) no "the pay page did not render";; esac
  N=$(printf '%s' "$PAGE" | grep -o '<button[^>]*data-market="[A-Za-z]*" data-period="[a-z]*"' | sort -u | wc -l | tr -d ' ')
  [ "$N" = 4 ] && ok "four plans on sale (IN and world, monthly and annual)" \
    || no "$N of 4 plans on sale — check RAZORPAY_PLANS lists IN and world, monthly and annual, from the same mode as the key"
  KEY=$(printf '%s' "$PAGE" | grep -o '"key":"rzp_[a-z]*_' | cut -d'"' -f4)
  case "$KEY" in rzp_live_) ok "live key id (public by design)";; rzp_test_) echo "  NOTE  TEST key — test cards only, nobody is charged. Switch to live keys once proven.";; *) no "no key id on the page";; esac
  case "$(curl -sI "$API/pay" | tr -d '\r' | grep -i '^content-security-policy:')" in
    *razorpay.com*) ok "the pay page's security policy allows Razorpay";;
    *) no "the pay page has no security policy naming Razorpay";; esac
fi

RSEC=$(val RAZORPAY_WEBHOOK_SECRET)
rsend(){ curl -s -o /tmp/rz.out -w '%{http_code}' -X POST $API/v1/billing/razorpay \
         -H 'Content-Type: application/json' -H "X-Razorpay-Signature: $2" -d "$1"; }
# A subscription id Razorpay has never issued: the webhook must accept the
# signature, then ask Razorpay, which says the id does not exist. That answer
# proves the secret, the raw-body check and the API keys in one go.
RBODY='{"event":"subscription.charged","payload":{"subscription":{"entity":{"id":"sub_paytest000000"}}}}'
if [ -z "$RSEC" ]; then
  no "no RAZORPAY_WEBHOOK_SECRET — Razorpay's webhook refuses everything"
else
  [ "$(rsend "$RBODY" 0000)" = 401 ] && ok "a webhook with a bad signature is rejected" || no "a forged Razorpay webhook was not rejected: $(cat /tmp/rz.out)"
  SIG=$(printf '%s' "$RBODY" | openssl dgst -sha256 -hmac "$RSEC" | sed 's/^.*= //')
  RC=$(rsend "$RBODY" "$SIG"); RB=$(cat /tmp/rz.out)
  case "$RC:$RB" in
    401:*) no "the real webhook secret is rejected — the container holds a different RAZORPAY_WEBHOOK_SECRET; restart it";;
    500:*'does not exist'*) ok "signature accepted, and Razorpay answered with these keys (the test id does not exist, as intended)";;
    500:*uthentication*) no "signature accepted, but Razorpay refused the API keys — check RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET";;
    503:*) no "RAZORPAY_WEBHOOK_SECRET is not in the running container — restart it";;
    *) no "unexpected: $RC $RB";;
  esac
fi
rm -f /tmp/rz.out
if docker compose logs --since 72h backend 2>/dev/null | grep -q 'subscriptions unreadable'; then
  no "the razorpay_subscriptions table cannot be read — run supabase/migrations/0015_razorpay.sql"
fi

# What a buyer's browser reported, in Razorpay's words (the pay page sends it).
# (Logs go with the container: a deploy starts this count again from zero.)
SEEN=$(docker compose logs --since 72h backend 2>/dev/null | grep 'pay: ' | grep -o '"code":"[^"]*","detail":"[^"]\{0,80\}' | sort | uniq -c | sort -rn | head -5)
if [ -n "$SEEN" ]; then
  echo "  checkout or Razorpay failures in the last 3 days:"; printf '%s\n' "$SEEN" | sed 's/^/    /'
else
  echo "  no checkout failure reported in the last 3 days"
fi
cat <<'TXT'
  Settings this script cannot see (each one stops a desktop purchase):
    Razorpay  Subscriptions switched on for the account (Dashboard > Subscriptions)
    Razorpay  The plans, made by tulmi/scripts/razorpay-plans.mjs in the same mode (test/live) as the key
    Razorpay  Webhook https://api.tailzu.space/v1/billing/razorpay, all subscription.* events,
              secret = RAZORPAY_WEBHOOK_SECRET
    Razorpay  International cards switched on, to take payments from outside India
TXT

echo; echo "$pass passed, $fail failed  (no account touched)"
[ "$fail" -eq 0 ] || exit 1
