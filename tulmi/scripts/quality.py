#!/usr/bin/env python3
"""
End-to-end quality harness: dictation in, finished text out.

Asks the DEPLOYED backend to do the whole job, over HTTP, as the app does.
Nothing is mocked — real prompt version, real recognisers, real language
rules, real personality handling.

    cd ~/tulmi && ./tulmi/scripts/quality.sh                  # everything
    cd ~/tulmi && ./tulmi/scripts/quality.sh --quick          # smoke subset
    cd ~/tulmi && ./tulmi/scripts/quality.sh --only dictation # one group
    cd ~/tulmi && ./tulmi/scripts/quality.sh --no-audio       # skip the mic path
    cd ~/tulmi && ./tulmi/scripts/quality.sh --compare .quality/run-<ts>.json

THREE PATHS, WHICH IS THE POINT.

  dictate   POST /v1/speak to synthesise the sentence, then POST the audio to
            /v1/transcribe-clean exactly as the app's mic does. The response
            carries BOTH stages, so a failure says which one broke: what the
            recogniser HEARD and what the writer WROTE. A refinement fault and
            a recognition fault look identical from the outside and need
            completely different fixes.
  refine    POST /v1/refine — the keyboard's path, text in.
  draft     POST /v1/draft — the reply/share-sheet path.

WHAT THE AUDIO PATH DOES NOT PROVE. Synthesised speech is clean: no accent,
no room, no crosstalk, no real hesitation. It exercises the pipeline, the
language and script decisions, and the recogniser's handling of Indic and
non-Indic input. It does not stand in for a noisy kitchen. Cases ask TTS for
a hurried, natural delivery, which narrows the gap without closing it.

WHY NOT `npm run eval`. That calls assist() in process and is right while
editing a prompt — but the production image is built --omit=dev, has no tsx,
and cannot run where the thing being questioned actually runs.

A case asserts a PROPERTY, never an exact sentence. The model may write it a
dozen good ways; a harness that pins wording fails on every improvement.

Stdlib only. The server is the only dependency.
"""
import argparse
import json
import os
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.request
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from quality_cases import CASES  # noqa: E402

# Phrasings that are the assistant talking rather than the user sending.
# Deliberately tight — a loose list flags real messages. Applied everywhere
# unless a case opts out, because leaking one of these into someone's chat is
# the most visible way this can fail.
META = [
    "here's the refined", "here is the refined", "here's your refined",
    "here is your refined", "i've refined", "i have refined",
    "as an ai", "as an assistant", "as a language model",
    "let me know if you'd like", "let me know if you need any changes",
    "sure, here", "certainly! here", "i'm sorry, but i",
    "system prompt", "you are the writing assistant",
]

SCRIPT_BLOCKS = [
    "DEVANAGARI", "TAMIL", "BENGALI", "GURMUKHI", "TELUGU", "KANNADA",
    "MALAYALAM", "GUJARATI", "ORIYA", "ARABIC", "CYRILLIC", "HIRAGANA",
    "KATAKANA", "CJK", "HANGUL", "HEBREW", "THAI",
]


def scripts_in(text):
    found = {}
    for ch in text:
        if not ch.isalpha():
            continue
        if ch.isascii():
            found["latin"] = found.get("latin", 0) + 1
            continue
        name = unicodedata.name(ch, "")
        for block in SCRIPT_BLOCKS:
            if block in name:
                found[block.lower()] = found.get(block.lower(), 0) + 1
                break
        else:
            if "LATIN" in name:
                found["latin"] = found.get("latin", 0) + 1
    return found


def dominant_script(text):
    """The script most of the letters are in.

    Counting matters: 'the first non-ASCII letter wins' calls a whole English
    sentence Devanagari because one word survived, which is the opposite of
    what a script check is for.
    """
    found = scripts_in(text)
    return max(found.items(), key=lambda kv: kv[1])[0] if found else "none"


def words(text):
    return re.findall(r"\S+", text)


def digits(text):
    return re.sub(r"\D", "", text)


