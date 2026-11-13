"""
WIDER COUNCIL — adapters for the systems added in this series.

`signatures.SIGNS` is the plug-in bus the cross-system router reads: one entry per system,
with a one-line signature and a deep profile, both computed from birth data alone. Until
now the twenty-four engines built in this series were absent from it, which meant the
classifier could not route to them however relevant they were. They were reachable only by
direct API call.

This module supplies their adapters and registers them.

WHAT IS AND IS NOT REGISTERED HERE
──────────────────────────────────
Only systems that can be computed HONESTLY from a birth date. That excludes three kinds:

  CAST systems (Ifá, Liu Yao, Plum Blossom) require a physical throw. Deriving a cast
  from someone's birth date is not the tradition performed badly — it is a random number
  wearing the tradition's name, and it would corrupt the consensus by adding a witness
  that saw nothing. These are OFFERED to the user instead (see `CAST_SYSTEMS`).

  REPORT systems (dreams, the Ayurvedic examination, the Enneagram) need something only
  the user can supply — a dream, an examination, a self-identification.

  MUNDANE systems (Barbault, Bradley, Landscheidt, Tai Yi, Flying Star) are about eras,
  markets and buildings. The consensus engine already excludes them from personal
  questions by scope, and registering them here would fight that.

Refusing to fake these is what keeps the independence weighting meaningful. A council of
twenty systems where five are fabricated is worse than a council of fifteen that are real.
"""
import datetime
from typing import Dict, List, Optional

# ── Anchors that have no astronomical basis and must be set from an almanac ───────────
# The Pawukon is a pure count with no celestial anchor, so its phase can only be fixed
# from a reference date. ONE part of it is checkable, though: the seven-day saptawara
# corresponds exactly to the Gregorian weekday (Redite = Sunday … Saniscara = Saturday).
# That pins the offset modulo 7 — and the first value here failed it, putting a Friday on
# Buda (Wednesday) while the Javanese and Thai systems for the same date both correctly
# said Friday. 1 January 1900 was a Monday, so the offset must be ≡ 1 (mod 7).
#
# What is STILL unverified is the phase modulo 30 — which of the thirty wuku a date falls
# in. That needs a Balinese almanac and cannot be derived. The saptawara, pancawara-derived
# urip and the derived weeks are internally consistent; the wuku NAME may be offset by a
# whole number of weeks until someone checks it.
PAWUKON_EPOCH_OFFSET = 141      # ≡ 1 (mod 7): saptawara aligns with the weekday
PAWUKON_REFERENCE = datetime.date(1900, 1, 1)
# Enforced, because it silently failed once: saptawara index 0 is Redite (Sunday), so the
# offset must place the reference date on its true weekday.
assert PAWUKON_EPOCH_OFFSET % 7 == (PAWUKON_REFERENCE.weekday() + 1) % 7, (
    "PAWUKON_EPOCH_OFFSET puts the saptawara on the wrong weekday")

# The Javanese pasaran likewise has no astronomical anchor.
PASARAN_OFFSET = 2          # 1 Jan 1900 → Pahing, per common tables
WETON_DAY_OFFSET = 1        # 1 Jan 1900 was a Monday


def _date(b) -> datetime.date:
    return datetime.date(int(b["year"]), int(b["month"]), int(b["day"]))


def _days_since_1900(b) -> int:
    return (_date(b) - PAWUKON_REFERENCE).days


def _solar_year(b) -> int:
    """The Chinese solar year, which begins at Li Chun around 4 February.

    A January birth belongs to the PREVIOUS solar year. Using the Gregorian year is the
    most common error in gua calculation and it moves every early-year birth."""
    y, m, d = int(b["year"]), int(b["month"]), int(b["day"])
    return y - 1 if (m < 2 or (m == 2 and d < 4)) else y


def _gender(b) -> str:
    g = str((b or {}).get("gender", "") or "").lower()
    return "female" if g.startswith("f") else "male"


