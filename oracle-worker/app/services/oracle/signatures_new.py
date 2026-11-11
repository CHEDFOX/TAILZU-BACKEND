"""
WIDER COUNCIL, PART THREE — the six traditions added to close the breadth gap.

Same contract as signatures.py and signatures_more.py: `one` returns a single line for the
council, `deep` returns a short list of lines for a full profile. Everything is written
defensively — a system that cannot compute drops out of the council rather than taking
the turn down with it, which matters more here than usual because four of these six need
the lunisolar calendar or a horizon calculation.

TWO OF THEM ARE DELIBERATELY NOT NATAL, and the router needs to know it:

  ONMYODO judges DAYS. It is a day-selection art and has no natal doctrine; what it can
  honestly say about a birth is what the almanac would have marked that day as. Presented
  that way rather than dressed up as a character reading.

  ANDEAN has no securely recorded way of reading a person from a birth date at all. It
  gives the season and the cosmological frame, and says so. The temptation to invent a
  twelve-sign Inca zodiac to fill the slot is exactly the thing this platform exists not
  to do.

Isopsephy and abjad are NAME systems, not birth systems — they need text, and they return
nothing useful without it. They are registered so that "what does my name add up to in
Greek" can reach them, and they fall silent when there is no name.
"""
from typing import Dict


def _int(b, key, default=0):
    try:
        return int(b.get(key, default))
    except (TypeError, ValueError):
        return int(default)


def _latlng(b):
    lat = b.get("lat", b.get("latitude"))
    lng = b.get("lng", b.get("longitude"))
    return (float(lat) if lat is not None else 28.6,
            float(lng) if lng is not None else 77.2)


def _age(b) -> float:
    import datetime
    try:
        born = datetime.date(_int(b, "year", 2000), _int(b, "month", 1), _int(b, "day", 1))
        return (datetime.date.today() - born).days / 365.2425
    except Exception:
        return 30.0


# ══════════════════════════════════════════════════════════════════════════════
# Onmyōdō
# ══════════════════════════════════════════════════════════════════════════════

def _one_onmyodo(b, name):
    from app.services.onmyodo.core import day
    d = day(_int(b, "year", 2000), _int(b, "month", 1), _int(b, "day", 1),
            _int(b, "hour", 12))
    return (f"born on a {d.rokuyo['name']} ({d.rokuyo['kanji']}) day — "
            f"{d.rokuyo['meaning']}; the officer was {d.junichoku['name']}")


def _deep_onmyodo(b, name):
    from app.services.onmyodo.core import day
    d = day(_int(b, "year", 2000), _int(b, "month", 1), _int(b, "day", 1),
            _int(b, "hour", 12))
    return [
        f"Rokuyō {d.rokuyo['kanji']} {d.rokuyo['name']} — {d.rokuyo['meaning']}.",
        f"Jūnichoku {d.junichoku['kanji']} {d.junichoku['name']} — {d.junichoku['meaning']}.",
        f"Lunar mansion {d.shuku['kanji']} {d.shuku['name']}; day pillar {d.day_pillar} "
        f"({d.nayin}).",
        "Onmyōdō judges days rather than birth charts — this is the quality of the day "
        "itself, which is the only claim the tradition actually makes.",
    ]


# ══════════════════════════════════════════════════════════════════════════════
# Firdaria
# ══════════════════════════════════════════════════════════════════════════════

def _firdaria(b):
    from app.services.persian.core import report
    lat, lng = _latlng(b)
    return report(_int(b, "year", 2000), _int(b, "month", 1), _int(b, "day", 1),
                  _int(b, "hour", 12), _int(b, "minute", 0), lat, lng,
                  tz_offset_hours=float(b.get("tz_offset_hours", 0.0)),
                  current_age=_age(b))


def _one_firdaria(b, name):
    r = _firdaria(b)
    c = r.get("current") or {}
    sub = f"/{c.get('sub_lord')}" if c.get("sub_lord") else ""
    return (f"firdaria lord {c.get('lord', '?')}{sub} until age "
            f"{c.get('to_age', '?')} — {c.get('meaning', '')}")