def norm_words(text):
    """Lowercased, punctuation-free words — for comparing what was said to
    what was heard without scoring a comma as a mistake."""
    out = []
    for w in text.split():
        w = "".join(c for c in w if not unicodedata.category(c).startswith("P"))
        if w:
            out.append(w.lower())
    return out


def wer(said, heard):
    """Word error rate: edits to turn what was heard into what was said,
    over the number of words said. 0.0 is perfect, 1.0 is every word wrong.

    The one number that says how good recognition was, independently of
    whether the writer then did its job.
    """
    a, b = norm_words(said), norm_words(heard)
    if not a:
        return 0.0
    prev = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        cur = [i]
        for j, y in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x != y)))
        prev = cur
    return prev[len(b)] / len(a)


def wer_if_comparable(said, heard):
    """(rate, note). rate is None when the two are in different scripts.

    WORD ERROR RATE ONLY MEANS ANYTHING WITHIN ONE SCRIPT. Speaking romanised
    Hindi and getting Devanagari back scores 1.00 — every word "wrong" — when
    the recognition was in fact perfect. Comparing across scripts would need
    transliteration to compare at all, so the honest move is to decline to
    score it and say why, rather than publish a number that means nothing.
    """
    a, b = dominant_script(said), dominant_script(heard)
    if a == b or "none" in (a, b):
        return wer(said, heard), ""
    return None, "heard in %s, said in %s — a fair reading, not an error" % (b, a)


def check(case, out, stage="out"):
    """Every way this output fails its case. Empty list means it passed.

    `stage` picks the prefix for the case's keys, so the same checks can be
    aimed at the transcript ("transcript_script") and at the finished text
    ("script") without writing them twice.
    """
    p = "" if stage == "out" else stage + "_"
    get = lambda k, d=None: case.get(p + k, d)  # noqa: E731
    bad = []
    low = out.lower()

    if stage == "out" and case.get("expect_empty"):
        if out.strip():
            bad.append("should have returned nothing, returned %r" % out[:60])
        return bad
    if not out.strip():
        return ["empty %s" % stage]

    if stage == "out" and not case.get("allow_meta"):
        for phrase in META:
            if phrase in low:
                bad.append("assistant voice leaked: %r" % phrase)

    grow = get("max_growth")
    if grow:
        src = case.get("text") or case.get("say") or ""
        a, b = len(words(src)), len(words(out))
        if a and b > a * grow:
            bad.append("grew %d -> %d words (%.2fx, limit %.2fx)" % (a, b, b / a, grow))

    if get("min_words") and len(words(out)) < get("min_words"):
        bad.append("shrank to %d words, expected at least %d"
                   % (len(words(out)), get("min_words")))
    if get("max_words") and len(words(out)) > get("max_words"):
        bad.append("ran to %d words, expected at most %d"
                   % (len(words(out)), get("max_words")))

    for s in get("forbid", []):
        if s.lower() in low:
            bad.append("contains %r" % s)
    for s in get("require", []):
        if s.lower() not in low:
            bad.append("lost %r" % s)
    for s in get("require_exact", []):
        if s not in out:
            bad.append("lost the exact spelling %r" % s)
    for group in get("require_any", []):
        if not any(s.lower() in low for s in group):
            bad.append("none of %s survived" % (group,))

    if get("keep_digits"):
        want = digits(get("keep_digits"))
        if want and want not in digits(out):
            bad.append("digits changed: %r is not in %r" % (want, digits(out)))
    if get("forbid_digits") and re.search(r"\d", out):
        bad.append("invented a number: %r" % re.findall(r"\d+", out))

    if get("script"):
        got = dominant_script(out)
        if got != get("script"):
            bad.append("%s script is %s, expected %s" % (stage, got, get("script")))
    for s in get("has_scripts", []):
        if s not in scripts_in(out):
            bad.append("no %s left in the %s" % (s, stage))

    if get("forbid_regex") and re.search(get("forbid_regex"), out, re.I):
        bad.append("matched %s" % get("forbid_regex"))
    if get("require_regex") and not re.search(get("require_regex"), out, re.I):
        bad.append("did not match %s" % get("require_regex"))
    return bad


