"""
CLASSIFIER v2 — Simplified
One LLM call: understand the question + pick relevant data sections.
No method catalog. No rules. The LLM already knows astrology.

Cost: ~$0.0001 per call (prompt is tiny now)
"""

import json
import re
import httpx
from datetime import datetime
from typing import Dict


# ═══════════════════════════════════════════════════════════════
# SECTION CATALOGS (per system)
# ═══════════════════════════════════════════════════════════════

BPHS_SECTIONS = """dashas_full, transits, yogas, navamsa, dasamsa,
house_detail:N, jaimini, afflictions, medical,
remedies, classical_rules, personality, nadi,
compatibility, annual, prashna,
ashtakavarga, shadbala, divisional_charts, bhava_chalit,
alt_dashas, transit_deep, career_aptitude, numerology,
vastu, chakra, muhurta, planetary_returns,
weekly_forecast, daily_snapshot, past_events, life_timeline,
relocation, baby_names, sudarshana, nakshatra_profile,
yoga_timing, lucky, bphs_advanced, spiritual,
maraka, argala, tithi_pravesh, chart_promise,
period_query, manglik, pratyantar, timing_windows,
arudha_padas, av_transits, future_transits, transit_aspects,
name_numerology, hora, panchanga, dasha_sandhi,
rashi_drishti, av_sodhana, prastara_av, shodhya_pinda,
bhava_strengths, ishta_kashta, gemstones, synastry,
composite, location, raja_yogas, dhana_yogas,
daridra_yogas, female_horoscopy, longevity,
dasha_psychology, dasha_interpretation, special_lagnas,
jaimini_complete, upapada, muhurta_rules,
d60_past_life, remaining_vargas, mrityu_bhaga,
bhrigu_bindu, pada_archetypes, pancha_pakshi, graha_shanti,
upagrahas,
daily_guidance, numerology_today"""

KP_SECTIONS = """cusps, significators, event_promise, ruling_planets,
dba_timing, transit_triggers, horary, fortuna,
fruitfulness, untenanted, medical, stellar_theory, four_level,
sensitive_points, kp_profession, cuspal_interlinks,
lost_object, rp_timing, ruling_now"""

WESTERN_SECTIONS = """aspects, configurations, progressions, solar_return,
lunar_return, solar_arc, lilith, fortune, fixed_stars,
void_moon, element_balance, composite, synastry, retrogrades,
profections, sect, arabic_parts, zodiacal_releasing,
antiscia, midpoints, harmonics, western_horary, mutual_receptions,
full_dignities, almuten, hayz, planetary_joys,
asteroids, planetary_nodes, prenatal, decennials,
tertiary, converse, prog_lunation, electional, daily_guidance"""

CHINESE_SECTIONS = """four_pillars, day_master, elements, ten_gods,
branch_interactions, stem_interactions, symbolic_stars,
luck_periods, annual_luck, compatibility, empty_branches,
na_yin, life_stages, yong_shen, extended_stars, fan_fu_yin,
dayun_onset, xiao_yun, pillar_overlay, hidden_strength,
gods_matrix, date_selection, feng_shui, chinese_medical, zi_wei,
zi_wei_timing, daily_guidance, bagua, loshu_grid, lunar_calendar,
stems_branches, yin_yang"""


MANDALA_SECTIONS = """power_map, best_cities, here_now, compass,
relocation, travel_windows, local_space, geodetic_zodiac,
parans, sacred_sites, eclipse_geography, migration_roadmap,
time_place_score, danger_zones, relationship_geography, active_direction,
location_weather, country_year, personal_mundane, coordinate_mundane, globe_scan"""

SYSTEM_CATALOGS = {
    'bphs': BPHS_SECTIONS,
    'kp': KP_SECTIONS,
    'western': WESTERN_SECTIONS,
    'chinese': CHINESE_SECTIONS,
    'mandala': MANDALA_SECTIONS,
}