def _deep_firdaria(b, name):
    r = _firdaria(b)
    c = r.get("current") or {}
    sect = r.get("sect", {})
    # Sect rides INSIDE the period line, not above it as a preamble. Firdaria has no
    # meaning without it — day and night birth run different orders of lords, so "you are
    # in Mars" is only true given one of them. As a standalone opening line it was
    # skippable, and it got skipped: asked which period they were in, the reply named the
    # lord and the sub-lord and never said which sequence they came from. Now the fact
    # cannot be stated without the thing that makes it true.
    _sect = 'day' if sect.get('is_day_birth') else 'night'
    out = [
        f"A {_sect} birth (Sun {sect.get('sun_altitude')}° from the horizon). Day and night "
        f"births run DIFFERENT orders of lords, so this one fact sets the whole sequence "
        f"below — it is not background, it is what makes the reading true.",
        f"Current period: {c.get('lord')} — {c.get('meaning')} "
        f"({c.get('lord')} rules here because this is a {_sect} birth)",
    ]
    if c.get("sub_lord"):
        out.append(f"Within it, the sub-period of {c.get('sub_lord')}: {c.get('sub_meaning')}")
    nxt = [m for m in r.get("major_periods", []) if m["from_age"] > r.get("age", 0)]
    if nxt:
        n = nxt[0]
        out.append(f"Next lord {n['lord']} from age {n['from_age']:g} — {n['meaning']}")
    if sect.get("marginal"):
        out.append("Note: the Sun was within a degree of the horizon, so the sect — and "
                   "therefore the whole sequence — is genuinely uncertain here.")
    return out


# ══════════════════════════════════════════════════════════════════════════════
# Polynesian
# ══════════════════════════════════════════════════════════════════════════════

def _one_polynesian(b, name):
    from app.services.polynesian.core import night_of
    n = night_of(_int(b, "year", 2000), _int(b, "month", 1), _int(b, "day", 1))
    return f"the night of {n['name']} ({n['anahulu']}) — {n['meaning']}"


def _deep_polynesian(b, name):
    from app.services.polynesian.core import night_of
    n = night_of(_int(b, "year", 2000), _int(b, "month", 1), _int(b, "day", 1))
    out = [
        f"Hawaiian night {n['night']} of 30 — {n['name']}: {n['meaning']}.",
        f"It falls in the {n['anahulu']} anahulu — {n['anahulu_meaning']}.",
    ]
    par = n.get("maori_parallel")
    if par:
        out.append(f"Māori parallel {par['name']} — {par['meaning']}. ({par['caveat']})")
    return out


# ══════════════════════════════════════════════════════════════════════════════
# Andean
# ══════════════════════════════════════════════════════════════════════════════

def _one_andean(b, name):
    from app.services.andean.core import andean_date
    d = andean_date(_int(b, "year", 2000), _int(b, "month", 1), _int(b, "day", 1))
    return f"the month of {d.month_name} — {d.month_gloss}; {d.solar_note}"


def _deep_andean(b, name):
    from app.services.andean.core import birth
    r = birth(_int(b, "year", 2000), _int(b, "month", 1), _int(b, "day", 1))
    return [
        f"{r['month']} — {r['meaning']}. Festival: {r['festival']}",
        f"The work of the month: {r['agriculture']}.",
        f"Solar position: {r['solar']}.",
        "Andean cosmology reads three worlds — Hanan Pacha above (the condor), Kay Pacha "
        "here (the puma), Uku Pacha within (the serpent).",
        r["caveat"],
    ]


# ══════════════════════════════════════════════════════════════════════════════
# Isopsephy and Abjad — name systems
# ══════════════════════════════════════════════════════════════════════════════

def _one_isopsephy(b, name):
    from app.services.numerology.greek import isopsephy
    txt = (name or b.get("name") or "").strip()
    if not txt:
        return ""
    r = isopsephy(txt)
    if not r.value:
        return ("isopsephy needs the name in Greek letters — Latin script carries no "
                "numeric value in this system")
    return f"isopsephy {r.value} — the {r.root_name}: {r.root_seed}"


