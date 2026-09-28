#!/usr/bin/env bash
# Put the app's opening back exactly as it was before the media seed:
#
#   intro                  the splash film, with the presentation set on 11 Sep
#   onboarding.hero.still  the mic step's old still (it was onboarding.hero).
#                          A first launch's splash waits on it, and while it
#                          waits the splash film paints its first frame — that
#                          wait is what made splash-to-film seamless.
#
#   cd ~/tulmi && ./tulmi/scripts/restore-opening.sh
#
# Both files are still in the media volume, because nothing there is ever
# deleted; each is pinned by its checksum. Safe to run again.
set -u
API=${API:-http://127.0.0.1:8770}
ENVF=tulmi/.env
SPLASH=d95d046ea5ea641eef83cc20c323e84c84936f612f199bfe1e8cbfcb730e1f5d
STILL=1236d353ac90f95bb072aad7114436faab65e14787c5223d4fd20340acea8661
PRESENT='{"shape":"full","fit":"cover","holdMs":5300,"nudgeX":0.0347,"nudgeY":0.0154,"boxWidth":480,"boxHeight":1080,"aspect":0.444444,"background":"#0B0A0D"}'

[ -f "$ENVF" ] || { echo "run this from ~/tulmi"; exit 1; }
SECRET=$(grep -m1 "^ADMIN_SECRET=" $ENVF | cut -d= -f2- | tr -d '\r' \
          | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//" -e 's/\$\$/$/g')
[ -n "$SECRET" ] || { echo "No ADMIN_SECRET in $ENVF"; exit 1; }

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# put <sha> <ext> <type> <key>: the volume's own copy, re-registered under key.
put() {
  curl -sS -f -o "$TMP/f" "$API/media/$1.$2" || { echo "$4: file not found"; return 1; }
  [ "$(sha256sum "$TMP/f" | cut -d' ' -f1)" = "$1" ] || { echo "$4: checksum mismatch"; return 1; }
  curl -sS -X POST "$API/v1/media/upload?key=$4" -H "x-admin-secret: $SECRET" \
    -F "file=@$TMP/f;type=$3" | grep -q '"ok":true' || { echo "$4: upload refused"; return 1; }
  echo "$4  ok"
}

put "$SPLASH" mp4 video/mp4 intro || exit 1
curl -sS -o /dev/null -X POST "$API/v1/media/present?key=intro&reset=true" -H "x-admin-secret: $SECRET"
curl -sS -X POST "$API/v1/media/present?key=intro" -H "x-admin-secret: $SECRET" \
  -H "content-type: application/json" --data "$PRESENT" | grep -q '"ok":true' || { echo "intro: presentation refused"; exit 1; }
curl -sS -o /dev/null -X DELETE "$API/v1/media/intro.desktop" -H "x-admin-secret: $SECRET"
put "$STILL" webp image/webp onboarding.hero.still || exit 1
