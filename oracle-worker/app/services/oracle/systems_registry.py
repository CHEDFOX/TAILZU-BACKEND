"""
SYSTEMS REGISTRY — the single source of truth for every divination system.

Add a new system by adding ONE entry to SYSTEMS (id -> label, aliases, sections).
The cross-system router reads from here, so nothing else changes to add a system.
"""
import re
import httpx
from app.services.oracle.classifier import (
    _loads_salvaging,
    BPHS_SECTIONS, KP_SECTIONS, WESTERN_SECTIONS, CHINESE_SECTIONS, MANDALA_SECTIONS,
)

# The big, engine-backed traditions: full charts, sections and a deep witness-council.
_BIG_SYSTEMS = {
    "bphs":    {"label": "Vedic (BPHS)",      "aliases": ["vedic", "jyotish", "bphs", "parashari", "indian astrology"], "sections": BPHS_SECTIONS},
    "kp":      {"label": "KP (Krishnamurti)", "aliases": ["kp", "krishnamurti"],                                        "sections": KP_SECTIONS},
    "western": {"label": "Western",           "aliases": ["western", "tropical", "hellenistic", "greek"],               "sections": WESTERN_SECTIONS},
    # Zi Wei Dou Shu lives as SECTIONS inside this system, so naming it has to route
    # here — otherwise "read my zi wei chart" matched no system by name at all and
    # depended entirely on the classifier inferring it from the section glosses.
    "chinese": {"label": "Chinese (BaZi)",    "aliases": ["chinese", "bazi", "ba zi", "four pillars",
                                                          "zi wei", "ziwei", "zi wei dou shu", "dou shu",
                                                          "purple star", "紫微斗數", "紫微",
                                                          "qi men", "qimen", "qi men dun jia",
                                                          "da liu ren", "plum blossom", "mei hua"],  "sections": CHINESE_SECTIONS},
    "mandala": {"label": "Astrocartography",  "aliases": ["mandala", "astrocartography", "relocation", "best city", "cities"], "sections": MANDALA_SECTIONS},
}

# The wider council: computed-signature systems (Numerology, Mayan, Kabbalah, Alchemy …).
# The router can pick these too; the relevant ones get a FULL computed profile (deep_council
# in signatures.py) instead of chart sections — no engine, no LLM council. `kind` lets the
# pipeline route them to the signature path rather than the engine-section path.
# Register the systems added in this series BEFORE the derived views are read, so the
# cross-system router can route to them. Without this they exist as engines but are
# invisible to the classifier — reachable only by direct API call.
from app.services.oracle import signatures_extended as _ext
_ext.register()
from app.services.oracle import signatures_more as _more
_more.register()
from app.services.oracle import signatures_new as _new
_new.register()
from app.services.oracle import signatures_world as _world
_world.register()
from app.services.oracle import signatures_numbers as _numbers
_numbers.register()

from app.services.oracle.signatures import MINOR_SYSTEMS as _MINOR, SIGNATURE_IDS

SYSTEMS = dict(_BIG_SYSTEMS)
for _sid, _m in _MINOR.items():
    SYSTEMS[_sid] = {**_m, "kind": "signature"}


def is_signature_system(sid):
    """True for a wider-council (computed-signature) system — routed to deep_council,
    not the engine-section / witness path used by the big traditions."""
    return sid in SIGNATURE_IDS


def _toks(text):
    """Words, lowercased, with a naive plural stripped. Long enough words only, so
    'gemini' does not become 'gemin' and 'lots' does not collide with 'lot'."""
    out = []
    for w in re.findall(r"[a-z0-9]+", (text or "").lower()):
        out.append(w[:-1] if len(w) > 4 and w.endswith("s") else w)
    return out


# ALIASES THAT ARE QUESTIONS, NOT NAMES. detect_named_systems CLAMPS: a match
# restricts the whole council to the matched systems. "which direction should my
# desk face?" matched Nine Star Ki and Qi Men through the alias "which direction"
# and dropped Ba Zhai — the system that actually answers a desk — along with
# everything else the router picked. Directions are answered by Ba Zhai, Nine Star
# Ki, Qi Men, Flying Star and Vastu alike, so no one of them owns the question.
# These phrases stay in the registry and still reach the router's catalog as "also
# called", where they are evidence it weighs; they just never clamp.
_HINT_ONLY_ALIASES = frozenset({
    "which direction", "best direction", "bad direction", "bad directions",
    "unlucky direction", "auspicious direction", "direction to travel",
    "sleeping direction", "where should i go", "numbers",
})