# ══════════════════════════════════════════════════════════════════════════════
# ONE-LINERS
# ══════════════════════════════════════════════════════════════════════════════

def _one_weton(b, name=""):
    from app.services.regional import weton as W
    n = _days_since_1900(b)
    w = W.weton(n + WETON_DAY_OFFSET, n + PASARAN_OFFSET)
    return f"{w['name']} — neptu {w['neptu']['total']}"


def _one_pawukon(b, name=""):
    from app.services.regional import pawukon as PW
    d = PW.from_ordinal(_days_since_1900(b), PAWUKON_EPOCH_OFFSET)
    w = d["weeks"]
    return f"wuku {d['wuku']['name']} · {w['saptawara']} {w['pancawara']} · {w['dasawara']}"


def _one_tibetan(b, name=""):
    from app.services.regional import tibetan_thai as TT
    t = TT.tibetan_year(int(b["year"]), _gender(b))
    return (f"{t['sign']} · mewa {t['mewa']['number']} {t['mewa']['colour']} · "
            f"parkha {t['parkha']['name']}")


def _one_thai(b, name=""):
    from app.services.regional import tibetan_thai as TT
    wd = (_date(b).weekday() + 1) % 7        # python Monday=0 → Sunday=0
    t = TT.thai_day(wd)
    return f"{t['deva']} ({t['planet']}) — {t['colour']}"


def _one_bazhai(b, name=""):
    from app.services.chinese import fengshui as F
    g = F.gua_number(_solar_year(b), _gender(b))
    d = g["directions"]
    return (f"gua {g['gua']} {g['trigram']} · {g['group']} group · "
            f"best direction {d['sheng_qi']['direction']}")


# ══════════════════════════════════════════════════════════════════════════════
# DEEP PROFILES
# ══════════════════════════════════════════════════════════════════════════════

def _deep_weton(b, name=""):
    from app.services.regional import weton as W
    n = _days_since_1900(b)
    w = W.weton(n + WETON_DAY_OFFSET, n + PASARAN_OFFSET)
    good = W.good_days(w["neptu"]["total"])
    return "\n".join([
        f"weton: {w['name']}",
        f"neptu: {w['neptu']['total']} ({w['neptu']['day']} day + "
        f"{w['neptu']['pasaran']} pasaran)",
        f"favoured days: {', '.join(good['favoured'][:6])}",
        f"avoided days: {', '.join(good['avoided'][:6])}",
        "note: pure arithmetic on two calendar cycles — reads nothing astronomical",
    ])


def _deep_pawukon(b, name=""):
    from app.services.regional import pawukon as PW
    d = PW.from_ordinal(_days_since_1900(b), PAWUKON_EPOCH_OFFSET)
    w = d["weeks"]
    lines = [f"wuku: {d['wuku']['name']} ({d['wuku']['index']} of 30)",
             f"day {d['pawukon_day']} of the 210-day cycle",
             f"seven-day: {w['saptawara']} · five-day: {w['pancawara']} "
             f"(urip {d['urip']['total']})",
             f"three-day: {w['triwara']} · six-day: {w['sadwara']} · "
             f"ten-day: {w['dasawara']}",
             f"irregular weeks: catur {w['caturwara']} · asta {w['astawara']} · "
             f"sanga {w['sangawara']}"]
    if d.get("note"):
        lines.append(d["note"])
    return "\n".join(lines)


def _deep_tibetan(b, name=""):
    from app.services.regional import tibetan_thai as TT
    y = int(b["year"])
    t = TT.tibetan_year(y, _gender(b))
    # `forces` used to be five fixed description strings; it is now computed, so each
    # value is a dict carrying the force's element and its state for the year.
    forces = t.get("forces") or {}
    rendered = "; ".join(
        f"{k} ({v['element']}, {v['state']})" if isinstance(v, dict) else f"{k} — {v}"
        for k, v in forces.items())
    lines = [
        f"sign: {t['sign']}",
        f"mewa: {t['mewa']['number']} {t['mewa']['colour']} — {t['mewa']['meaning']}",
        f"parkha: {t['parkha']['name']} ({t['parkha']['element']}) — "
        f"{t['parkha']['meaning']}",
        f"the five forces: {rendered}",
    ]
    try:
        ff = TT.five_forces(y)
        weak = ff["most_exposed"]
        lines.append(f"most exposed: {weak} — {ff['forces'][weak]['read']}")
    except Exception:
        pass
    lines.append(t["caveat"])
    return "\n".join(lines)