# --- talking to the server --------------------------------------------------

class Exhausted(Exception):
    """The account ran out of quota. Not a quality result — a stopped run.

    A 79-case pass at --repeat 3 spent the synthetic user's monthly words
    around a third of the way in. Every remaining case then "failed" with a
    429, the report read 16 passed / 63 failed, and --compare printed 57
    REGRESSED against a healthy baseline. None of it was true, and it was
    saved to disk where it would have been compared against again.

    So this stops the run where it happens. A harness that cannot get an
    answer must say so, not score the silence.
    """


def _send(req, timeout, binary=False):
    """One request with backoff. A harness reports failures, never raises."""
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return (r.read() if binary else json.load(r)), None
        except urllib.error.HTTPError as e:
            body = e.read()[:160].decode("utf8", "replace")
            # A 429 is two different things. Rate limiting passes with time,
            # so it is retried; a spent monthly allowance does not, so
            # retrying it three times just spends three more seconds.
            if e.code == 429 and "quota_exceeded" in body:
                raise Exhausted(body) from None
            if e.code in (429, 500, 502, 503, 504) and attempt < 3:
                time.sleep(2 ** attempt)
                continue
            return None, "HTTP %s %s" % (e.code, body)
        except Exception as e:  # noqa: BLE001
            if attempt < 3:
                time.sleep(2 ** attempt)
                continue
            return None, str(e)
    return None, "gave up after 4 attempts"


def post_json(api, token, path, body, timeout=90, binary=False):
    return _send(urllib.request.Request(
        api + path, data=json.dumps(body).encode(),
        headers={"Authorization": "Bearer " + token,
                 "Content-Type": "application/json"},
        method="POST"), timeout, binary)


def post_multipart(api, token, path, fields, filename, blob, timeout=180):
    """Hand-rolled multipart — the app uploads a file, so the harness does too,
    rather than testing a JSON door the mic never knocks on."""
    boundary = "----tailzu" + uuid.uuid4().hex
    parts = []
    for k, v in fields.items():
        parts.append(
            ('--%s\r\nContent-Disposition: form-data; name="%s"\r\n\r\n%s\r\n'
             % (boundary, k, v)).encode())
    parts.append(
        ('--%s\r\nContent-Disposition: form-data; name="audio"; filename="%s"\r\n'
         'Content-Type: application/octet-stream\r\n\r\n' % (boundary, filename)).encode())
    parts.append(blob)
    parts.append(("\r\n--%s--\r\n" % boundary).encode())
    return _send(urllib.request.Request(
        api + path, data=b"".join(parts),
        headers={"Authorization": "Bearer " + token,
                 "Content-Type": "multipart/form-data; boundary=" + boundary},
        method="POST"), timeout)


def run_case(api, token, case, audio_format="wav"):
    """Returns (transcript, output, error). transcript is '' off the mic path."""
    kind = case.get("endpoint", "refine")

    if kind == "draft":
        body = {"screenContent": case["screenContent"], "intent": case["intent"],
                "targetApp": case.get("targetApp", "Generic"),
                "language": case.get("language", "auto")}
        if case.get("recipient"):
            body["recipient"] = case["recipient"]
        for k in ("tone", "tonePrompt", "personality"):
            if k in case:
                body[k] = case[k]
        res, err = post_json(api, token, "/v1/draft", body)
        return "", (res or {}).get("draftText", ""), err

    if kind == "dictate":
        # Say it out loud first. The steer asks for ordinary speech rather
        # than a newsreader, which is the closest a synthesiser gets to a
        # person holding a phone.
        speak = {"text": case["say"], "format": audio_format,
                 "instructions": case.get("speak_as",
                                          "natural conversational pace, as if speaking to a friend")}
        blob, err = post_json(api, token, "/v1/speak", speak, timeout=120, binary=True)
        if err:
            return "", "", "TTS: " + err
        if not blob:
            return "", "", "TTS returned no audio"

        fields = {"targetApp": case.get("targetApp", "Generic"),
                  "language": case.get("language", "auto")}
        for k in ("tone", "tonePrompt", "context"):
            if k in case:
                fields[k] = case[k]
        if "personality" in case:
            fields["personality"] = json.dumps(case["personality"])
        res, err = post_multipart(api, token, "/v1/transcribe-clean", fields,
                                  "clip." + audio_format, blob)
        if err:
            return "", "", "STT: " + err
        return (res or {}).get("transcript", ""), (res or {}).get("cleanedText", ""), None

    body = {"text": case["text"], "targetApp": case.get("targetApp", "Generic"),
            "language": case.get("language", "auto")}
    for k in ("tone", "tonePrompt", "context", "personality", "alternative"):
        if k in case:
            body[k] = case[k]
    res, err = post_json(api, token, "/v1/refine", body)
    return "", (res or {}).get("refinedText", ""), err