def _loads_salvaging(text):
    """json.loads, but a reply cut off mid-object still yields its complete part.

    A truncated routing map used to cost the whole turn: the parse raised, the
    fallback fired, and a question the router had understood perfectly was
    answered from the four default sections instead. Closing the structures the
    model had already opened recovers every system it managed to emit."""
    try:
        return json.loads(text)
    except Exception:
        pass
    start = text.find("{")
    if start < 0:
        raise ValueError("no JSON object in routing reply")
    body = text[start:]

    def _scan(s):
        """(closers, inside_string) for a prefix — None when it ends mid-string."""
        stack, in_str, esc = [], False, False
        for ch in s:
            if in_str:
                if esc:          esc = False
                elif ch == "\\": esc = True
                elif ch == '"':  in_str = False
                continue
            if ch == '"':        in_str = True
            elif ch in "{[":     stack.append("}" if ch == "{" else "]")
            elif ch in "}]" and stack:
                stack.pop()
        return (None if in_str else "".join(reversed(stack)))

    # Walk back to the last point that closes cleanly. Trimming has to come
    # BEFORE counting the closers — brackets opened inside the discarded
    # fragment must not be closed, or the repair invents structure that the
    # model never emitted.
    for cut in range(len(body), 0, -1):
        cand = re.sub(r'[,\s:]+$', '', body[:cut])
        if not cand:
            break
        closers = _scan(cand)
        if closers is None:
            continue
        try:
            return json.loads(cand + closers)
        except Exception:
            continue
    raise ValueError("routing reply unparseable even after salvage")


def known_sections(system: str) -> set:
    """Every section id this system can actually build, base names only
    (`house_detail:N` in the catalog, `house_detail:7` from the model)."""
    raw = SYSTEM_CATALOGS.get(system, BPHS_SECTIONS)
    return {x.strip().split(":")[0].strip()
            for x in str(raw).replace("\n", " ").split(",") if x.strip()}


def valid_sections(system: str, secs) -> list:
    """Drop section ids that exist in no catalog.

    The model invents plausible-looking names — a real run picked `karma` for
    "why do good people suffer" and `marriage` for "when will i get married".
    Neither is a section, so neither renders, and nothing anywhere said so: the
    briefing was simply thinner than the routing decision implied. Silent, and
    invisible to the catalog audit, which can only check what is written down."""
    if not isinstance(secs, list):
        return []
    ok, bad = [], []
    known = known_sections(system)
    for x in secs:
        if not isinstance(x, str) or not x.strip():
            continue
        (ok if x.split(":")[0].strip() in known else bad).append(x)
    if bad:
        print(f"[classifier] dropped {len(bad)} invented section(s) for {system}: {', '.join(bad[:6])}")
    return ok


