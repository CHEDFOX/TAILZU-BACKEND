"""
WIDER LINES — the newer systems, speaking to a life-area from birth data.

The topic readings on Explore, and the feature readings reached from chat, were built on
three traditions: Vedic, Western and Chinese. This adds the systems from this series that
genuinely have something to say about a life-area — and only those. A calendar count has
no opinion about someone's sex life, and pretending otherwise would be padding.

WHY THE THREE-TRADITION FRAMING NEEDED FIXING TOO
─────────────────────────────────────────────────
Those readings instruct the model to "read where they CONVERGE and let their combined
verdict guide you". But Vedic and Western read THE SAME PLANETARY POSITIONS — the same
sky, measured from a different zero point. Their agreement about a person is substantially
structural, not three independent witnesses arriving together.

Chinese is genuinely different: it reads a calendrical encoding, no planets at all. So are
the additions here that rest on nothing astronomical. `independence_note()` states this,
so the reading leans on the agreement that means something and does not manufacture a
chorus out of one sky read twice.

MATCHING SYSTEM TO TOPIC
────────────────────────
  every topic   Human Design      how they are built to engage and decide
                Tibetan forces    windhorse, life-force — momentum and vitality
  career/money  Ba Zhai           the directions that support them
                lunation          how they characteristically begin and finish
  desire/sex    lunar mansion     the Moon's mansion and its nature
                evolutionary      the entrenched pattern and the way out
  health        prakriti          constitution, as an estimate from the chart
"""
import datetime
from typing import Dict, List



def _date(b) -> datetime.date:
    return datetime.date(int(b["year"]), int(b.get("month", 1)), int(b.get("day", 1)))


def _dt(b) -> datetime.datetime:
    return datetime.datetime(int(b["year"]), int(b.get("month", 1)), int(b.get("day", 1)),
                             int(b.get("hour", 12)), int(b.get("minute", 0)))


def _latlng(b):
    lat = b.get("lat", b.get("latitude"))
    lng = b.get("lng", b.get("longitude"))
    return float(lat if lat is not None else 28.6), float(lng if lng is not None else 77.2)


def _gender(b) -> str:
    g = str((b or {}).get("gender", "") or "").lower()
    return "female" if g.startswith("f") else "male"


def _solar_year(b) -> int:
    y, m, d = int(b["year"]), int(b.get("month", 1)), int(b.get("day", 1))
    return y - 1 if (m < 2 or (m == 2 and d < 4)) else y


def _tropical(b) -> Dict[str, float]:
    try:
        from app.services.western.chart import WesternChart
        lat, lng = _latlng(b)
        wc = WesternChart(_dt(b), lat, lng)
        if hasattr(wc, "_ensure_calculated"):
            wc._ensure_calculated()
        out = {}
        for k, v in (wc.get_planets() or {}).items():
            lon = v.get("longitude") if isinstance(v, dict) else None
            if lon is not None:
                out[str(k).lower()] = float(lon)
        return out
    except Exception:
        return {}


# ── the lines ─────────────────────────────────────────────────────────────────────

def _human_design(b) -> str:
    from app.services.oracle.signatures_more import _hd_chart
    from app.services.modern import human_design as HD
    natal, design = _hd_chart(b)
    if not natal or not design:
        return ""
    c = HD.chart(natal, design)
    prof = (c.get("profile") or {}).get("profile")
    return (f"built to {c['strategy']}; decides from {c['authority'].lower()}"
            + (f"; profile {prof}" if prof else ""))


def _tibetan_forces(b) -> str:
    from app.services.regional import tibetan_thai as TT
    t = TT.tibetan_year(int(b["year"]), _gender(b))
    return (f"{t['sign']}, mewa {t['mewa']['number']} {t['mewa']['colour']} "
            f"({t['mewa']['meaning'].split(',')[0]}), parkha {t['parkha']['name']} "
            f"({t['parkha']['meaning'].split(',')[0]})")