def synthetic_user_id(token):
    """The id a STATIC_BEARER_TOKENS value resolves to, server-side.

    Mirrors matchStaticToken in src/auth/supabase.ts: "static-" plus the first
    12 hex of the token's SHA-256. Computed here so the harness can name the
    id in the one message where it is needed, instead of sending someone to
    read the source while a run sits broken.
    """
    import hashlib
    return "static-" + hashlib.sha256(token.encode()).hexdigest()[:12]


# --- reporting --------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--api", default=os.environ.get("API", "http://127.0.0.1:8770"))
    ap.add_argument("--token", default=os.environ.get("TOKEN", ""))
    ap.add_argument("--version", default=os.environ.get("PROMPT_VERSION", "unknown"),
                    help="CLEANUP_PROMPT_VERSION — the STREAMING path only")
    ap.add_argument("--assist", default="unknown",
                    help="fingerprint of the assist prompt, which serves everything else")
    ap.add_argument("--pipeline", default="unknown",
                    help="fingerprint of the compiled writing path (cleanup + assistPrompt)")
    ap.add_argument("--repeat", type=int, default=1,
                    help="run each case N times; a case passes only if every run passes")
    ap.add_argument("--only", default="", help="one group, e.g. lang")
    ap.add_argument("--quick", action="store_true", help="the smoke subset")
    ap.add_argument("--no-audio", action="store_true", help="skip the mic path")
    ap.add_argument("--audio-format", default="wav")
    ap.add_argument("--jobs", type=int, default=5)
    ap.add_argument("--compare", default="", help="a previous run's JSON")
    ap.add_argument("--out", default="")
    args = ap.parse_args()

    if not args.token:
        print("no token — run this through scripts/quality.sh", file=sys.stderr)
        return 2

    cases = CASES
    if args.quick:
        cases = [c for c in cases if c.get("smoke")]
    if args.only:
        cases = [c for c in cases if c["id"].split("/", 1)[0].startswith(args.only)]
    if args.no_audio:
        cases = [c for c in cases if c.get("endpoint") != "dictate"]
    if not cases:
        print("no cases matched", file=sys.stderr)
        return 2

    spoken = sum(1 for c in cases if c.get("endpoint") == "dictate")
    print("Asking the deployed backend to do the whole job. Every line is real work.")
    # The assist fingerprint comes first because it is the prompt nearly every
    # case exercises. The cleanup version is labelled with the one path it
    # governs, so nobody again reads a green run as a verdict on the file they
    # just edited.
    print("assist prompt:  %s   (refine, transcribe-clean, draft)" % args.assist)
    print("writing path:   %s   (everything else that shapes the output)" % args.pipeline)
    print("cleanup prompt: %s   (the streaming mic only)" % args.version)
    print("cases: %d   spoken aloud: %d%s"
          % (len(cases), spoken,
             "   x%d runs each" % args.repeat if args.repeat > 1 else ""))
    print()

    started = time.time()
    results = [None] * len(cases)

    def attempt(case):
        transcript, out, err = run_case(args.api, args.token, case, args.audio_format)
        failures = [err] if err else check(case, out)
        heard_wer = None
        script_note = ""
        if not err and case.get("endpoint") == "dictate":
            failures += check(case, transcript, stage="transcript")
            heard_wer, script_note = wer_if_comparable(case["say"], transcript)
            limit = case.get("max_wer")
            if heard_wer is not None and limit is not None and heard_wer > limit:
                failures.append("recognition drifted: WER %.2f (limit %.2f)"
                                % (heard_wer, limit))
            # SPEECH HAS NO SCRIPT. Someone who SAYS a Hindi sentence has not
            # chosen Devanagari or romanised — the recogniser did. So the mic
            # path cannot assert a fixed script the way the keyboard path
            # does; what it can assert is that the writer did not change the
            # one it was handed, which is the actual fault.
            if case.get("keep_transcript_script") and transcript.strip():
                a, b = dominant_script(transcript), dominant_script(out)
                if a != "none" and b != a:
                    failures.append("writer flipped the script: heard %s, wrote %s" % (a, b))
        return {"transcript": transcript, "output": out, "error": err,
                "wer": heard_wer, "scriptNote": script_note, "failures": failures}

    def run(i):
        """One case, --repeat times.

        A MODEL IS NOT A FUNCTION. Two runs of the same case can disagree, so a
        single sample cannot tell a regression from the weather — and four
        cases 'regressed' between two runs of the same prompt. Repeating turns
        that into something readable: a case passes only if every run passes,
        and a case that fails 1 of 3 is reported as flaky rather than as a
        verdict on the change.
        """
        case = cases[i]
        t0 = time.time()
        tries = [attempt(case) for _ in range(max(1, args.repeat))]
        bad = [t for t in tries if t["failures"]]
        # Report the failing run when there is one: an output that passed says
        # nothing about why the other did not.
        shown = bad[0] if bad else tries[0]
        results[i] = {
            "id": case["id"], "why": case.get("why", ""),
            "said": case.get("say", ""),
            "input": case.get("text") or case.get("say") or case.get("intent", ""),
            "runs": len(tries), "failedRuns": len(bad),
            "ms": int((time.time() - t0) * 1000),
            **shown,
        }

    try:
        with ThreadPoolExecutor(max_workers=args.jobs) as pool:
            list(pool.map(run, range(len(cases))))
    except Exhausted as e:
        done = sum(1 for r in results if r)
        print()
        print("STOPPED after %d of %d cases — the account is out of words." % (done, len(cases)))
        print("  %s" % str(e)[:200])
        print()
        print("Nothing was saved. A partial run is not a quality result, and the")
        print("last one like this reported 57 REGRESSED against a healthy baseline.")
        print()
        print("The token authenticates as a synthetic user that cannot hold an")
        print("entitlement (its id is not a UUID), so the cap is lifted by id:")
        print()
        print("    QUOTA_EXEMPT_USER_IDS=%s" % synthetic_user_id(args.token))
        print()
        print("Add that to tulmi/.env, rebuild, and run again. It is a billing")
        print("bypass for exactly one operator id — never put a real account in it.")
        return 2

    groups = []
    for r in results:
        g = r["id"].split("/", 1)[0]
        if g not in groups:
            groups.append(g)

    for g in groups:
        rows = [r for r in results if r["id"].startswith(g + "/")]
        ok = [r for r in rows if not r["failures"]]
        print("%-11s %d/%d" % (g, len(ok), len(rows)))
        for r in rows:
            if not r["failures"]:
                continue
            flaky = r.get("runs", 1) > 1 and 0 < r["failedRuns"] < r["runs"]
            print("   %s  %s%s" % (
                "FLAKY" if flaky else "FAIL ", r["id"],
                "   (failed %d of %d runs)" % (r["failedRuns"], r["runs"])
                if r.get("runs", 1) > 1 else ""))
            if r["why"]:
                print("         %s" % r["why"])
            for f in r["failures"]:
                print("         %s" % f)
            # Three lines for a spoken case, so the stage that broke is named
            # rather than guessed at.
            if r["said"]:
                print("         said   %s" % r["said"])
                if r["wer"] is not None:
                    tag = "   [WER %.2f]" % r["wer"]
                elif r.get("scriptNote"):
                    tag = "   [%s]" % r["scriptNote"]
                else:
                    tag = ""
                print("         heard  %s%s" % (r["transcript"] or "(nothing)", tag))
                print("         wrote  %s" % (r["output"] or "(nothing)"))
            else:
                print("         in     %s" % r["input"])
                print("         out    %s" % (r["output"] or "(nothing)"))
        print()

    passed = [r for r in results if not r["failures"]]
    failed = [r for r in results if r["failures"]]
    heard = [r["wer"] for r in results if r["wer"] is not None]
    skipped = [r for r in results if r["wer"] is None and r.get("scriptNote")]
    if heard:
        print("recognition: median WER %.2f across %d spoken cases  (0.00 is perfect)%s"
              % (sorted(heard)[len(heard) // 2], len(heard),
                 "; %d not scored, heard in another script" % len(skipped) if skipped else ""))
    # An error is not a verdict. A case that never got an answer says nothing
    # about quality, and counting it as a failure is how a broken run comes to
    # look like a bad prompt.
    errored = [r for r in results if r.get("error")]
    print("%d passed, %d failed%s  (%d cases, %.0fs)"
          % (len(passed), len(failed) - len(errored),
             ", %d errored" % len(errored) if errored else "",
             len(results), time.time() - started))
    if errored:
        print("  %d case(s) never got an answer — this run is not a clean baseline"
              % len(errored))

    doc = {"at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
           "promptVersion": args.version, "assistPrompt": args.assist,
           "writingPath": args.pipeline,
           "repeat": args.repeat, "passed": len(passed),
           "failed": len(failed), "errored": len(errored),
           "total": len(results), "results": results}
    out_path = Path(args.out) if args.out else (
        HERE.parent / ".quality" / ("run-%s.json" % datetime.now().strftime("%Y%m%d-%H%M%S")))
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(doc, indent=1, ensure_ascii=False))
    print("saved: %s" % out_path)

    if args.compare:
        # A traceback here would land on top of a run that cost real money and
        # succeeded. Say what is wrong and keep the results.
        try:
            prev = json.loads(Path(args.compare).read_text())
        except (OSError, ValueError) as e:
            print()
            print("could not read --compare %s: %s" % (args.compare, e))
            return 1 if failed else 0
        was = {r["id"]: not r["failures"] for r in prev["results"]}
        now = {r["id"]: not r["failures"] for r in results}
        fixed = sorted(i for i in now if now[i] and was.get(i) is False)
        broke = sorted(i for i in now if not now[i] and was.get(i) is True)
        print()
        print("vs %s (%s): %d -> %d passing"
              % (prev.get("assistPrompt", prev.get("promptVersion", "?")),
                 prev.get("at", "?"), prev.get("passed", 0), len(passed)))
        # Say when a difference cannot be attributed. Same prompt on both
        # sides means every FIXED and REGRESSED below is the model varying,
        # not a change; single-sample runs cannot separate the two at all.
        if prev.get("errored"):
            print("   the baseline had %d case(s) that never got an answer — those"
                  " show as FIXED below and mean nothing" % prev["errored"])
        same_prompt = prev.get("assistPrompt") == args.assist and args.assist != "unknown"
        same_code = prev.get("writingPath") == args.pipeline and args.pipeline != "unknown"
        if same_prompt and same_code:
            # Both halves unchanged: nothing that decides the output differs,
            # so every line below is the model varying. Requiring BOTH matters
            # — a release can leave the prompt untouched and still change the
            # script derivation, the refusal filter and the leak guard.
            print("   nothing that shapes the output changed between these runs —"
                  " every difference below is the model varying, not your edit")
        elif same_prompt:
            print("   the prompt is identical; the difference is elsewhere in the"
                  " writing path")
        elif args.repeat == 1:
            print("   single run each side: a one-case difference here is as"
                  " likely to be variance as a real change. --repeat 3 to tell them apart")
        for i in fixed:
            print("   FIXED      %s" % i)
        for i in broke:
            print("   REGRESSED  %s" % i)
        if not fixed and not broke:
            print("   no case changed verdict")

    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