def _deep_isopsephy(b, name):
    from app.services.numerology.greek import isopsephy
    txt = (name or b.get("name") or "").strip()
    if not txt:
        return []
    r = isopsephy(txt)
    if not r.value:
        return ["Isopsephy counts Greek letters. Written in Latin script a name has no "
                "isopsephic value — transliterate it into Greek first and the number is "
                "immediate."]
    return [
        f"ἰσοψηφία of {r.text} = {r.value}.",
        "Letters: " + ", ".join(f"{l}={v}" for l, v in r.letters),
        f"Digital root {r.reduced} — the {r.root_name}: {r.root_seed}",
    ]


def _one_abjad(b, name):
    from app.services.numerology.arabic import abjad
    txt = (name or b.get("name") or "").strip()
    if not txt:
        return ""
    r = abjad(txt)
    if not r.value:
        return ("abjad needs the name in Arabic letters — Latin script carries no numeric "
                "value in this system")
    tail = "" if r.orders_agree else f" (Maghribi order gives {r.value_maghribi})"
    return f"abjad {r.value}{tail} — dominant element {r.dominant_element}"


def _deep_abjad(b, name):
    from app.services.numerology.arabic import abjad
    txt = (name or b.get("name") or "").strip()
    if not txt:
        return []
    r = abjad(txt)
    if not r.value:
        return ["Abjad counts Arabic letters. In Latin script a name has no abjad value — "
                "write it in Arabic and the number follows."]
    out = [
        f"حساب الجمل of {r.text} = {r.value} in the Mashriqi (eastern) order.",
        "Letters: " + ", ".join(f"{l}={v}" for l, v in r.letters),
        f"Digital root {r.reduced}; dominant element {r.dominant_element} — "
        f"{r.element_seed}",
    ]
    if not r.orders_agree:
        out.append(f"In the Maghribi (western) order the same name gives "
                   f"{r.value_maghribi}. Both are legitimate; a value quoted without its "
                   f"order is not checkable.")
    return out


# ══════════════════════════════════════════════════════════════════════════════
# registration
# ══════════════════════════════════════════════════════════════════════════════

# ══════════════════════════════════════════════════════════════════════════════
# The East Asian pillar and star traditions, as their own systems
# ══════════════════════════════════════════════════════════════════════════════
# Counted separately from BaZi and Zi Wei because history counted them separately, and
# because in each case something the chart depends on genuinely differs — Korea's clock
# runs on a meridian that misses the country, Vietnam's calendar parts from China's, and
# Japan reads the month's hidden stem by depth rather than taking the principal one.

def _one_saju(b, name):
    from app.services.korean.saju import saju
    s = saju(_int(b, "year", 2000), _int(b, "month", 1), _int(b, "day", 1),
             _int(b, "hour", 12), _int(b, "minute", 0), b.get("gender") or "male")
    return (f"일간 {s.day_master['korean']} {s.day_master['element_ko']}, {s.strength} — "
            f"{s.gyeokguk['korean']}")


def _deep_saju(b, name):
    from app.services.korean.saju import saju
    s = saju(_int(b, "year", 2000), _int(b, "month", 1), _int(b, "day", 1),
             _int(b, "hour", 12), _int(b, "minute", 0), b.get("gender") or "male")
    cur = next((d for d in s.daeun if d.get("current")), None)
    out = [
        s.summary(),
        f"Clock corrected by {s.time_correction['total_correction_minutes']} minutes "
        f"(Korea keeps UTC+9 on a meridian that misses the country) — without this the "
        f"hour pillar is wrong about half the time.",
    ]
    if cur:
        out.append(f"Current 대운: {cur['korean']} from age {cur['from_age']}.")
    return out


def _one_tojeong(b, name):
    from app.services.korean.tojeong import tojeong, UPPER
    t = tojeong(_int(b, "year", 2000), _int(b, "month", 1), _int(b, "day", 1))
    return f"토정비결 괘 {t.gwae} — {UPPER[t.upper][1]}"


def _deep_tojeong(b, name):
    from app.services.korean.tojeong import tojeong
    return tojeong(_int(b, "year", 2000), _int(b, "month", 1),
                   _int(b, "day", 1)).summary()


