#!/usr/bin/env bash
# Put the app's opening back exactly as it was before the media seed: the
# splash film under `intro`, with the presentation set on 11 Sep.
#
#   cd ~/tulmi && ./tulmi/scripts/restore-opening.sh
#
# The file is still in the media volume, because nothing there is ever
# deleted; it is pinned by its checksum. Safe to run again.
#
# Then the film's first frame, as intro.poster: the server pulls it out of
# the film itself (POST /v1/media/poster). The splash lifts onto that still
# and the film takes over under it on the same frame, so the hand-over from
# the splash cannot blink. The film is not touched.
#
# It also removes the seed's intro.desktop and an old onboarding.hero.still,
# which nothing reads.
set -u
API=${API:-http://127.0.0.1:8770}
ENVF=tulmi/.env
SPLASH=d95d046ea5ea641eef83cc20c323e84c84936f612f199bfe1e8cbfcb730e1f5d
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
curl -sS -o /dev/null -X DELETE "$API/v1/media/onboarding.hero.still" -H "x-admin-secret: $SECRET"
curl -sS -X POST "$API/v1/media/poster?key=intro" -H "x-admin-secret: $SECRET" \
  | grep -q '"ok":true' && echo "intro.poster  ok" || { echo "intro.poster: failed"; exit 1; }