def build_classifier_prompt(system: str = "bphs", today: str = "", showcase_menu: str = "",
                            systems_menu: str = "", divination_menu: str = "",
                            cross_system: bool = False, catalogs_block: str = "") -> str:
    """Build the classifier prompt for a given system. When cross_system is set (the
    plutt0.8 meta-oracle), this ONE call ALSO does the cross-system routing — it returns a
    `systems` map ({system_id: [sections]}) across every tradition INSTEAD of a single
    system's `sections` list — so no separate classify_systems round-trip is needed."""
    sections = SYSTEM_CATALOGS.get(system, BPHS_SECTIONS)
    # DESCRIBE the sections. The classifier chooses by relevance to a question, and for
    # roughly a third of these names it was inferring meaning from the identifier alone —
    # `hayz`, `mrityu_bhaga`, `xiao_yun`, `pillar_overlay` and the rest are either
    # technical terms it may half-know or internal coinages it cannot know. A wrong pick
    # sends the wrong data to the Oracle, which costs far more than the ~1.6k tokens this
    # adds. Descriptions are harvested from each renderer's own title where possible, so
    # they cannot drift out of sync with the code.
    try:
        from app.services.oracle.section_catalog import describe_list as _describe
        _names = [x.strip() for x in str(sections).replace("\n", " ").split(",") if x.strip()]
        sections = _describe(_names)
    except Exception:
        pass
    _today = today or datetime.now().strftime("%Y-%m-%d")
    _showcase = ""
    if showcase_menu:
        _showcase = (
            "\n- showcase_feature: if the question clearly lands on ONE feature below — "
            "something the user would genuinely want to OPEN and explore after your answer — "
            "return its exact id. Return null if no feature is a strong, obvious fit, or for "
            "small talk / off-topic / vague-general questions. Never force it; a weak or wrong "
            "suggestion is worse than none.\n\nSHOWCASE FEATURES (id — \"button\" (when it fits)):\n"
            + showcase_menu + "\n"
        )
    if systems_menu:
        _showcase += (
            "\n- showcase_system: SEPARATELY, if a whole tradition-SYSTEM below would give the "
            "user a fascinating fresh angle on THIS question — a different lens worth exploring "
            "after your answer — return its exact key. Prefer this only when a system truly speaks "
            "to the question; return null otherwise.\n\nSHOWCASE SYSTEMS (key — "
            "\"title\" (what it sees)):\n" + systems_menu + "\n"
        )
    if divination_menu:
        _showcase += (
            "\n- showcase_divination: if the question is the kind a DRAWN reading answers best — an "
            "open crossroads, a decision, a 'what's really going on / what should I do', a luck / "
            "fortune / love / timing question where laying the cards would delight more than a data "
            "readout — return the exact key below. This is an INTERACTIVE draw (the user pulls the "
            "cards), so pick it when the DRAW itself is the fitting experience. Return null otherwise.\n\n"
            "SHOWCASE DIVINATION (key — \"title\" (when a draw fits)):\n" + divination_menu + "\n"
            "\nCRUCIAL — fill AT MOST ONE of showcase_feature / showcase_system / showcase_divination "
            "(or none); the other two MUST be null. Do NOT co-fill a divination draw next to a feature. "
            "Tie-break: if a specific FEATURE fits, pick it and leave divination null — reserve "
            "showcase_divination for when the user literally asks to pull cards / cast / draw, or the "
            "answer is a pure open-ended 'what should I do' where laying the cards is itself the point. "
            "A generic tarot pull is NOT a catch-all; never default to it. Never force a weak suggestion."
        )
    if showcase_menu or systems_menu or divination_menu:
        _showcase += (
            "\n- showcase_alternatives: a list of AT MOST 2 further feature ids, and ONLY when the "
            "request names a CATEGORY that several features answer equally well — \"show me my chart\" "
            "is genuinely the Vedic chart AND the Western planets AND the divisional charts, and "
            "picking one of them silently is a guess dressed as an answer. They must be true siblings "
            "of showcase_feature: the same kind of thing, each a complete answer to what was asked. "
            "Return [] for a question with one right answer — a specific ask ('when will I marry') has "
            "one, and padding it with near-misses turns the reply into a menu. Never repeat "
            "showcase_feature here.\n"
            "\n- showcase_label: IF you recommended something above, write a fresh, enticing 1–3 word "
            "button label for it, tuned to THIS question and phrased as an invitation — NOT the "
            "feature's raw name. e.g. a luck question → Tarot becomes \"Your fortune\" or \"Pull a "
            "card\"; a timing question → \"Your seasons\"; a place question → \"Your ground\". Make "
            "them want to tap. null if you recommended nothing.\n"
        )

    # cross_system → the ONE call also routes across every tradition (replaces the separate
    # classify_systems round). Otherwise it picks sections for the single native system.
    if cross_system:
        _pick = ("- systems: an object mapping system_id -> [section ids from THAT system]. Include ONLY the "
                 "systems (one or several) genuinely relevant to THIS question, each with only its relevant "
                 "sections — as few or as many as it truly needs. No padding, no minimum. If the user NAMES a "
                 "system (e.g. \"what does tarot say\"), use ONLY that one.")
        _catalog = "AVAILABLE SYSTEMS AND SECTIONS:\n" + (catalogs_block or sections)
    else:
        _pick = ("- sections: select EVERY data section genuinely relevant to the question — as few or as "
                 "many as it truly needs (could be 1, could be 15). Never pad, never cap; prefer precision "
                 "over quantity.")
        _catalog = "AVAILABLE SECTIONS:\n" + sections

    # ORDER MATTERS, and not for readability.
    #
    # A provider can only reuse a cached prompt PREFIX — identical bytes from the
    # very first token. This prompt used to open with "TODAY is {date}" and end
    # with the catalog, so the one part that never changes sat behind a part that
    # changes daily, and nothing was cacheable at all. The catalog is ~11.8k
    # tokens of the roughly 13k sent on every single classifier call.
    #
    # Reference material first, instructions after it, the question last. That is
    # the order caching needs, and it is also the order that reads best: the model
    # sees what exists, then what to do with it, then what was asked.
    # L1 of the layered router (oracle/router.py): the routing rules the merged call
    # had lost — they lived only in classify_systems, now a fallback — and the
    # toolboxes, so this one call also returns each tradition's PLAN. Both are static,
    # so they sit before TODAY, inside the prefix a provider can cache.
    from .router import ROUTING_RULES, PLAN_RULE, toolbox_block
    _rules = ("\n\n" + ROUTING_RULES) if cross_system else ""
    _tb = toolbox_block(["bphs", "western", "chinese"] if cross_system else [system])
    _toolbox = f"\n\nTOOLBOX — the computations a plan may call, by tradition:\n{_tb}" if _tb else ""
    if cross_system:
        _planf = ("\n- plans: an object mapping EACH engine-backed tradition you put in `systems` "
                  "(bphs, kp, western, chinese) to its plan — " + PLAN_RULE +
                  " bphs and kp both plan from the VEDIC toolbox. {} for small talk or off-topic.")
    else:
        _planf = ("\n- plan: the computations to consult for this question — " + PLAN_RULE +
                  " [] for small talk or off-topic.")

    return f"""{_catalog}{_rules}{_toolbox}

You classify astrology questions using the systems above. TODAY is {_today}. Return JSON with:
- target_date: if the question is about a SPECIFIC point in time, resolve it to "YYYY-MM-DD" using TODAY ({_today}) — e.g. "tomorrow", "next month", "in March", "this weekend", "in 2027", "on my birthday 5 June", "next Tuesday". Use the 15th if only a month/year is given, Jan if only a year. null if the question names no specific time (e.g. "when will I marry?", "is this a good year?", general questions).
- topic: primary topic (single word — marriage / career / wealth / health / spirituality / timing / remedies / compatibility / travel / family / personality / general)
- secondary_topic: optional second topic if the question genuinely spans two areas (e.g. "how does my career affect my marriage" → primary=career, secondary=marriage). null if not needed.
- question_type: timing / yes_no / why / how_is / what_kind / should_i / general
- scope: "broad" or "narrow". BROAD asks about the whole of a life or self with no single subject — "how will my year go", "tell me about myself", "what should I know". NARROW has one subject, even when phrased openly: one life area (marriage, a job, a move), one named technique or concept ("my Saturn return", "my life path number"), one event, or one named tradition. When in doubt say narrow — a broad answer convenes many traditions, and doing that to a question with one subject buries the answer it actually asked for.
- emotional_tone: curious / worried / anxious / sad / desperate / excited / neutral
- language: the language the user WROTE THEIR LAST MESSAGE in, named in lowercase English — english / hindi / hinglish / spanish / bengali / tamil / … (never "other"). "hinglish" = Hindi (or another Indian language) written in Latin letters, usually mixed with English ("yaar mera career kab set hoga"); name the script when it is not the usual one ("tamil in latin letters"). Judge from THEIR words, never from a "(viewing section: …)" note. If the last message is too short to tell (a word, an emoji, a number), use the language of their earlier messages.
- register: 3-8 English words on HOW they write, so the reply can sound like them — e.g. "casual, lowercase, slangy, emojis" / "formal and polite" / "terse, direct" / "playful hinglish, says bhai" / "anxious, long and open".
- off_topic: true if the request is FUNDAMENTALLY UNRELATED to the oracle's arts — e.g. write code/poems/ads/essays, solve math, general facts/news, product or book reviews, translations, or any task for a general assistant. false if it concerns the person's life, self, timing, relationships, choices, fortune, or inner meaning (even loosely). CRUCIAL: a request for TAROT, runes, I Ching, oracle cards, numerology, palmistry or ANY divination — including "read my tarot", "pull a card", "what do the cards say" — is NEVER off_topic; divination is core to the oracle, not a foreign task.
- wants_astrology: true ONLY if the user actually wants the astrology itself explained — the chart, planets, houses, dashas / aspects / elements, or the astrological "why" (e.g. "what does my chart say", "which dasha is running", "in vedic terms", "explain it astrologically"). false if they just want the answer or guidance in plain everyday language. Default false.
- small_talk: true for greetings, thanks, goodbyes, chit-chat, emoji-only or one-word social messages (e.g. "hi", "hello", "good morning", "thanks", "how are you", "ok", "lol"). false for any real question or request. Default false.
- intent_note: 1-2 plain-English sentences naming the REAL, often unspoken intent beneath the question — the fear, hope, decision, or longing actually driving it (e.g. "Surface ask is about a job change; underneath they want permission to leave and reassurance it won't fail."). ALWAYS write this in clear English for the responding model, no matter the user's language. This is a private briefing for the responder, never shown to the user.
{_pick}{_planf}{_showcase}

Return ONLY valid JSON."""


