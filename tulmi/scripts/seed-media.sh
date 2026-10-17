#!/usr/bin/env bash
# Publish the rendered media (tulmi/media-seed) into the running server's
# media registry: every onboarding film and You-tab poster, under the key the
# catalog reads, with the presentation the slot wants.
#
#   cd ~/tulmi && ./tulmi/scripts/seed-media.sh            # everything
#   cd ~/tulmi && ./tulmi/scripts/seed-media.sh you.train  # one key
#
# Idempotent: uploading again replaces the file under the same key. The
# manifest is written by the frontend's tools/media/render.mjs; the files are
# what the app and the desktop are served, no build.
set -u
API=${API:-http://127.0.0.1:8770}
ENVF=tulmi/.env
SEED=tulmi/media-seed
[ -f "$ENVF" ] || { echo "run this from ~/tulmi"; exit 1; }
[ -f "$SEED/manifest.json" ] || { echo "no $SEED/manifest.json — render first (frontend: node tools/media/render.mjs)"; exit 1; }

val(){ grep -m1 "^$1=" $ENVF | cut -d= -f2- | tr -d '\r' \
        | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//" -e 's/\$\$/$/g'; }
SECRET=$(val ADMIN_SECRET)
[ -n "$SECRET" ] || { echo "No ADMIN_SECRET in $ENVF"; exit 1; }

ONLY=${1:-}
python3 - "$SEED/manifest.json" "$ONLY" <<'EOF' | while IFS=$'\t' read -r file key ct present; do
import json, sys
for e in json.load(open(sys.argv[1])):
    if sys.argv[2] and e["key"] != sys.argv[2]: continue
    # The opening (the splash film under intro) is set by hand, never seeded.
    if e["key"].startswith(("intro", "mic.animation")): continue
    print("\t".join([e["file"], e["key"], e["contentType"], json.dumps(e.get("present") or {})]))
EOF
  printf '%-28s ' "$key"
  up=$(curl -sS -X POST "$API/v1/media/upload?key=$key" -H "x-admin-secret: $SECRET" \
        -F "file=@$SEED/$file;type=$ct") || { echo "upload failed"; continue; }
  echo "$up" | grep -q '"ok":true' || { echo "refused: $up"; continue; }
  if [ "$present" != "{}" ]; then
    pr=$(curl -sS -X POST "$API/v1/media/present?key=$key" -H "x-admin-secret: $SECRET" \
          -H "content-type: application/json" --data "$present")
    echo "$pr" | grep -q '"ok":true' || { echo "uploaded, presentation refused: $pr"; continue; }
  fi
  echo "ok  $file"
done