def _bazhai(b) -> str:
    from app.services.chinese import fengshui as F
    g = F.gua_number(_solar_year(b), _gender(b))
    d = g["directions"]
    return (f"gua {g['gua']}, {g['group']} group; supported facing "
            f"{d['sheng_qi']['direction']} for advancement and "
            f"{d['tian_yi']['direction']} for recovery")


def _lunation(b) -> str:
    from app.services.western import lunation as L
    lons = _tropical(b)
    if "sun" not in lons or "moon" not in lons:
        return ""
    p = L.phase(lons["sun"], lons["moon"])
    return f"born at {p['phase']} — {p['keyword']}: {p['meaning'].split('.')[0]}"


def _mansion(b) -> str:
    from app.services.regional import mansions as M
    lons = _tropical(b)
    if "moon" not in lons:
        return ""
    m = M.mansion(lons["moon"])
    return f"Moon in {m['name']} ({m['meaning']}) — {m['nature']}"


def _evolutionary(b) -> str:
    from app.services.modern import evolutionary as EV
    lons = _tropical(b)
    p = lons.get("pluto")
    if p is None:
        return ""
    pp = EV.polarity_point(p)
    return (f"Pluto in {EV._sign(p)}, growth toward {pp['sign']} — the entrenched pull "
            f"and the way out of it")


def _prakriti(b) -> str:
    from app.services import ayurveda as A
    lons = _tropical(b)
    if not lons:
        return ""
    signs = {}
    from app.services.modern import evolutionary as EV
    for k, v in lons.items():
        signs[k] = EV._sign(v).lower()
    r = A.from_chart(signs, ascendant_sign=signs.get("sun", ""),
                     moon_sign=signs.get("moon", ""))
    if not r:
        return ""
    return (f"constitution leans {r['estimated_dominant']} "
            f"({', '.join(f'{k} {v}%' for k, v in r['percentages'].items())}) — an "
            f"estimate from the chart, not the classical examination")


# ── topic → which of them speak ───────────────────────────────────────────────────

_ALWAYS: List = [("How they engage", _human_design), ("Inner forces", _tibetan_forces)]

_BY_TOPIC: Dict[str, List] = {
    "career":  _ALWAYS + [("Supported directions", _bazhai), ("Beginnings", _lunation)],
    "money":   _ALWAYS + [("Supported directions", _bazhai), ("Beginnings", _lunation)],
    "desire":  _ALWAYS + [("Lunar mansion", _mansion), ("Deep pattern", _evolutionary)],
    "sex":     _ALWAYS + [("Lunar mansion", _mansion), ("Deep pattern", _evolutionary)],
    "health":  _ALWAYS + [("Constitution", _prakriti)],
    "spirituality": _ALWAYS + [("Deep pattern", _evolutionary), ("Beginnings", _lunation)],
    "marriage": _ALWAYS + [("Lunar mansion", _mansion), ("Deep pattern", _evolutionary)],
    "compatibility": _ALWAYS + [("Lunar mansion", _mansion)],
}
_DEFAULT: List = _ALWAYS + [("Beginnings", _lunation), ("Deep pattern", _evolutionary)]


def wider_lines(birth: dict, topic: str = "") -> str:
    """The newer systems that speak to this life-area. Empty when none compute."""
    if not birth:
        return ""
    out: List[str] = []
    for label, fn in _BY_TOPIC.get((topic or "").lower(), _DEFAULT):
        try:
            v = fn(birth)
        except Exception:
            v = ""
        if v:
            out.append(f"{label}: {v}")
    return "; ".join(out)


INDEPENDENCE_NOTE = (
    "ON THEIR AGREEING — the Vedic and Western readings above rest on the SAME planetary "
    "positions, measured from a different zero point, so where those two agree that is one "
    "sky read twice and not two witnesses. The Chinese pillars and the calendar-derived "
    "lines read something else entirely and carry no planets at all. Lean on agreement "
    "BETWEEN those genuinely different kinds; never stack the sky-based ones into a chorus. "
    "Never name a system, never explain any of this — it only changes how sure you sound."
)
