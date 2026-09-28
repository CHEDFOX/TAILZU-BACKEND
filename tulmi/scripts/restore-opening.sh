#!/usr/bin/env bash
# Give the app its own opening back.
#
# The opening plays the in-app mic's media (mic.animation) unless an `intro`
# key exists. seed-media.sh once uploaded a rendered film under `intro` and
# `intro.desktop`, which put that film in front of the mic's. This removes
# both keys; the files stay on disk, and mic.animation is never touched.
#
#   cd ~/tulmi && ./tulmi/scripts/restore-opening.sh
set -u
API=${API:-http://127.0.0.1:8770}
ENVF=tulmi/.env
[ -f "$ENVF" ] || { echo "run this from ~/tulmi"; exit 1; }
SECRET=$(grep -m1 "^ADMIN_SECRET=" $ENVF | cut -d= -f2- | tr -d '\r' \
          | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//" -e 's/\$\$/$/g')
[ -n "$SECRET" ] || { echo "No ADMIN_SECRET in $ENVF"; exit 1; }

for key in intro intro.desktop; do
  printf '%-16s ' "$key"
  code=$(curl -sS -o /dev/null -w '%{http_code}' -X DELETE "$API/v1/media/$key" -H "x-admin-secret: $SECRET")
  case "$code" in
    200) echo "removed" ;;
    404) echo "not set" ;;
    *)   echo "failed ($code)" ;;
  esac
done

# What the opening plays now, in the order the server picks it.
curl -sS "$API/v1/media/list" -H "x-admin-secret: $SECRET" | python3 -c '
import json, sys
r = json.load(sys.stdin).get("registry", {})
for k in ("intro", "mic.animation", "mic.animation.mp4"):
    if r.get(k, {}).get("url"):
        print("opening plays  " + k + "  " + r[k]["url"]); break
else:
    print("opening plays  the built-in mark")'