def detect_named_systems(question):
    """Systems the user NAMED. Two passes, because people do not type labels.

    PHRASE — the original: the alias as a contiguous string on word boundaries, so
    'native' cannot fire on 'alternative', 'kp' on 'backpack', 'ki' on 'tzolkin'.
    This is also the only pass that can match a CJK alias like 面相, which has no
    spaces to tokenise on.

    TOKENS — the alias's words, plural-stripped, appearing consecutively in the
    question's words. This is what lets 'read my runes' reach an alias written
    'rune', and 'the cards' reach 'card reading'. Token EQUALITY, not substring,
    so it keeps every guarantee the phrase pass has.

    Neither pass can stem across word order: 'read my face' still will not reach
    an alias written 'face reading'. That is what the aliases below are for — the
    matcher's job is to forgive plurals and spacing, not to guess at meaning."""
    raw = (question or "").lower()
    qt = _toks(raw)
    out = []
    for sid, s in SYSTEMS.items():
        for term in (sid, *s["aliases"]):
            if str(term).lower() in _HINT_ONLY_ALIASES:
                continue
            if re.search(r"(?<![a-z0-9])" + re.escape(term) + r"(?![a-z0-9])", raw):
                out.append(sid)
                break
            t = _toks(term)
            if t and any(qt[i:i + len(t)] == t for i in range(len(qt) - len(t) + 1)):
                out.append(sid)
                break
    return out

def _default_sections(sid, n=4):
    secs = [x.strip() for x in SYSTEMS[sid]["sections"].replace("\n", " ").split(",") if x.strip()]
    return secs[:n]

def _catalogs_block():
    """Every system's sections, DESCRIBED — see oracle/section_catalog.py for why.

    The cross-system router chooses sections across all traditions at once, so this is
    where a bare-identifier menu did the most damage: a wrong pick here sends the wrong
    data from the wrong tradition."""
    try:
        from app.services.oracle.section_catalog import describe_list
    except Exception:
        describe_list = None

    out = []
    for sid in SYSTEMS:
        s = SYSTEMS[sid]
        secs = s["sections"]
        if describe_list:
            names = [x.strip() for x in str(secs).replace("\n", " ").split(",") if x.strip()]
            secs = describe_list(names)
        # The aliases go to the ROUTER, not just to the matcher.
        #
        # A label alone can be unrecognisable: "Anglo-Saxon Futhorc" is what
        # someone means when they type "read my runes", and "Mérìndínlógún" is
        # what they mean by "cowrie shells", but only if something makes the
        # connection. Putting the names here lets the model make it, and the
        # model then routes — which is the right place for a judgement about
        # what a question means.
        #
        # This is deliberately NOT the same as adding them to
        # detect_named_systems. That function does not hint, it CLAMPS: a match
        # restricts the whole council to the matched systems, so a loose alias
        # there would answer "what does my hand say about my career" with
        # palmistry and nothing else. Here a name is evidence the model weighs;
        # there it is an override. Same words, opposite blast radius.
        names = ", ".join(dict.fromkeys(a for a in (s.get("aliases") or []) if a))
        head = f"[{sid}] {s['label']}"
        # WHAT IT NEEDS TO WORK — the single most routing-relevant fact about a
        # system, and the one the router was never given. `kind` on the registry
        # entry is the literal string "signature" for all ninety-five, which says
        # nothing; the real kind lives in the Library's shelves.
        #
        # It decides whether a system can answer AT ALL. A cast system needs
        # something thrown before there is anything to read; a moment system reads
        # the instant of the question rather than the birth; a body system wants a
        # hand or a face this app has never seen. The pipeline currently corrects
        # for this AFTER routing, by demoting those kinds — a code-level patch for
        # a judgement the model could have made correctly if it had the fact.
        meta = []
        k, region = _kind_and_region(sid)
        if k:
            meta.append(k)
        if region:
            meta.append(region)
        if meta:
            # Parenthesised, not dot-separated: two of the shelf names contain a
            # "·" themselves ("Europe · Folk"), so the separator ran into the
            # value and "cast · Europe · Folk" read as three tags, not two.
            head += " (" + ", ".join(meta) + ")"

        if names:
            head += f" — also called: {names}"
        out.append(f"{head}:\n{secs}")
    return "\n\n".join(out)


def _kind_and_region(sid):
    """(kind, region) from the Library's shelves — the app's one taxonomy."""
    if sid in ("bphs", "kp", "western", "chinese", "mandala"):
        return "birth", None
    try:
        from app.services.features.library_shelves import SHELVES, SYSTEM_SHELF
        got = SYSTEM_SHELF.get(sid)
        if not got:
            return None, None
        shelf, kind = got
        return kind, SHELVES.get(shelf, (None,))[0]
    except Exception:
        return None, None


def catalogs_block():
    """Public: the every-system section catalog block, for folding cross-system routing
    into the ONE classifier call (so plutto needs no separate classify_systems round)."""
    return _catalogs_block()



