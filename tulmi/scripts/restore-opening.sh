#!/usr/bin/env bash
# Put the app's opening back: the splash film under `intro`, shown exactly as
# it was set on 11 Sep (the last change before the media seed replaced it).
#
#   cd ~/tulmi && ./tulmi/scripts/restore-opening.sh
#
# The film is still in the media volume, because nothing there is ever
# deleted; this points `intro` back at it, pinned by its checksum, with its
# presentation, and removes the seed's `intro.desktop`.
set -u
API=${API:-http://127.0.0.1:8770}
ENVF=tulmi/.env
SPLASH=d95d046ea5ea641eef83cc20c323e84c84936f612f199bfe1e8cbfcb730e1f5d
PRESENT='{"shape":"full","fit":"cover","holdMs":5300,"nudgeX":0.0347,"nudgeY":0.0154,"boxWidth":480,"boxHeight":1080,"aspect":0.444444,"background":"#0B0A0D"}'

[ -f "$ENVF" ] || { echo "run this from ~/tulmi"; exit 1; }
SECRET=$(grep -m1 "^ADMIN_SECRET=" $ENVF | cut -d= -f2- | tr -d '\r' \
          | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//" -e 's/\$\$/$/g')
[ -n "$SECRET" ] || { echo "No ADMIN_SECRET in $ENVF"; exit 1; }

TMP=$(mktemp --suffix=.mp4)
trap 'rm -f "$TMP"' EXIT
curl -sS -f -o "$TMP" "$API/media/$SPLASH.mp4" \
  || { [ -f ~/splash_padded.mp4 ] && cp ~/splash_padded.mp4 "$TMP"; }
[ "$(sha256sum "$TMP" | cut -d' ' -f1)" = "$SPLASH" ] \
  || { echo "splash film not found (want sha256 $SPLASH)"; exit 1; }

curl -sS -X POST "$API/v1/media/upload?key=intro" -H "x-admin-secret: $SECRET" \
  -F "file=@$TMP;type=video/mp4" | grep -q '"ok":true' || { echo "upload refused"; exit 1; }
curl -sS -X POST "$API/v1/media/present?key=intro&reset=true" -H "x-admin-secret: $SECRET" >/dev/null
curl -sS -X POST "$API/v1/media/present?key=intro" -H "x-admin-secret: $SECRET" \
  -H "content-type: application/json" --data "$PRESENT" | grep -q '"ok":true' || { echo "presentation refused"; exit 1; }
curl -sS -o /dev/null -X DELETE "$API/v1/media/intro.desktop" -H "x-admin-secret: $SECRET"

curl -sS "$API/v1/media/resolve?key=intro"; echo
