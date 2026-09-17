#!/usr/bin/env bash
# Measure what the DEPLOYED backend actually writes.
#
#   cd ~/tulmi && ./tulmi/scripts/quality.sh
#
# WHY NOT `npm run eval`. That one calls assist() in-process and is the right
# tool while editing a prompt — but the production image is built --omit=dev,
# so it has no tsx and cannot run there. This asks the running server over HTTP
# instead, which is also the truer question: it measures the prompt version,
# the model, the language rules and the config that are ACTUALLY serving users,
# not the ones in a checkout.
#
# Costs real LLM calls — a few cents. Reads no user data and writes none.
set -u
API=http://127.0.0.1:8770
ENVF=tulmi/.env
pass=0; fail=0
[ -f "$ENVF" ] || { echo "run this from ~/tulmi"; exit 1; }

val(){ grep -m1 "^$1=" $ENVF | cut -d= -f2- | tr -d '\r' \
        | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//" -e 's/\$\$/$/g'; }
TOKEN=$(val STATIC_BEARER_TOKENS | cut -d, -f1)
[ -n "$TOKEN" ] || {
  cat <<'MSG'
No STATIC_BEARER_TOKENS in tulmi/.env.

This needs one token to call /v1/refine as a client would. It resolves to a
synthetic user, so nothing here touches a real account. Add a long random
value (no "$" — Docker Compose eats those), restart, and run again:

    echo "STATIC_BEARER_TOKENS=$(openssl rand -hex 24)" >> tulmi/.env
    docker compose up -d --build backend
MSG
  exit 1; }

# One case per line: id | language | input | rule | argument
#   noadd:<ratio>   output may not exceed the input by more than this many times
#   nowords:a,b,c   none of these may appear (case-insensitive)
#   script:latin|devanagari
CASES=$(cat <<'EOF'
add/terse-stays-terse|auto|reaching in ten|noadd:1.8|
add/no-greeting|auto|send me the file when you get a chance|nowords:hello,dear,hope this|
add/no-signoff|auto|the meeting moved to four|nowords:regards,sincerely,cheers|
add/question-is-sent|auto|kya tum kal office aa rahe ho|noadd:1.8|
lang/hinglish-stays|auto|yaar kal ka plan cancel ho gaya hai, ab agle hafte milte hain|script:latin|
lang/hinglish-not-english|auto|yaar kal ka plan cancel ho gaya hai, ab agle hafte milte hain|nowords:the plan,next week,got cancelled|
lang/devanagari-stays|auto|मैं थोड़ा लेट पहुँचूँगा, मीटिंग शुरू कर देना|script:devanagari|
lang/setting-is-a-bias|en|kal subah nikalna hai, alarm laga dena|nowords:tomorrow morning,set an alarm,we have to leave|
lang/mixed-stays-mixed|auto|the deploy is done but abhi testing baaki hai|nowords:testing is still pending,remains to be tested|
facts/number-survives|auto|call me on 98200 41122 tomorrow|nowords:xxx|
EOF
)

# WHICH PROMPT PRODUCED THE SCORE. A run that reports "9 passed, 1 failed"
# without naming the version answers a question nobody can repeat later. Read
# it from the RUNNING CONTAINER, never from the file: a value can differ
# between the two, which is how a "$" in the webhook secret once made the
# process hold a different string than tulmi/.env did.
VER=$(docker compose exec -T backend printenv CLEANUP_PROMPT_VERSION 2>/dev/null | tr -d '\r')
if [ -n "$VER" ]; then VER="$VER (pinned in the env)"
else
  # Unset in the container means the schema's default decides. Name it rather
  # than printing "default" — the point of the line is to be repeatable.
  D=$(grep -m1 'CLEANUP_PROMPT_VERSION: z.string().default' tulmi/src/config.ts \
      | sed -n 's/.*default("\([^"]*\)").*/\1/p')
  VER="${D:-unknown} (the checkout's default)"
fi
echo "Asking the deployed backend to write. Each line is one real call."
echo "cleanup prompt: $VER"
echo

while IFS='|' read -r id lang input rule _; do
  [ -n "$id" ] || continue
  body=$(python3 -c '
import json,sys
print(json.dumps({"text": sys.argv[1], "targetApp": "Generic", "language": sys.argv[2]}))' "$input" "$lang")
  out=$(curl -s -X POST "$API/v1/refine" -H "Authorization: Bearer $TOKEN" \
        -H 'Content-Type: application/json' -d "$body" \
        | python3 -c 'import json,sys
try: print(json.load(sys.stdin).get("refinedText",""))
except Exception: print("")')

  why=$(python3 -c '
import re,sys,unicodedata
out, src, rule = sys.argv[1], sys.argv[2], sys.argv[3]
if not out.strip(): print("empty output"); raise SystemExit
kind, _, arg = rule.partition(":")
if kind == "noadd":
    w = lambda t: len(re.findall(r"\S+", t))
    a, b = w(src), w(out)
    if a and b > a * float(arg): print(f"grew {a} -> {b} words ({b/a:.2f}x)")
elif kind == "nowords":
    hit = [s for s in arg.split(",") if s and s.lower() in out.lower()]
    if hit: print("translated/added: " + ", ".join(hit))
elif kind == "script":
    def sc(t):
        for ch in t:
            if "DEVANAGARI" in unicodedata.name(ch, ""): return "devanagari"
        return "latin" if re.search(r"[A-Za-z]", t) else "unknown"
    got = sc(out)
    if got != arg: print(f"script was {got}, expected {arg}")
' "$out" "$input" "$rule")

  if [ -z "$why" ]; then
    printf '  PASS  %s\n' "$id"; pass=$((pass+1))
  else
    printf '  FAIL  %s\n        %s\n        -> %s\n' "$id" "$why" "$out"; fail=$((fail+1))
  fi
done <<< "$CASES"

echo
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ] || exit 1