def _known_only(sid, secs):
    """Sections this system actually has. clean_systems validated the system id
    and then kept any string at all as a section name, so an invented one rode
    straight through the cross-system path — the same hole classifier.valid_sections
    closes for the single-system path. Reads the registry, so it covers the wider
    council too, whose sections are not in SYSTEM_CATALOGS."""
    raw = str(SYSTEMS.get(sid, {}).get("sections") or "").replace("\n", " ")
    known = {x.strip().split(":")[0].strip() for x in raw.split(",") if x.strip()}
    ok = [x for x in secs if x.split(":")[0].strip() in known]
    bad = [x for x in secs if x not in ok]
    if bad:
        # MISFILED is not INVENTED, and one message for both hid that.
        #
        # "dropped invented section(s) for numerology: numerology_today" reads as
        # a hallucination. It is not: numerology_today is a real section, it just
        # lives under bphs. Same for planetary_returns, asked for under western
        # and owned by bphs. Meanwhile life_path really does not exist anywhere.
        #
        # These are different failures. A misfiled name means the router wanted a
        # real thing and guessed the owner wrong — recoverable in principle, and
        # a sign the section is filed somewhere surprising. An invented name means
        # it made something up. Reporting them identically means neither can be
        # acted on, and the noisier one buries the rarer one.
        owners = _section_owners()
        misfiled = {x: owners[x.split(":")[0].strip()]
                    for x in bad if x.split(":")[0].strip() in owners}
        invented = [x for x in bad if x not in misfiled]
        if misfiled:
            where = ", ".join(f"{k} (lives in {'/'.join(sorted(v))})"
                              for k, v in list(misfiled.items())[:6])
            print(f"[systems_registry] MISFILED section(s) asked of {sid}: {where}")
        if invented:
            print(f"[systems_registry] INVENTED section(s) for {sid}: {', '.join(invented[:6])}")
    return ok


_OWNERS = None


def _section_owners():
    """section id -> the systems that really own it. Built once."""
    global _OWNERS
    if _OWNERS is None:
        idx = {}
        for _sid, _s in SYSTEMS.items():
            raw = str(_s.get("sections") or "").replace("\n", " ")
            for x in raw.split(","):
                name = x.strip().split(":")[0].strip()
                if name:
                    idx.setdefault(name, set()).add(_sid)
        _OWNERS = idx
    return _OWNERS


def clean_systems(raw, named=None):
    """Validate a router `systems` map ({sid:[sections]}) against the registry: keep only
    known systems with non-empty section lists; if the user NAMED systems, restrict to
    those. Returns {} if nothing usable. Shared by classify_systems and the merged call."""
    clean = {}
    if isinstance(raw, dict):
        for sid, secs in raw.items():
            # A known system with an empty list is still the router's choice: the compact index tells it to list []
            # for a wider-council system, which reads its whole profile anyway.
            if sid not in SYSTEMS or not isinstance(secs, (list, tuple)):
                continue
            ok = _known_only(sid, [x for x in (secs or []) if isinstance(x, str)])
            # KEEP THE SYSTEM even when every section name it guessed was wrong.
            #
            # This used to drop the whole entry, and the effect was out of all
            # proportion to the mistake. "Read my runes" routes correctly to
            # futhorc — which has exactly ONE real section, futhorc_runes — and
            # the model called it something else, so the system vanished, the
            # map came back empty, and the fallback answered a rune question
            # with a Vedic chart. The system a question belongs to is the
            # valuable judgement here; the section names are a detail, and a
            # system with one or two sections is the easiest to misname and the
            # most damaged by being dropped for it.
            clean[sid] = ok or _default_sections(sid)
    if named:
        clean = {sid: (clean.get(sid) or _default_sections(sid)) for sid in named}
    return clean