def _deep_thai(b, name=""):
    from app.services.regional import tibetan_thai as TT
    wd = (_date(b).weekday() + 1) % 7
    t = TT.thai_day(wd)
    return "\n".join([
        f"day-lord: {t['deva']} ({t['planet']}), {t['lord_index']} of {t['of']}",
        f"colour: {t['colour']}",
        f"birthday Buddha: {t['birthday_buddha']}",
        t["note"],
    ])


def _deep_bazhai(b, name=""):
    from app.services.chinese import fengshui as F
    g = F.gua_number(_solar_year(b), _gender(b))
    d = g["directions"]
    good = [f"{d[k]['direction']} {d[k]['name']}" for k in
            ("sheng_qi", "tian_yi", "yan_nian", "fu_wei")]
    bad = [f"{d[k]['direction']} {d[k]['name']}" for k in
           ("huo_hai", "wu_gui", "liu_sha", "jue_ming")]
    return "\n".join([
        f"gua: {g['gua']} ({g['trigram']} {g['chinese']}), {g['element']}",
        f"group: {g['group']} — compatible with gua {g['compatible_group']}",
        "favourable: " + " · ".join(good),
        "unfavourable: " + " · ".join(bad),
        g["note"],
    ])


# ══════════════════════════════════════════════════════════════════════════════
# REGISTRATION
# ══════════════════════════════════════════════════════════════════════════════

EXTENDED_SIGNS = {
    "weton": {
        "label": "Weton (Java)",
        "aliases": ["weton", "neptu", "javanese", "pasaran", "primbon", "jodoh"],
        "facets": "weton, neptu, favoured_days, compatibility",
        "one": _one_weton, "deep": _deep_weton,
        "method": "weton",
    },
    "pawukon": {
        "label": "Pawukon (Bali)",
        "aliases": ["pawukon", "wuku", "balinese", "bali", "kajeng kliwon"],
        "facets": "wuku, ten_concurrent_weeks, urip",
        "one": _one_pawukon, "deep": _deep_pawukon,
        "method": "pawukon",
    },
    "thai": {
        "label": "Thai Horasat",
        "aliases": ["thai", "horasat", "thai astrology", "birthday buddha", "day colour"],
        "facets": "day_lord, deva, colour, birthday_buddha",
        "one": _one_thai, "deep": _deep_thai,
        "method": "thai_horasat",
    },
    "bazhai": {
        "label": "Ba Zhai (Eight Mansions)",
        "aliases": ["ba zhai", "bazhai", "eight mansions", "gua number", "kua number",
                    "feng shui", "best direction", "sleeping direction"],
        "facets": "gua, group, favourable_directions, unfavourable_directions",
        "one": _one_bazhai, "deep": _deep_bazhai,
        "method": "ba_zhai",
    },
}