def _one_tuvi(b, name):
    from app.services.vietnamese.tuvi import tu_vi
    c = tu_vi(_int(b, "year", 2000), _int(b, "month", 1), _int(b, "day", 1),
              _int(b, "hour", 12), _int(b, "minute", 0), b.get("gender") or "male")
    life = next((p for p in c.palaces if p["english"] == "Life"), None)
    stars = ", ".join(s["vietnamese"] for s in (life or {}).get("stars", [])) or "vô chính diệu"
    return f"cung Mệnh: {stars} — {c.bureau['vietnamese']}"


def _deep_tuvi(b, name):
    from app.services.vietnamese.tuvi import tu_vi
    return tu_vi(_int(b, "year", 2000), _int(b, "month", 1), _int(b, "day", 1),
                 _int(b, "hour", 12), _int(b, "minute", 0),
                 b.get("gender") or "male").summary()


def _one_suimei(b, name):
    from app.services.japanese.suimei import suimei, TSUHENSEI
    s = suimei(_int(b, "year", 2000), _int(b, "month", 1), _int(b, "day", 1),
               _int(b, "hour", 12), _int(b, "minute", 0))
    return (f"日干 {s.day_master['kanji']}({s.day_master['element_ja']}) · "
            f"月支蔵干 {s.zokan['hanja']} {s.zokan['phase']} — "
            f"{TSUHENSEI[s.zokan['tsuhensei']][0]}")


def _deep_suimei(b, name):
    from app.services.japanese.suimei import suimei
    s = suimei(_int(b, "year", 2000), _int(b, "month", 1), _int(b, "day", 1),
               _int(b, "hour", 12), _int(b, "minute", 0))
    return [s.summary(),
            "The governing hidden stem is read by DEPTH into the solar month, which is "
            "the Japanese refinement — the same branch at a different day-count yields a "
            "different stem, and therefore a different chart from a BaZi reading."]


def _one_gematria(b, name):
    from app.services.numerology.hebrew_methods import all_methods
    txt = (name or b.get("name") or "").strip()
    if not txt:
        return ""
    r = all_methods(txt)
    if not r.values.get("hechrachi"):
        return ("gematria counts Hebrew letters — a name in Latin script has no value "
                "until it is written in Hebrew")
    return (f"gematria {r.values['hechrachi']} (Hechrachi), {r.values['katan']} (Katan), "
            f"Atbash {r.atbash}")


def _deep_gematria(b, name):
    from app.services.numerology.hebrew_methods import all_methods
    txt = (name or b.get("name") or "").strip()
    if not txt:
        return []
    r = all_methods(txt)
    if not r.values.get("hechrachi"):
        return ["Gematria counts Hebrew letters. Written in Latin script a name has no "
                "value — write it in Hebrew and every method resolves at once."]
    return [r.summary(),
            "A word is read across SEVERAL methods, not one. Two words equal under three "
            "or more is a strong reading; equal under one alone is a weak one, and the "
            "sources are explicit about the difference."]