def _prompt():
    return f"""You are the routing brain of a divination LLM that knows EVERY system.
Decide which SYSTEMS and which DATA SECTIONS are genuinely relevant to the question —
as few or as many as it truly needs (one system, or several). If the user names a
system (e.g. "what does Vedic say"), use ONLY that system.

FOR A BROAD QUESTION, BREADTH IS THE RELEVANCE. "How will my year go", "tell me
about myself", "what should I know" are not questions about one tradition. They are
exactly the case where several should speak, because two traditions that never met
arriving at the same reading IS the answer's weight — and that is the only thing
this app can do that a single-tradition app cannot. For those, pick 4-6 systems
from DIFFERENT families (South Asian, East Asian, Western, Persian/Arabic, African,
Pacific, body-reading), not four that share a parent. This is not padding; a broad
question answered by two birth-chart systems is a narrower answer than it deserves.

SPREAD THE FAMILIES, DO NOT DOUBLE THEM. Vedic and KP are both South Asian; Western
and Human Design both read the sky. Adding a second system from a family already
represented buys nothing — it is the same lens twice. Each extra pick should come
from a family not yet in the list.

EACH SYSTEM IS TAGGED WITH WHAT IT NEEDS TO WORK. Read it before picking:
  birth    — computes from the birth date, time and place. Always available.
  cast     — needs something thrown first: coins, sticks, shells, a shuffle.
             Nothing has been cast, so pick one ONLY if the user asked for that
             reading by name. Convened unbidden, the draw would be invented.
  moment   — reads the instant the question was asked, not the birth. Right for
             "should I, right now" and wrong for "what am I like".
  body     — reads a hand, a face, a mark. This app has no camera and has seen
             neither, so pick one ONLY when the user asks about their own hand
             or face, and expect it to teach them to read it themselves.
  practice — a method that is held and practised, not calculated from a birth.

NARROW QUESTIONS STAY NARROW — at most 2-3 systems, and often one. This applies to
a question about ONE named technique or concept even when it is phrased openly:
"what does my Saturn return mean", "what is my life path number", "when is my next
dasha" are single-technique questions, not invitations to convene the world. The
tradition that owns the technique answers; a second may join only if it has that
same technique under another name. The test is the QUESTION's scope, not the
reader's appetite, and "what does X mean" is a narrow question whenever X is a
specific thing.

Return JSON:
- systems: object mapping system_id -> [section ids from that system]. ONLY relevant systems/sections. No padding, no cap, no minimum.
- topic: single word (marriage/career/wealth/health/spirituality/timing/remedies/compatibility/travel/family/personality/general)
- question_type: timing/yes_no/why/how_is/what_kind/should_i/general
- scope: "broad" or "narrow". BROAD asks about the whole of a life or self with no single subject. NARROW has one subject, even when phrased openly: one life area, one named technique or concept, one event, or one named tradition. When in doubt say narrow.
- emotional_tone: curious/worried/anxious/sad/desperate/excited/neutral
- language: english/hindi/hinglish/other

AVAILABLE SYSTEMS AND SECTIONS:
{_catalogs_block()}

Return ONLY valid JSON."""

def _fallback(question, named):
    targets = named or ["bphs"]
    return {"systems": {sid: _default_sections(sid) for sid in targets},
            "topic": "general", "question_type": "general",
            "emotional_tone": "neutral", "language": "english"}

async def classify_systems(question, api_key, model, conversation_history=None):
    """Cross-system selection -> {systems:{sid:[sections]}, topic, question_type, tone, language}."""
    named = detect_named_systems(question)
    if not api_key or not model:
        return _fallback(question, named)
    try:
        from app.services.oracle.classifier import history_messages
        messages = [{"role": "system", "content": _prompt()}] + history_messages(conversation_history, 4)
        messages.append({"role": "user", "content": question})
        async with httpx.AsyncClient() as client:
            r = await client.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers={"Authorization": "Bearer " + api_key, "Content-Type": "application/json"},
                # 400 truncated the map mid-object on multi-system questions — the
                # parse then failed at ~char 1035 and the router's real picks were
                # thrown away for the fallback sections.
                json={"model": model, "messages": messages, "max_tokens": 900, "temperature": 0.1,
                      "reasoning": {"enabled": False}},   # structured system-routing JSON — no thinking needed
                timeout=15.0)
        if r.status_code != 200:
            # Say so. This lands on ['bphs'], which is indistinguishable from a
            # correctly-routed Vedic question — so a routing outage used to look
            # like the oracle simply preferring Vedic all day.
            print(f"[classify_systems] router HTTP {r.status_code} -> fallback")
            return _fallback(question, named)
        text = r.json()["choices"][0]["message"]["content"].strip().replace("```json", "").replace("```", "").strip()
        result = _loads_salvaging(text)
        systems = result.get("systems") if isinstance(result, dict) else None
        clean = {} if not isinstance(systems, dict) else {
            sid: [x for x in (secs or []) if isinstance(x, str)]
            for sid, secs in systems.items() if sid in SYSTEMS and secs}
        if not clean:
            print("[classify_systems] router returned no usable systems -> fallback")
            return _fallback(question, named)
        if named:  # user explicitly named systems -> restrict to them
            clean = {sid: (clean.get(sid) or _default_sections(sid)) for sid in named}
        result["systems"] = clean
        for k, d in (("topic", "general"), ("question_type", "general"),
                     ("scope", "narrow"), ("emotional_tone", "neutral"),
                     ("language", "english")):
            result.setdefault(k, d)
        return result
    except Exception as e:
        print(f"[classify_systems] {e}")
        return _fallback(question, named)