def history_messages(history, n: int = 4, max_chars: int = 600) -> list:
    """The last `n` turns as chat messages, each in its OWN role.

    The classifier, the planner and the router all sent every earlier turn as role
    "user" and dropped any longer than 300 characters — so the Oracle's own short
    replies read as things the person had said, its long ones vanished, and the
    classifier's "use the language of their earlier messages" read the Oracle's
    language as theirs. chat.py fixed this for the reply model; this is the same fix
    for the machinery. Long turns are cut, not dropped."""
    out = []
    for h in (history or [])[-n:]:
        if isinstance(h, dict):
            role, content = h.get("role", "user"), str(h.get("content", "") or "")
        else:
            role, content = "user", str(h)
        content = content.strip()
        if not content:
            continue
        if len(content) > max_chars:
            content = content[:max_chars].rstrip() + "…"
        out.append({"role": "assistant" if role in ("assistant", "oracle") else "user",
                    "content": content})
    return out


# The scripts a message can be read by without a model. Order matters only where
# ranges are disjoint, which they all are.
_SCRIPTS = (
    (0x0900, 0x097F, "hindi"), (0x0980, 0x09FF, "bengali"), (0x0A00, 0x0A7F, "punjabi"),
    (0x0A80, 0x0AFF, "gujarati"), (0x0B00, 0x0B7F, "odia"), (0x0B80, 0x0BFF, "tamil"),
    (0x0C00, 0x0C7F, "telugu"), (0x0C80, 0x0CFF, "kannada"), (0x0D00, 0x0D7F, "malayalam"),
    (0x0600, 0x06FF, "arabic"), (0x0400, 0x04FF, "russian"), (0x0370, 0x03FF, "greek"),
    (0x0590, 0x05FF, "hebrew"), (0x0E00, 0x0E7F, "thai"), (0xAC00, 0xD7AF, "korean"),
    (0x3040, 0x30FF, "japanese"), (0x4E00, 0x9FFF, "chinese"),
)


