#!/usr/bin/env bash
#
# Sets plain settings in the server's env file: each KEY=value replaces that key's line, or is added when it is not there.
# Prints the keys it set, never a value. For secrets (keys, tokens) edit the file by hand instead, so they never sit in the
# shell's history:   nano ~/tulmi/tulmi/.env
#
#   ssh root@91.108.104.168 'cd ~/tulmi && ./deploy/set-env.sh PLACES_GEOCODER=photon PLACES_ROUTER=osrm && ./deploy/ship.sh'
#   ssh root@91.108.104.168 'cd ~/tulmi && ./deploy/set-env.sh --show PLACES_GEOCODER PLACES_ROUTER WEB_SEARXNG_URL BRAVE_SEARCH_KEY'
#
# --show prints, for each key, its value when it is a plain setting, and only "set" or "not set" for a secret.
set -euo pipefail
cd "$(dirname "$0")/.." || exit 1
ENV_FILE="${ENV_FILE:-tulmi/.env}"
[ -f "$ENV_FILE" ] || { echo "No $ENV_FILE here. Run this from the repo on the server."; exit 1; }

secretish() { [[ "$1" =~ (KEY|TOKEN|SECRET|PASSWORD|PASSPHRASE|PRIVATE|SERVICE_ACCOUNT|CREDENTIAL) ]]; }

if [ "${1:-}" = "--show" ]; then
  shift
  for k in "$@"; do
    v=$(sed -n "s/^$k=//p" "$ENV_FILE" | tail -n1 | tr -d '"\r')
    if [ -z "$v" ]; then echo "$k: not set"
    elif secretish "$k"; then echo "$k: set"
    else echo "$k: $v"; fi
  done
  exit 0
fi

[ "$#" -gt 0 ] || { echo "Give KEY=value pairs, or --show KEY..."; exit 1; }
for pair in "$@"; do
  k="${pair%%=*}"; v="${pair#*=}"
  [[ "$k" =~ ^[A-Z][A-Z0-9_]*$ ]] && [ "$k" != "$pair" ] || { echo "Not KEY=value: $k"; exit 1; }
  if secretish "$k"; then echo "$k looks like a secret: put it in $ENV_FILE by hand (nano), not on the command line."; exit 1; fi
  if grep -q "^$k=" "$ENV_FILE"; then
    tmp=$(mktemp); awk -v k="$k" -v v="$v" 'BEGIN{FS=OFS="="} $1==k {print k "=" v; next} {print}' "$ENV_FILE" > "$tmp" && cat "$tmp" > "$ENV_FILE" && rm -f "$tmp"
  else
    printf '%s=%s\n' "$k" "$v" >> "$ENV_FILE"
  fi
  echo "set $k"
done
echo "Now rebuild so the server reads them: ./deploy/ship.sh"
