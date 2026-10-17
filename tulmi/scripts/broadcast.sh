#!/usr/bin/env bash
# One push to everyone with the app, now.
#
#   cd ~/tulmi && ./tulmi/scripts/broadcast.sh "Title" "Body"          # counts only, sends nothing
#   cd ~/tulmi && ./tulmi/scripts/broadcast.sh "Title" "Body" --send   # sends
#
# The same words twice send nothing the second time. People whose clock says
# it is night are skipped (add --anytime to include them), and so is anyone
# the control plane has switched off. It counts as that person's push for the
# day, so the smart engine does not follow it with another.
set -u
API=${API:-http://127.0.0.1:8770}
ENVF=tulmi/.env
[ -f "$ENVF" ] || { echo "run this from ~/tulmi"; exit 1; }
[ $# -ge 2 ] || { sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'; exit 1; }

val(){ grep -m1 "^$1=" $ENVF | cut -d= -f2- | tr -d '\r' \
        | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//" -e 's/\$\$/$/g'; }
SECRET=$(val ADMIN_SECRET)
[ -n "$SECRET" ] || { echo "No ADMIN_SECRET in $ENVF"; exit 1; }

TITLE=$1; BODY=$2; shift 2
SEND=false; ANYTIME=false
for a in "$@"; do
  case $a in --send) SEND=true ;; --anytime) ANYTIME=true ;; esac
done

JSON=$(TITLE="$TITLE" BODY="$BODY" SEND=$SEND ANYTIME=$ANYTIME python3 -c '
import json, os
print(json.dumps({"title": os.environ["TITLE"], "body": os.environ["BODY"],
                  "send": os.environ["SEND"] == "true", "ignoreQuiet": os.environ["ANYTIME"] == "true"}))')

curl -sS -X POST "$API/v1/admin/push/broadcast" \
  -H "x-admin-secret: $SECRET" -H "content-type: application/json" \
  --data "$JSON"
echo
$SEND || echo "Nothing sent. Add --send to send."