def script_language(text: str) -> str:
    """The language a message's script gives away, or "" for Latin / nothing."""
    counts: Dict[str, int] = {}
    for c in text or "":
        o = ord(c)
        for lo, hi, name in _SCRIPTS:
            if lo <= o <= hi:
                counts[name] = counts.get(name, 0) + 1
                break
    if not counts:
        return ""
    # Kana beside kanji is Japanese, not Chinese.
    if counts.get("japanese"):
        return "japanese"
    return max(counts, key=counts.get)


async def classify(question: str, api_key: str, model: str,
                   system: str = "bphs", conversation_history: list = None,
                   showcase_menu: str = "", systems_menu: str = "",
                   divination_menu: str = "", cross_system: bool = False,
                   catalogs_block: str = "") -> Dict:
    """
    Classify a question and pick relevant data sections.
    Returns: topic, question_type, emotional_tone, language, sections[]
    When cross_system, ALSO returns a validated `systems` map (the cross-system routing),
    so the plutt0.8 pipeline needs no separate classify_systems call.
    """
    if not api_key or not model:
        return _fallback(question, system)

    try:
        prompt = build_classifier_prompt(system, datetime.now().strftime("%Y-%m-%d"), showcase_menu,
                                         systems_menu, divination_menu, cross_system, catalogs_block)
        messages = [{"role": "system", "content": prompt}]

        # The last two exchanges, each in its own role (see history_messages).
        messages += history_messages(conversation_history, 4)

        messages.append({"role": "user", "content": question})

        payload = {
            "model": model,
            "messages": messages,
            # Truncation here is not a degraded answer, it is a LOST one: the parse
            # fails and _fallback ships four default sections.
            # The plans ride in the same reply now (one per deep tradition), so the
            # ceiling has room for them as well as the routing map.
            "max_tokens": 3400 if cross_system else 2600,
            "temperature": 0.1,
            # Pure structured-JSON routing: no thinking needed. Ignored by models
            # without reasoning; dropped and retried if a provider rejects it.
            "reasoning": {"enabled": False},
        }
        async with httpx.AsyncClient() as client:
            for attempt in range(2):
                response = await client.post(
                    "https://openrouter.ai/api/v1/chat/completions",
                    headers={
                        "Authorization": "Bearer " + api_key,
                        "Content-Type": "application/json",
                    },
                    json=payload,
                    timeout=20.0,
                )
                if response.status_code == 200 or attempt == 1:
                    break
                print(f"[Classifier] HTTP {response.status_code}: {response.text[:200]}")
                payload = {k: v for k, v in payload.items() if k != "reasoning"}

        if response.status_code != 200:
            print(f"[Classifier] HTTP {response.status_code} after retry; keyword fallback")
            return _fallback(question, system)

        data = response.json()
        choice = (data.get("choices") or [{}])[0]
        text = ((choice.get("message") or {}).get("content") or "").strip()
        text = text.replace("```json", "").replace("```", "").strip()
        if choice.get("finish_reason") == "length":
            print(f"[Classifier] hit max_tokens ({len(text)} chars)")

        result = _loads_salvaging(text)

        if not isinstance(result, dict):
            print(f"[Classifier] unparseable reply; keyword fallback: {text[:160]!r}")
            return _fallback(question, system)

        # Ensure defaults
        result.setdefault("topic", "general")
        result.setdefault("question_type", "general")
        result.setdefault("emotional_tone", "neutral")
        result.setdefault("language", "english")
        result.setdefault("register", "")
        result.setdefault("secondary_topic", None)
        result.setdefault("off_topic", False)
        result.setdefault("wants_astrology", False)
        result.setdefault("small_talk", False)
        result.setdefault("intent_note", "")
        result.setdefault("showcase_feature", None)
        result.setdefault("showcase_system", None)
        result.setdefault("showcase_divination", None)
        result.setdefault("showcase_label", None)
        result.setdefault("showcase_alternatives", [])
        if not isinstance(result.get("plans"), dict):
            result["plans"] = {}
        if not isinstance(result.get("plan"), list):
            result["plan"] = []

        # The prompt gives emotional_tone a closed list, and the model does not
        # always honour it — a real run returned "terrified", which is not in the
        # enum. pipeline.py looks the tone up in emotion_notes by exact key, so an
        # off-list value silently dropped the emotional handling for the most
        # distressed user in the set. Map the near-misses; keep the rest neutral.
        _TONES = ("curious", "worried", "anxious", "sad", "desperate", "excited", "neutral")
        _NEAR = {"terrified": "worried", "afraid": "worried", "scared": "worried",
                 "fearful": "worried", "nervous": "anxious", "panicked": "desperate",
                 "hopeless": "desperate", "grieving": "sad", "depressed": "sad",
                 "lonely": "sad", "angry": "worried", "frustrated": "anxious",
                 "hopeful": "excited", "happy": "excited", "joyful": "excited"}
        _t = str(result.get("emotional_tone") or "").strip().lower()
        if _t not in _TONES:
            result["emotional_tone"] = _NEAR.get(_t, "neutral")

        if cross_system:
            # Merged routing: `systems` is what plutto needs; `sections` is unused here.
            # A missing/empty map is NOT a failure — the pipeline falls back to the
            # dedicated classify_systems call — so keep the (valid) intent fields either way.
            result.setdefault("sections", [])
            if not isinstance(result.get("systems"), dict):
                result["systems"] = {}
            return result

        # Single-system: sections is required.
        result["sections"] = valid_sections(system, result.get("sections"))
        if "sections" not in result or not isinstance(result["sections"], list) or len(result["sections"]) < 1:
            # Keep the reading of the question (language, tone, recommendation); only
            # the data sections come from the keyword fallback.
            print("[Classifier] no valid sections; keyword sections")
            result["sections"] = _fallback(question, system).get("sections") or []

        return result

    except Exception as e:
        print(f"[Classifier] Error: {e}")
        return _fallback(question, system)