# ── Systems that must NOT be auto-computed, and what to do instead ───────────────────
CAST_SYSTEMS = {
    "ifa": {
        "label": "Ifá",
        "needs": "a cast — the ọ̀pẹ̀lẹ̀ chain or sixteen ikin",
        "offer": "There is a West African casting tradition that speaks to this. It needs "
                 "a throw rather than your birth data — would you like to cast?",
        "method": "ifa_cast",
        "why_not_auto": ("Deriving a cast from a birth date is not Ifá done badly — it is "
                         "a random number wearing the tradition's name, and it would add "
                         "a witness to the council that saw nothing."),
    },
    "liuyao": {
        "label": "Liu Yao",
        "needs": "a hexagram cast — six coin throws",
        "offer": "There is a Chinese method that answers a question directly, but it needs "
                 "a cast rather than your chart — shall we throw?",
        "method": "liu_yao",
        "why_not_auto": "The hexagram must come from a cast made for this question.",
    },
    "dreams": {
        "label": "Dream interpretation",
        "needs": "a dream to interpret",
        "offer": "If you tell me the dream, several traditions have something to say about "
                 "it.",
        "method": "oneiromancy",
        "why_not_auto": "Nothing to read without a dream report.",
    },
    "prakriti": {
        "label": "Ayurvedic constitution",
        "needs": "the examination — build, skin, digestion, sleep, temperament",
        "offer": "Your constitution can be estimated from the chart, but Ayurveda settles "
                 "it by examination. Eight quick questions would give a real answer.",
        "method": "prakriti",
        "why_not_auto": ("The classical determination is by examination. A chart estimate "
                         "exists and is offered as such, never as the person's prakriti."),
    },
    "enneagram": {
        "label": "Enneagram",
        "needs": "self-identification of type",
        "offer": "The Enneagram isn't computed from a birth moment — it's identified. If "
                 "you know your type, I can work with it.",
        "method": "enneagram",
        "why_not_auto": "Type is established by self-identification, not derived.",
    },
}


# Systems already on the bus whose adapters this module IMPROVES rather than duplicates.
# `tibetan` already computes the animal and element from the birth year; the nag-rtsis
# engine adds the mewa and parkha layers, which are what a Tibetan reading is actually
# about. Registering a second "tibetan_elemental" entry would give the classifier two
# near-identical systems for one tradition and compute the same year twice — so the
# existing entry is upgraded in place instead.
UPGRADES = {
    "tibetan": {
        "aliases": ["tibetan", "rabjung", "tibet", "nag rtsis", "jungtsi", "mewa",
                    "parkha", "windhorse", "lungta"],
        "facets": "animal, element, mewa, parkha, five_forces",
        "one": _one_tibetan, "deep": _deep_tibetan,
        "method": "tibetan_elemental",
    },
}


def register() -> Dict:
    """Add the extended systems to the wider-council bus, and upgrade the overlapping one.

    Idempotent — safe to call more than once."""
    from app.services.oracle import signatures as S

    added = []
    for sid, spec in EXTENDED_SIGNS.items():
        if sid in S.SIGNS:
            continue
        S.SIGNS[sid] = spec
        added.append(sid)

    upgraded = []
    for sid, spec in UPGRADES.items():
        if sid not in S.SIGNS:
            continue
        if S.SIGNS[sid].get("method") == spec.get("method"):
            continue                       # already upgraded
        S.SIGNS[sid] = {**S.SIGNS[sid], **spec}
        upgraded.append(sid)

    # Keep the derived views in step with SIGNS.
    S.SIGNATURE_IDS = set(S.SIGNS)
    S.MINOR_SYSTEMS = {k: {"label": v["label"], "aliases": v["aliases"],
                           "sections": v["facets"]}
                       for k, v in S.SIGNS.items()}
    return {"added": added, "upgraded": upgraded,
            "total_signature_systems": len(S.SIGNS)}


def cast_offer(sid: str) -> Optional[Dict]:
    """The offer text for a system that needs a user action."""
    return CAST_SYSTEMS.get(sid)


def relevant_cast_offers(question: str) -> List[Dict]:
    """Cast systems a question names or implies — offered, never auto-run."""
    q = (question or "").lower()
    out = []
    for sid, spec in CAST_SYSTEMS.items():
        if sid in q or any(a in q for a in (spec["label"].lower(),)):
            out.append({"id": sid, **spec})
        elif sid == "dreams" and ("dream" in q or "dreamt" in q or "dreamed" in q):
            out.append({"id": sid, **spec})
    return out
