#!/usr/bin/env bash
# Measure what the DEPLOYED backend actually does — dictation in, finished
# text out. The cases and the checking live in quality.py / quality_cases.py;
# this part finds a token, works out which prompt the container is really
# running, and hands over.
#
#   cd ~/tulmi && ./tulmi/scripts/quality.sh                  # everything
#   cd ~/tulmi && ./tulmi/scripts/quality.sh --quick          # smoke subset
#   cd ~/tulmi && ./tulmi/scripts/quality.sh --only dictation # one group
#   cd ~/tulmi && ./tulmi/scripts/quality.sh --no-audio       # skip the mic path
#   cd ~/tulmi && ./tulmi/scripts/quality.sh --compare tulmi/.quality/run-<ts>.json
#
# Costs real TTS, STT and LLM calls — cents, not dollars. Reads no user data
# and writes none: the token resolves to a synthetic user.
set -u
API=${API:-http://127.0.0.1:8770}
ENVF=tulmi/.env
[ -f "$ENVF" ] || { echo "run this from ~/tulmi"; exit 1; }

val(){ grep -m1 "^$1=" $ENVF | cut -d= -f2- | tr -d '\r' \
        | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//" -e 's/\$\$/$/g'; }
TOKEN=$(val STATIC_BEARER_TOKENS | cut -d, -f1)
[ -n "$TOKEN" ] || {
  cat <<'MSG'
No STATIC_BEARER_TOKENS in tulmi/.env.

This needs one token to call the API as a client would. It resolves to a
synthetic user, so nothing here touches a real account. Add a long random
value (no "$" — Docker Compose eats those), restart, and run again:

    echo "STATIC_BEARER_TOKENS=$(openssl rand -hex 24)" >> tulmi/.env
    docker compose up -d --build backend
MSG
  exit 1; }

dex(){ docker compose exec -T backend "$@" 2>/dev/null | tr -d '\r'; }

# WHICH PROMPT PRODUCED THE SCORE. Ask the container's own node for the
# resolved value — not printenv, which is blank whenever the default is in
# force, and not the checkout, which `git pull` has already changed while the
# image is still whatever it was until a rebuild finishes.
VER=$(dex node -e \
  'import("file:///app/tulmi/dist/tulmi/src/config.js").then(m=>console.log(m.getConfig().CLEANUP_PROMPT_VERSION))')
if [ -z "$VER" ]; then
  echo "Could not read the prompt version from the container. Is it running?" >&2
  echo "  docker compose ps" >&2
  exit 1
fi
# And the file has to be IN the image, or the version is a label on nothing:
# a missing file falls back to an older prompt and the run measures that one.
dex sh -c "test -f /app/shared/prompts/cleanup.$VER.md && echo yes" | grep -q yes || {
  echo "The container resolves cleanup prompt $VER, but" >&2
  echo "/app/shared/prompts/cleanup.$VER.md is not in the image — it was not" >&2
  echo "rebuilt after the pull. Nothing below would measure what you changed:" >&2
  echo "  docker compose up -d --build backend" >&2
  exit 1; }

# THE VERSION ABOVE IS NOT THE PROMPT MOST OF THIS MEASURES.
#
# CLEANUP_PROMPT_VERSION governs shared/prompts/cleanup.*.md, which serves one
# caller: cleanStream, on the in-app streaming mic. /v1/refine,
# /v1/transcribe-clean and /v1/draft all build their prompt in
# pipeline/assistPrompt.ts, which has no version at all — so a header reading
# "cleanup prompt: v6" was reporting a true fact about the wrong file while
# every case below exercised the other one.
#
# A prompt with no version can still have an identity: hash what the container
# actually builds. The fingerprint changes when the prompt changes and does not
# when it does not, which is the entire job of a version.
ASSIST=$(dex node -e '
import("file:///app/tulmi/dist/tulmi/src/pipeline/assistPrompt.js").then(async (m) => {
  const { createHash } = await import("node:crypto");
  const s = m.buildAssistSystem({ hasContext: false });
  console.log(createHash("sha256").update(s).digest("hex").slice(0, 12));
})')

exec python3 tulmi/scripts/quality.py \
  --api "$API" --token "$TOKEN" --version "$VER" --assist "${ASSIST:-unreadable}" "$@"