def _fallback(question: str, system: str = "bphs") -> Dict:
    """Keyword-based fallback when LLM classifier fails."""
    q = question.lower()
    topic = "general"
    question_type = "general"
    tone = "neutral"
    language = "english"

    # Small talk / social — greetings, thanks, one-word or emoji-only messages. Detected
    # here too so routing stays correct even when the LLM classifier is unreachable.
    _stripped = q.strip(" .!?‍\U0001f64f\U0001f44b❤\U0001f60a")
    _greet = {"hi", "hii", "hello", "hey", "yo", "hola", "namaste", "namaskar",
              "good morning", "good evening", "good night", "gm", "gn",
              "thanks", "thank you", "thankyou", "thx", "ty", "ok", "okay", "cool",
              "nice", "lol", "great", "bye", "goodbye", "how are you", "sup", "wassup"}
    _short = len(_stripped.split()) <= 5
    is_small_talk = (
        _stripped in _greet
        or (len(_stripped) <= 3 and _stripped.isalpha())
        or (question.strip() and all(not c.isalnum() for c in question.strip()))  # emoji-only
        or (_short and any(_stripped.startswith(g) for g in
                           ("thank", "thanks", "hi ", "hey ", "hello", "good morning",
                            "good evening", "good night", "namaste", "namaskar")))
    )

    # Detect language — by script when the classifier is down. Latin text is left as
    # "english": the reply's own language rule (chat._voice_rule) still tells the model
    # to answer in whatever the person actually wrote.
    language = script_language(question) or language

    # Detect tone
    if any(w in q for w in ["worried", "scared", "fear", "darr", "chinta"]):
        tone = "worried"
    elif any(w in q for w in ["when", "kab", "timing"]):
        question_type = "timing"
    elif any(w in q for w in ["should i", "kya"]):
        question_type = "should_i"
    elif any(w in q for w in ["why", "kyon"]):
        question_type = "why"

    # Detect topic and assign sections per system
    if system == "bphs":
        sections = _bphs_fallback(q)
    elif system == "kp":
        sections = _kp_fallback(q)
    elif system == "western":
        sections = _western_fallback(q)
    elif system == "chinese":
        sections = _chinese_fallback(q)
    elif system == "mandala":
        sections = _mandala_fallback(q)
    else:
        sections = ["dashas_full", "transits", "personality"]

    # Detect topic from keywords
    if any(w in q for w in ["marry", "married", "marriage", "shaadi", "spouse"]):
        topic = "marriage"
    elif any(w in q for w in ["career", "job", "work", "naukri"]):
        topic = "career"
    elif any(w in q for w in ["money", "wealth", "dhan", "invest"]):
        topic = "wealth"
    elif any(w in q for w in ["health", "disease", "sick"]):
        topic = "health"

    return {
        "topic": topic,
        "secondary_topic": None,
        "question_type": question_type,
        "emotional_tone": tone,
        "language": language,
        "register": "",
        "off_topic": False,
        "wants_astrology": False,
        "small_talk": is_small_talk,
        "intent_note": "",
        "showcase_feature": None,
        "showcase_system": None,
        "showcase_divination": None,
        "showcase_label": None,
        "sections": sections,
    }


