#!/usr/bin/env bash
#
# Puts Xode's jobs on Cloudflare (docs/cloudflare-jobs.md), from the server's own env file, so no key is ever typed or printed.
#
#   ssh root@91.108.104.168 'cd ~/tulmi && git pull --ff-only && ./deploy/cloudflare.sh'              deploy the Worker and check it
#   ssh root@91.108.104.168 'cd ~/tulmi && SWITCH=1 ./deploy/cloudflare.sh'                             ...and move the server's jobs to it
#   ssh root@91.108.104.168 'cd ~/tulmi && BACK=1 ./deploy/cloudflare.sh'                               move the jobs back to the server
#
# What it does, in order (safe to run again; each step says PASS or FAIL):
#   1. reads tulmi/.env: CLOUDFLARE_DEPLOY_TOKEN (an API token from the "Edit Cloudflare Workers" template) and CLOUDFLARE_ACCOUNT_ID
#   2. makes CODE_JOBS_SECRET if the env file has none (the Worker and the server sign every call with it)
#   3. installs Node 22 if the server has none (the deploy tool needs it; the app itself runs in Docker as before)
#   4. makes the R2 bucket for screenshots (x0-job-shots), if it isn't there
#   5. deploys the Worker with the server's own settings (GitHub App, the server's address, the Worker's own address), and builds the cloud
#      runner's container image with Docker
#   6. hands the Worker its secrets from the env file through a temporary file only root can read, deleted at once
#   7. checks the Worker answers
#   SWITCH=1 also writes CODE_JOBS_MODE=cloudflare and CODE_JOBS_URL to the env file and rebuilds the server; BACK=1 writes CODE_JOBS_MODE=local.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
ENV_FILE="${ENV_FILE:-tulmi/.env}"
WORKER="tailzu-jobs"
BUCKET="x0-job-shots"
pass=0; fail=0
ok()   { printf '  \033[32mPASS\033[0m  %s\n' "$1"; pass=$((pass+1)); }
bad()  { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; fail=$((fail+1)); }
step() { printf '\n\033[1m%s\033[0m\n' "$1"; }
stop() { printf '\n\033[31m%s\033[0m\n' "$1"; exit 1; }
get()  { sed -n "s/^$1=//p" "$ENV_FILE" 2>/dev/null | tail -n1 | tr -d '"\r'; }
# Sets KEY=value in the env file: the line replaced if it is there, else added. The value is never printed.
put()  { if grep -q "^$1=" "$ENV_FILE"; then sed -i "s|^$1=.*|$1=$2|" "$ENV_FILE"; else printf '%s=%s\n' "$1" "$2" >> "$ENV_FILE"; fi; }
rebuild() { docker compose up -d --build backend >/dev/null && ok "the server was rebuilt" || bad "the server did not rebuild"; }

[ -f "$ENV_FILE" ] || stop "No $ENV_FILE here. Run this from the repo on the server."

if [ "${BACK:-}" = "1" ]; then
  step "Moving Xode's jobs back to the server"
  put CODE_JOBS_MODE local
  ok "CODE_JOBS_MODE=local"
  rebuild
  exit 0
fi

step "1. The Cloudflare account"
export CLOUDFLARE_API_TOKEN="$(get CLOUDFLARE_DEPLOY_TOKEN)"
export CLOUDFLARE_ACCOUNT_ID="$(get CLOUDFLARE_ACCOUNT_ID)"
[ -n "$CLOUDFLARE_API_TOKEN" ] || stop "Add CLOUDFLARE_DEPLOY_TOKEN to $ENV_FILE (Cloudflare > My Profile > API Tokens > Create Token > \"Edit Cloudflare Workers\")."
[ -n "$CLOUDFLARE_ACCOUNT_ID" ] || stop "Add CLOUDFLARE_ACCOUNT_ID to $ENV_FILE (Cloudflare > Workers & Pages: the Account ID on the right)."
ok "deploy token and account id are in the env file"

step "2. The shared secret"
if [ -z "$(get CODE_JOBS_SECRET)" ]; then put CODE_JOBS_SECRET "$(openssl rand -hex 32)"; ok "made CODE_JOBS_SECRET (kept in the env file)"; else ok "CODE_JOBS_SECRET is set"; fi

step "3. Node"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" -lt 20 ]; then
  echo "  installing Node 22 (for the deploy tool only)"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null 2>&1 && apt-get install -y nodejs >/dev/null 2>&1 || stop "Node could not be installed."
fi
ok "node $(node -v)"
command -v docker >/dev/null && docker info >/dev/null 2>&1 && ok "docker is running (it builds the cloud runner)" || stop "Docker is needed to build the cloud runner's image."

