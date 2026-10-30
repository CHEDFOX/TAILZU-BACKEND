#!/usr/bin/env bash
#
# Turn on the Code bot: write the GitHub App's settings into the env file, then ship.
# The App itself is made on github.com (docs/github-app.md); this asks for what that page gives you.
#
#   cd ~/tulmi && ./deploy/github-app.sh
#
# Nothing it reads is printed. Safe to run again: it replaces the lines it wrote last time.

set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE="${ENV_FILE:-tulmi/.env}"
[ -f "$ENV_FILE" ] || { echo "No $ENV_FILE here. Run this from ~/tulmi." >&2; exit 1; }

get() { sed -n "s/^$1=//p" "$ENV_FILE" | tail -n1; }

read -rp "App ID: " APP_ID
read -rp "App URL name (github.com/apps/<this>) [x0-code]: " SLUG
SLUG="${SLUG:-x0-code}"
read -rp "Client ID: " CLIENT_ID
read -rsp "Client secret (hidden): " CLIENT_SECRET; echo
echo "Paste the whole .pem file (open it in Notepad, copy all), then press Enter:"
PEM=""
while IFS= read -r line; do
  PEM+="$line"$'\n'
  [[ "$line" == *"-----END"* ]] && break
done
[[ "$PEM" == *"PRIVATE KEY-----"* ]] || { echo "That was not a .pem private key. Nothing was changed." >&2; exit 1; }
[[ "$APP_ID" =~ ^[0-9]+$ ]] || { echo "App ID is a number. Nothing was changed." >&2; exit 1; }
[ -n "$CLIENT_ID" ] && [ -n "$CLIENT_SECRET" ] || { echo "Client ID and secret are both needed. Nothing was changed." >&2; exit 1; }

WEBHOOK_SECRET="$(get GITHUB_APP_WEBHOOK_SECRET)"
NEW_WEBHOOK=""
if [ -z "$WEBHOOK_SECRET" ]; then
  WEBHOOK_SECRET="$(openssl rand -hex 32)"
  NEW_WEBHOOK=1
fi
CONNECTOR_KEY="$(get CONNECTOR_TOKEN_KEY)"
[ -n "$CONNECTOR_KEY" ] || CONNECTOR_KEY="$(openssl rand -base64 32)"

cp "$ENV_FILE" "$ENV_FILE.bak"
sed -i '/^\(CODE_GITHUB\|CODE_PROJECT_BRAIN\|CONNECTOR_TOKEN_KEY\|GITHUB_APP_[A-Z_]*\)=/d' "$ENV_FILE"
{
  echo
  echo "CODE_GITHUB=true"
  echo "CODE_PROJECT_BRAIN=true"
  echo "CONNECTOR_TOKEN_KEY=$CONNECTOR_KEY"
  echo "GITHUB_APP_ID=$APP_ID"
  echo "GITHUB_APP_SLUG=$SLUG"
  echo "GITHUB_APP_CLIENT_ID=$CLIENT_ID"
  echo "GITHUB_APP_CLIENT_SECRET=$CLIENT_SECRET"
  echo "GITHUB_APP_PRIVATE_KEY=$(printf '%s' "$PEM" | base64 -w0)"
  echo "GITHUB_APP_WEBHOOK_SECRET=$WEBHOOK_SECRET"
} >> "$ENV_FILE"
echo "Saved to $ENV_FILE (the old one is $ENV_FILE.bak)."

if [ -n "$NEW_WEBHOOK" ]; then
  echo
  echo "One more thing on GitHub: App settings > Webhook > Change secret, paste this, Save changes:"
  echo "$WEBHOOK_SECRET"
  echo
fi

./deploy/ship.sh