def _bphs_fallback(q: str) -> list:
    if any(w in q for w in ["marry", "married", "marriage", "shaadi", "spouse", "wife", "husband"]):
        return ["dashas_full", "navamsa", "jaimini", "transits", "classical_rules"]
    elif any(w in q for w in ["career", "job", "work", "naukri", "profession"]):
        return ["dashas_full", "dasamsa", "transits", "yogas"]
    elif any(w in q for w in ["money", "wealth", "rich", "dhan", "paisa", "invest"]):
        return ["dashas_full", "transits", "classical_rules", "yogas"]
    elif any(w in q for w in ["health", "disease", "sick", "tabiyat"]):
        return ["medical", "afflictions", "dashas_full", "transits"]
    elif any(w in q for w in ["remedy", "upay", "gemstone", "mantra"]):
        return ["remedies", "afflictions", "transits"]
    elif any(w in q for w in ["today", "aaj", "current", "right now"]):
        return ["transits", "dashas_full", "prashna"]
    elif any(w in q for w in ["yoga", "yogas"]):
        return ["yogas", "dashas_full", "transits"]
    elif any(w in q for w in ["dasha", "period", "phase"]):
        return ["dashas_full", "transits", "yogas"]
    return ["personality", "dashas_full", "transits", "yogas"]


