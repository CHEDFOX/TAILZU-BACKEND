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

# WHICH PROMPT PRODUCED THE SCORE. /v1/refine, /v1/transcribe-clean and the
# live path build their prompt in pipeline/assistPrompt.ts, which has no
# version — so hash what the container actually builds. The fingerprint
# changes when the prompt changes and does not when it does not, which is the
# entire job of a version. Asked of the container's own node, not the
# checkout, which `git pull` has already changed while the image is still
# whatever it was until a rebuild finishes.
#
# (It used to print CLEANUP_PROMPT_VERSION as well: the version of
# shared/prompts/cleanup.*.md, whose one caller was the in-app streaming mic.
# That path and those files are gone.)
ASSIST=$(dex node -e '
import("file:///app/tulmi/dist/tulmi/src/pipeline/assistPrompt.js").then(async (m) => {
  const { createHash } = await import("node:crypto");
  const s = m.buildAssistSystem({ hasContext: false });
  console.log(createHash("sha256").update(s).digest("hex").slice(0, 12));
})')
if [ -z "$ASSIST" ]; then
  echo "Could not read the writing prompt from the container. Is it running?" >&2
  echo "  docker compose ps" >&2
  exit 1
fi

# THE PROMPT IS NOT THE ONLY THING THAT DECIDES THE OUTPUT.
#
# The assist fingerprint covers assistPrompt.ts and nothing else, so a release
# that changed the script derivation, the refusal filter and the prompt-leak
# guard — all of which live in cleanup.ts and all of which change what comes
# back — left it identical. Identical looked like "nothing deployed", which
# was wrong, and the opposite mistake is the expensive one.
#
# So hash the compiled writing path as well. Between them: a prompt edit moves
# the first, any other change to how text is produced moves the second.
PIPE=$(dex node -e '
Promise.all([import("node:crypto"), import("node:fs")]).then(([c, fs]) => {
  const h = c.createHash("sha256");
  for (const f of ["/app/tulmi/dist/tulmi/src/pipeline/cleanup.js",
                   "/app/tulmi/dist/tulmi/src/pipeline/assistPrompt.js"]) h.update(fs.readFileSync(f));
  console.log(h.digest("hex").slice(0, 12));
})')

exec python3 tulmi/scripts/quality.py \
  --api "$API" --token "$TOKEN" \
  --assist "$ASSIST" --pipeline "${PIPE:-unreadable}" "$@"