NEW_SIGNS: Dict[str, dict] = {
    "gematria": {
        "label": "Gematria (all methods)",
        "aliases": ["gematria", "mispar", "atbash", "hechrachi", "gematria methods",
                    "hebrew numerology"],
        "facets": "gematria_methods, atbash, gematria_equivalence",
        "one": _one_gematria, "deep": _deep_gematria, "method": "gematria_multi",
    },
    "saju": {
        "label": "Saju Palja (Korean)",
        "aliases": ["saju", "사주", "saju palja", "palja", "korean astrology",
                    "korean four pillars", "myeongri"],
        "facets": "gyeokguk, yongsin, sipseong, daeun, sibiunseong",
        "one": _one_saju, "deep": _deep_saju, "method": "saju_palja",
    },
    "tojeong": {
        "label": "Tojeong Bigyeol (Korean almanac)",
        "aliases": ["tojeong", "토정비결", "tojeong bigyeol", "korean new year fortune",
                    "korean annual fortune"],
        "facets": "gwae, sanggwae, junggwae, hagwae",
        "one": _one_tojeong, "deep": _deep_tojeong, "method": "tojeong_bigyeol",
    },
    "tuvi": {
        "label": "Tử Vi Đẩu Số (Vietnamese)",
        "aliases": ["tu vi", "tử vi", "tuvi", "vietnamese astrology", "dau so",
                    "đẩu số", "vietnamese purple star"],
        "facets": "cung, chinh_tinh, cuc, tu_hoa",
        "one": _one_tuvi, "deep": _deep_tuvi, "method": "tu_vi_dau_so",
    },
    "suimei": {
        "label": "Shichū Suimei (Japanese)",
        "aliases": ["suimei", "shichu suimei", "四柱推命", "japanese four pillars",
                    "japanese astrology", "tsuhensei"],
        "facets": "zokan, tsuhensei, juniun, setsu_days",
        "one": _one_suimei, "deep": _deep_suimei, "method": "shichu_suimei",
    },
    "onmyodo": {
        "label": "Onmyōdō (Japanese almanac)",
        "aliases": ["onmyodo", "onmyoji", "rokuyo", "taian", "butsumetsu", "tomobiki",
                    "japanese almanac", "koyomi", "junichoku", "japanese calendar"],
        "facets": "rokuyo, junichoku, nijuhasshuku, nayin",
        "one": _one_onmyodo, "deep": _deep_onmyodo, "method": "onmyodo_koyomi",
    },
    "firdaria": {
        "label": "Firdaria (Persian time-lords)",
        "aliases": ["firdaria", "firdar", "fardar", "fardaria", "persian periods",
                    "time lord", "time-lord", "alfridaria", "persian system",
                    "persian astrology", "persian"],
        "facets": "sect, current_lord, sub_lord, period_sequence",
        "one": _one_firdaria, "deep": _deep_firdaria, "method": "firdaria",
    },
    "polynesian": {
        "label": "Polynesian moon nights",
        "aliases": ["polynesian", "hawaiian", "maramataka", "maori moon", "moon night",
                    "anahulu", "po", "hawaiian moon"],
        "facets": "night, anahulu, moon_age, maori_parallel",
        "one": _one_polynesian, "deep": _deep_polynesian, "method": "hawaiian_po",
    },
    "andean": {
        "label": "Andean / Inca wata",
        "aliases": ["andean", "inca", "inka", "quechua", "peruvian", "wata",
                    "inti raymi", "pachakuti"],
        "facets": "month, festival, solar_anchor, three_worlds",
        "one": _one_andean, "deep": _deep_andean, "method": "inca_wata",
    },
    "isopsephy": {
        "label": "Isopsephy (Greek)",
        "aliases": ["isopsephy", "greek numerology", "greek gematria", "isopsephia",
                    "greek letters", "in greek", "greek value"],
        "facets": "value, letters, digital_root",
        "one": _one_isopsephy, "deep": _deep_isopsephy, "method": "isopsephy",
    },
    "abjad": {
        "label": "Abjad (Arabic)",
        "aliases": ["abjad", "arabic numerology", "hisab al jummal", "jummal",
                    "arabic gematria"],
        "facets": "value, letters, element, maghribi_value",
        "one": _one_abjad, "deep": _deep_abjad, "method": "abjad",
    },
}

# Systems that judge a MOMENT or a season rather than a person. The pipeline labels these
# so a natal question is never answered as though they had spoken about a life.
NON_NATAL_IDS = {"onmyodo", "andean"}
# Systems that need a name in their own script and are silent without one.
NAME_IDS = {"isopsephy", "abjad"}


def register() -> Dict:
    """Add these to the wider-council bus. Idempotent."""
    from app.services.oracle import signatures as S

    added = []
    for sid, spec in NEW_SIGNS.items():
        if sid in S.SIGNS:
            continue
        S.SIGNS[sid] = spec
        added.append(sid)

    S.SIGNATURE_IDS = set(S.SIGNS)
    S.MINOR_SYSTEMS = {k: {"label": v["label"], "aliases": v["aliases"],
                           "sections": v["facets"]}
                       for k, v in S.SIGNS.items()}
    return {"added": added, "total": len(S.SIGNS)}