def _kp_fallback(q: str) -> list:
    if any(w in q for w in ["marry", "married", "marriage"]):
        return ["event_promise", "dba_timing", "transit_triggers", "cusps"]
    elif any(w in q for w in ["career", "job"]):
        return ["event_promise", "dba_timing", "significators", "transit_triggers"]
    return ["cusps", "significators", "ruling_planets", "dba_timing"]


def _western_fallback(q: str) -> list:
    if any(w in q for w in ["marry", "married", "relationship", "partner", "love"]):
        return ["aspects", "synastry", "progressions", "solar_return"]
    elif any(w in q for w in ["career", "job", "work"]):
        return ["aspects", "configurations", "progressions", "solar_return"]
    return ["aspects", "element_balance", "configurations", "progressions"]




def _mandala_fallback(q: str) -> list:
    if any(w in q for w in ["love", "partner", "marriage", "relationship", "soulmate"]):
        return ["relationship_geography", "best_cities", "parans"]
    elif any(w in q for w in ["danger", "avoid", "risky", "unsafe"]):
        return ["danger_zones", "best_cities", "relocation"]
    elif any(w in q for w in ["temple", "pray", "pilgrimage", "spiritual", "sacred", "tirth"]):
        return ["sacred_sites", "compass", "geodetic_zodiac"]

    elif any(w in q for w in ["migrate", "migration", "life plan", "when to move", "dasha", "phase"]):
        return ["migration_roadmap", "best_cities", "travel_windows"]
    elif any(w in q for w in ["state", "rajasthan", "maharashtra", "gujarat", "karnataka", "tamil", "kerala", "punjab", "bengal", "bihar"]):
        return ["country_year", "location_weather", "coordinate_mundane"]
    elif any(w in q for w in ["country", "nation", "india", "usa", "america", "uk", "china", "japan", "how will", "forecast", "2025", "2026", "2027"]):
        return ["country_year", "location_weather", "personal_mundane"]
    elif any(w in q for w in ["best city", "best", "city", "where should", "move", "relocate", "settle"]):
        return ["best_cities", "relocation", "compass", "travel_windows"]
    elif any(w in q for w in ["travel", "trip", "yatra", "journey"]):
        return ["travel_windows", "compass", "best_cities"]
    elif any(w in q for w in ["direction", "facing", "vastu", "compass"]):
        return ["compass", "here_now", "local_space"]
    elif any(w in q for w in ["here", "current", "this place", "location"]):
        return ["here_now", "coordinate_mundane", "compass"]


    elif any(w in q for w in ["eclipse", "grahan"]):
        return ["eclipse_geography", "power_map"]

    elif any(w in q for w in ["paran", "latitude", "band"]):
        return ["parans", "power_map"]
    elif any(w in q for w in ["map", "globe", "world", "scan", "planet"]):
        return ["globe_scan", "power_map", "geodetic_zodiac"]
    elif any(w in q for w in ["stock", "market", "bse", "nse", "nyse", "exchange", "bitcoin", "crypto"]):
        return ["country_year", "location_weather"]
    elif any(w in q for w in ["nato", "un", "united nations", "brics", "opec", "who", "imf"]):
        return ["country_year", "location_weather"]

    return ["power_map", "best_cities", "compass", "local_space", "geodetic_zodiac"]

def _chinese_fallback(q: str) -> list:
    if any(w in q for w in ["marry", "married", "relationship", "partner"]):
        return ["four_pillars", "day_master", "branch_interactions", "compatibility", "symbolic_stars"]
    elif any(w in q for w in ["career", "job", "work"]):
        return ["four_pillars", "ten_gods", "luck_periods", "annual_luck"]
    return ["four_pillars", "day_master", "elements", "symbolic_stars", "branch_interactions"]