cd jobs || exit 1
npm ci --silent >/dev/null 2>&1 && ok "the Worker's packages are installed" || stop "npm ci failed in jobs/."
W() { npx --no-install wrangler "$@"; }

# The Worker's own address: <name>.<the account's workers.dev subdomain>.workers.dev
SUB=$(curl -fsS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/subdomain" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).result.subdomain||"")}catch{}})')
[ -n "$SUB" ] || stop "The account has no workers.dev subdomain yet: open Cloudflare > Workers & Pages once (it asks you to pick one), then run this again."
JOBS_URL="https://$WORKER.$SUB.workers.dev"
ok "the Worker will be at $JOBS_URL"

step "4. The screenshot bucket"
made=$(W r2 bucket create "$BUCKET" 2>&1); code=$?
if [ "$code" = "0" ]; then ok "made $BUCKET"
elif printf '%s' "$made" | grep -qi "already exist"; then ok "$BUCKET is there"
else bad "could not make $BUCKET (the token needs Workers R2 Storage: Edit)"; fi

step "5. Deploying the Worker and the cloud runner"
cd .. || exit 1
VARS=()
for k in GITHUB_APP_SLUG GITHUB_APP_CLIENT_ID GITHUB_APP_ID CLOUDFLARE_ACCOUNT_ID PUBLIC_ORIGIN; do
  v="$(get "$k")"; [ -n "$v" ] && VARS+=(--var "$k:$v")
done
VARS+=(--var "CODE_JOBS_URL:$JOBS_URL")
cd jobs || exit 1
if W deploy "${VARS[@]}" > /tmp/x0-deploy.log 2>&1; then ok "deployed"
else
  tail -n 15 /tmp/x0-deploy.log | grep -v -i "token\|secret"
  stop "The deploy was refused (above). If it names containers or permissions, add that permission to the deploy token and run this again."
fi

step "6. The Worker's secrets"
TMP=$(mktemp); chmod 600 "$TMP"
ENV_FILE_ABS="$(cd .. && pwd)/$ENV_FILE" node -e '
const fs = require("fs");
const env = {};
for (const line of fs.readFileSync(process.env.ENV_FILE_ABS, "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
  if (m) env[m[1]] = m[2].replace(/^"|"$/g, "");
}
const want = ["CODE_JOBS_SECRET", "SUPABASE_URL", "SUPABASE_SERVICE_KEY", "OPENROUTER_API_KEY", "GITHUB_APP_CLIENT_SECRET", "GITHUB_APP_PRIVATE_KEY",
  "CONNECTOR_TOKEN_KEY", "CLOUDFLARE_API_TOKEN", "ARTIFACT_SHOT_SECRET", "GITHUB_OAUTH_CLIENT_ID", "GITHUB_OAUTH_CLIENT_SECRET"];
const out = {}; const missing = [];
for (const k of want) { if (env[k]) out[k] = env[k]; else missing.push(k); }
fs.writeFileSync(process.argv[1], JSON.stringify(out));
console.log("  handing over: " + Object.keys(out).join(", "));
if (missing.length) console.log("  not in the env file (fine if you do not use them): " + missing.join(", "));
' "$TMP"
if W secret bulk "$TMP" >/dev/null 2>&1; then ok "secrets set"; else bad "the secrets could not be set"; fi
rm -f "$TMP"
cd .. || exit 1
[ -n "$(get CLOUDFLARE_API_TOKEN)" ] && ok "screenshots can use CLOUDFLARE_API_TOKEN (Browser Rendering)" || bad "no CLOUDFLARE_API_TOKEN in the env file: real screens need one with Browser Rendering: Edit"

step "7. Checking the Worker"
for i in $(seq 1 20); do
  code=$(curl -sS -o /dev/null -w '%{http_code}' "$JOBS_URL/v1/health" 2>/dev/null); [ "$code" = "200" ] && break; sleep 3
done
[ "${code:-}" = "200" ] && ok "$JOBS_URL/v1/health answers" || bad "the Worker does not answer yet ($code)"

if [ "${SWITCH:-}" = "1" ]; then
  step "Moving Xode's jobs to Cloudflare"
  put CODE_JOBS_MODE cloudflare
  put CODE_JOBS_URL "$JOBS_URL"
  ok "CODE_JOBS_MODE=cloudflare, CODE_JOBS_URL=$JOBS_URL"
  rebuild
else
  printf '\n  The server still runs the jobs. When this says all PASS, move them:  SWITCH=1 ./deploy/cloudflare.sh   (and back: BACK=1)\n'
fi

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" = "0" ]
