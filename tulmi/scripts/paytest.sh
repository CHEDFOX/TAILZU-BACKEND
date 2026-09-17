#!/usr/bin/env bash
# Prove the desktop purchase path end to end, without spending anything.
#
# Grants an entitlement through the real webhook, checks the real table, then
# puts the account back exactly as it was. Run from ~/tulmi.
#
#   ./paytest.sh <your-supabase-user-id>
set -u
UID_IN="${1:-}"
API=http://127.0.0.1:8770
ENVF=tulmi/.env
pass=0; fail=0
ok(){ echo "  PASS  $1"; pass=$((pass+1)); }
no(){ echo "  FAIL  $1"; fail=$((fail+1)); }

[ -f "$ENVF" ] || { echo "run this from ~/tulmi"; exit 1; }
[ -n "$UID_IN" ] || { echo "usage: ./paytest.sh <supabase-user-id>"; exit 1; }

SEC=$(grep -m1 '^REVENUECAT_WEBHOOK_SECRET=' $ENVF | cut -d= -f2-)
SUPA=$(grep -m1 '^SUPABASE_URL=' $ENVF | cut -d= -f2-)
KEY=$(grep -m1 '^SUPABASE_SERVICE_KEY=' $ENVF | cut -d= -f2-)
WANT=$(grep -m1 '^REVENUECAT_ENTITLEMENT=' $ENVF | cut -d= -f2- | tr -d '"')
WANT=${WANT:-pro}
[ -n "$SEC" ] || { echo "no REVENUECAT_WEBHOOK_SECRET set — the webhook refuses everything"; exit 1; }
echo "entitlement filter: '$WANT'"

row(){ curl -s "$SUPA/rest/v1/entitlements?user_id=eq.$UID_IN&select=active,entitlement,store" \
        -H "apikey: $KEY" -H "Authorization: Bearer $KEY"; }
send(){ curl -s -X POST $API/v1/billing/revenuecat -H "Authorization: $SEC" \
        -H 'Content-Type: application/json' -d "$1"; }
ev(){ printf '{"event":{"type":"%s","app_user_id":"%s","entitlement_ids":["%s"],"environment":"PRODUCTION","store":"paddle","expiration_at_ms":%s}}' \
        "$1" "$UID_IN" "$WANT" "$(( ($(date +%s)+2592000) * 1000 ))"; }

BEFORE=$(row)
echo "before: $BEFORE"
case "$BEFORE" in *'"active":true'*)
  echo; echo "STOP — this account already has an ACTIVE entitlement."
  echo "Revoking at the end would take away a real subscription. Use another account."
  exit 1;; esac

echo; echo "1. the link reaches a desktop and only a desktop"
boot(){ curl -s -X POST $API/v1/app/bootstrap -H 'Content-Type: application/json' \
  -d "{\"launchCount\":1,\"capabilities\":{\"platform\":\"ios\",\"components\":[],\"device\":{\"formFactor\":\"$1\",\"width\":1120,\"height\":780}}}"; }
D=$(boot desktop); P=$(boot phone)
case "$D" in *'paywall.web.url'*) ok "desktop is offered a purchase link";;
  *) no "desktop got NO paywall.web.url — REVENUECAT_WEB_PAYWALL_URL unset, or the container did not restart";; esac
case "$D" in *'{app_user_id}'*|*'app_user_id='*) ok "the link carries a slot for the user id";;
  *) no "the link has no {app_user_id} — every purchase would be anonymous";; esac
case "$P" in *'paywall.web.url'*) no "a PHONE was offered the link — this is the anti-steering rule Apple rejects for";;
  *) ok "a phone is not offered it";; esac
case "$D" in *'desktop.shell'*) ok "the desktop chrome is being served";;
  *) no "no desktop.shell — the deploy is older than that change";; esac

echo; echo "2. a purchase grants"
G=$(send "$(ev INITIAL_PURCHASE)"); echo "  -> $G"
case "$G" in *'"ok":true'*) ok "the webhook accepted it";; *) no "the webhook refused it";; esac
AFTER=$(row); echo "  row: $AFTER"
case "$AFTER" in *'"active":true'*) ok "the entitlements row is live — this account is now paid";;
  *) no "nothing was written to the table";; esac

echo; echo "3. an anonymous purchase is refused"
A=$(send "{\"event\":{\"type\":\"INITIAL_PURCHASE\",\"app_user_id\":\"\$RCAnonymousID:deadbeef\",\"entitlement_ids\":[\"$WANT\"],\"environment\":\"PRODUCTION\",\"store\":\"paddle\"}}")
case "$A" in *'no Supabase user id'*) ok "refused, and says why";;
  *) no "an anonymous purchase was NOT refused: $A";; esac

echo; echo "4. putting it back"
R=$(send "$(ev EXPIRATION)"); echo "  -> $R"
END=$(row); echo "  row: $END"
case "$END" in *'"active":false'*) ok "revoked — the account is as it started";;
  *) no "STILL ACTIVE. Revoke by hand before you forget: $END";; esac

echo; echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ] || exit 1
