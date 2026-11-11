"""
WIDER COUNCIL — the remaining engines, made routable.

Everything from this series that can be computed HONESTLY now joins the bus, in three
kinds. The classifier picks whichever the question calls for; nothing is forced.

  NATAL     computed from birth data — Human Design, the Arabic lunar mansions,
            evolutionary astrology. These need an ephemeris, so each is written
            defensively: if the chart cannot be built the system simply drops out of the
            council rather than breaking the turn.

  MOMENT    computed from the instant the question is ASKED, which is what these methods
            are for — Qi Men Dun Jia, Da Liu Ren, Plum Blossom. They say nothing about a
            life; they answer a question posed now. Registering them means "should I take
            this job" can reach the traditions actually built for that shape of question.

  MUNDANE   about eras and markets, not people — Barbault, Bradley, Landscheidt, Tai Yi.
            Routable, because "what is happening in the world" is a real question, but the
            consensus engine already refuses them for personal scope, so a wrong pick
            cannot contaminate a personal reading.

The cast-and-report systems (Ifá, Liu Yao, dreams, the Ayurvedic examination, the
Enneagram) stay in CAST_SYSTEMS and are OFFERED, never computed from a birth date.
"""
import datetime
from typing import Dict

# ══════════════════════════════════════════════════════════════════════════════
# helpers
# ══════════════════════════════════════════════════════════════════════════════

def _dt(b) -> datetime.datetime:
    return datetime.datetime(int(b["year"]), int(b.get("month", 1)), int(b.get("day", 1)),
                             int(b.get("hour", 12)), int(b.get("minute", 0)))


def _latlng(b):
    lat = b.get("lat", b.get("latitude"))
    lng = b.get("lng", b.get("longitude"))
    return float(lat if lat is not None else 28.6), float(lng if lng is not None else 77.2)


def _tropical(b) -> Dict[str, float]:
    """{body: tropical longitude} from the Western chart. Empty when unavailable."""
    try:
        from app.services.western.chart import WesternChart
        lat, lng = _latlng(b)
        wc = WesternChart(_dt(b), lat, lng)
        if hasattr(wc, "_ensure_calculated"):
            wc._ensure_calculated()
        pl = wc.get_planets() or {}
        out = {}
        for k, v in pl.items():
            lon = v.get("longitude") if isinstance(v, dict) else None
            if lon is not None:
                out[str(k).lower()] = float(lon)
        return out
    except Exception:
        return {}


def _now_pillars():
    """Stem/branch for today and this hour, for the moment-based systems."""
    try:
        from app.services.chinese.bazi import BaZiChart
        ch = BaZiChart(datetime.datetime.now())
        p = ch.get_four_pillars() or {}
        return p
    except Exception:
        return {}


# ══════════════════════════════════════════════════════════════════════════════
# NATAL
# ══════════════════════════════════════════════════════════════════════════════

_HD_BODIES = ["sun", "moon", "mercury", "venus", "mars", "jupiter", "saturn",
              "uranus", "neptune", "pluto", "north_node", "south_node", "earth"]


def _hd_chart(b):
    """Human Design needs two charts: birth, and 88° of SOLAR ARC earlier.

    The design moment is found by stepping back until the Sun has moved 88°, not by
    subtracting 88 days — the arc is what defines it and the Sun's daily motion varies."""
    natal = _tropical(b)
    if "sun" not in natal:
        return None, None
    target = (natal["sun"] - 88.0) % 360.0
    base = _dt(b)
    lat, lng = _latlng(b)
    # ~0.9856°/day gives a close first guess; refine by bisection on the solar longitude.
    guess = base - datetime.timedelta(days=88.0 / 0.9856)
    try:
        from app.services.western.chart import WesternChart
        for _ in range(12):
            wc = WesternChart(guess, lat, lng)
            if hasattr(wc, "_ensure_calculated"):
                wc._ensure_calculated()
            s = (wc.get_planets() or {}).get("Sun") or (wc.get_planets() or {}).get("sun")
            if not s:
                return natal, None
            cur = float(s["longitude"])
            diff = ((target - cur + 180.0) % 360.0) - 180.0
            if abs(diff) < 0.01:
                break
            guess = guess + datetime.timedelta(days=diff / 0.9856)
        design = {}
        wc = WesternChart(guess, lat, lng)
        if hasattr(wc, "_ensure_calculated"):
            wc._ensure_calculated()
        for k, v in (wc.get_planets() or {}).items():
            lon = v.get("longitude") if isinstance(v, dict) else None
            if lon is not None:
                design[str(k).lower()] = float(lon)
        return natal, design
    except Exception:
        return natal, None


def _one_humandesign(b, name=""):
    from app.services.modern import human_design as HD
    natal, design = _hd_chart(b)
    if not natal or not design:
        return None
    c = HD.chart(natal, design)
    prof = c.get("profile") or {}
    return (f"{c['type']} · {c['authority']} authority"
            + (f" · profile {prof['profile']}" if prof.get("profile") else ""))


def _deep_humandesign(b, name=""):
    from app.services.modern import human_design as HD
    natal, design = _hd_chart(b)
    if not natal or not design:
        return None
    c = HD.chart(natal, design)
    gk = HD.gene_keys(c["personality"], c["design"])
    lines = [
        f"type: {c['type']} — strategy: {c['strategy']}",
        f"authority: {c['authority']} — {c['authority_detail']}",
        f"defined centres: {', '.join(c['defined_centers']) or 'none (Reflector)'}",
        f"open centres: {', '.join(c['undefined_centers'])}",
        f"channels: {', '.join(ch['name'] for ch in c['channels']) or 'none'}",
    ]
    if c.get("profile"):
        p = c["profile"]
        lines.append(f"profile: {p['profile']} — {p['personality']['name']} / "
                     f"{p['design']['name']}")
    if gk.get("spheres"):
        lines.append("gene keys: " + ", ".join(
            f"{s['sphere']} gate {s['gate']}.{s['line']}" for s in gk["spheres"]))
    lines.append(c["provenance"])
    return "\n".join(lines)


def _one_mansions(b, name=""):
    from app.services.regional import mansions as M
    lons = _tropical(b)
    if "moon" not in lons:
        return None
    m = M.mansion(lons["moon"])
    return f"mansion {m['number']}/28 — {m['name']} ({m['meaning']}): {m['nature']}"


def _deep_mansions(b, name=""):
    from app.services.regional import mansions as M
    lons = _tropical(b)
    if "moon" not in lons:
        return None
    m = M.mansion(lons["moon"])
    out = [f"Moon in mansion {m['number']} of 28 — {m['name']} ({m['meaning']})",
           f"nature: {m['nature']}",
           f"span {m['span_start']:.2f}°–{m['span_end']:.2f}°, "
           f"{m['degrees_into']:.2f}° in",
           m["note"]]
    if "sun" in lons:
        s = M.mansion(lons["sun"])
        out.append(f"Sun in mansion {s['number']} — {s['name']}")
    return "\n".join(out)


def _one_evolutionary(b, name=""):
    from app.services.modern import evolutionary as EV
    lons = _tropical(b)
    if "pluto" not in lons:
        return None
    pp = EV.polarity_point(lons["pluto"])
    return f"Pluto in {EV._sign(lons['pluto'])} — polarity toward {pp['sign']}"


def _deep_evolutionary(b, name=""):
    from app.services.modern import evolutionary as EV
    lons = _tropical(b)
    pluto = lons.get("pluto")
    node = lons.get("north_node", lons.get("true_node", lons.get("rahu")))
    if pluto is None:
        return None
    sn = (float(node) + 180.0) % 360.0 if node is not None else (pluto + 180.0) % 360.0
    r = EV.paradigm(pluto, 1, sn, 1)
    return "\n".join([
        f"Pluto in {r['pluto']['sign']} — {r['pluto']['evolutionary_intention']}",
        f"polarity point: {r['pluto']['polarity_point']['sign']} — "
        f"{r['pluto']['polarity_point']['meaning']}",
        f"South Node in {r['south_node']['sign']} (ruler {r['south_node']['ruler']}) — "
        f"{r['south_node']['meaning']}",
        f"North Node in {r['north_node']['sign']} (ruler {r['north_node']['ruler']}) — "
        f"{r['north_node']['meaning']}",
        r["not_predictive"],
    ])


# ══════════════════════════════════════════════════════════════════════════════
# MOMENT — these read WHEN THE QUESTION IS ASKED, not the birth
# ══════════════════════════════════════════════════════════════════════════════

_TERM_BY_MONTH = {1: "小寒", 2: "立春", 3: "驚蟄", 4: "清明", 5: "立夏", 6: "芒種",
                  7: "小暑", 8: "立秋", 9: "白露", 10: "寒露", 11: "立冬", 12: "大雪"}
_MG_BY_MONTH = {1: "冬至", 2: "大寒", 3: "雨水", 4: "春分", 5: "穀雨", 6: "小滿",
                7: "夏至", 8: "大暑", 9: "處暑", 10: "秋分", 11: "霜降", 12: "小雪"}
_STEMS = ["甲", "乙", "丙", "丁", "戊", "己", "庚", "辛", "壬", "癸"]
_BRANCHES = ["子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥"]


def _now_sb():
    """Day and hour stem-branch for right now, from the day-count reference."""
    now = datetime.datetime.now()
    delta = (now.date() - datetime.date(1900, 1, 1)).days
    ds, db = _STEMS[delta % 10], _BRANCHES[(delta + 4) % 12]
    hb = _BRANCHES[(((now.hour + 1) // 2) % 12)]
    hs = _STEMS[((_STEMS.index(ds) % 5) * 2 + _BRANCHES.index(hb)) % 10]
    return ds, db, hs, hb, now


def _one_qimen(b, name=""):
    from app.services.chinese import qimen as Q
    ds, db, hs, hb, now = _now_sb()
    c = Q.chart(_TERM_BY_MONTH[now.month], ds, db, hs, hb)
    if not c:
        return None
    dc = c["duty_chief"]
    return (f"{c['selection']['label']} — duty chief {dc['star']} in palace "
            f"{dc['landed_palace']}")


def _deep_qimen(b, name=""):
    from app.services.chinese import qimen as Q
    ds, db, hs, hb, now = _now_sb()
    c = Q.chart(_TERM_BY_MONTH[now.month], ds, db, hs, hb)
    if not c:
        return None
    return (Q.summary(c) + "\n"
            "Reads THIS MOMENT, not the birth — where and when to act. Solar term is "
            "approximated from the calendar month; a chart cast within a day of a term "
            "boundary may use the wrong ju.")


def _one_daliuren(b, name=""):
    from app.services.chinese import daliuren as D
    ds, db, hs, hb, now = _now_sb()
    c = D.chart(_MG_BY_MONTH[now.month], ds, db, hb, 6 <= now.hour < 18)
    if not c:
        return None
    t = c["three_transmissions"]
    if t.get("resolved"):
        return (f"three transmissions {t['initial']['branch']} → {t['middle']['branch']} "
                f"→ {t['final']['branch']}")
    return f"four lessons cast; transmissions unresolved ({t['method']})"


def _deep_daliuren(b, name=""):
    from app.services.chinese import daliuren as D
    ds, db, hs, hb, now = _now_sb()
    c = D.chart(_MG_BY_MONTH[now.month], ds, db, hb, 6 <= now.hour < 18)
    if not c:
        return None
    return D.summary(c) + "\nReads the moment the question was asked, not the birth."


def _one_meihua(b, name=""):
    from app.services.chinese import meihua as M
    now = datetime.datetime.now()
    r = M.cast(now.month + now.day, now.day + now.hour, now.minute)
    return (f"{r['hexagram']['chinese']} — {r['verdict']}")


def _deep_meihua(b, name=""):
    from app.services.chinese import meihua as M
    now = datetime.datetime.now()
    r = M.cast(now.month + now.day, now.day + now.hour, now.minute)
    return (M.summary(r) + "\nCast from the moment, not the birth. Any two numbers serve, "
            "so the method offers no guard against re-asking until the answer pleases.")


# ══════════════════════════════════════════════════════════════════════════════
# MUNDANE — eras, not people. Scope-guarded downstream.
# ══════════════════════════════════════════════════════════════════════════════

def _outer_now() -> Dict[str, float]:
    try:
        from app.services.western.chart import WesternChart
        wc = WesternChart(datetime.datetime.now(), 28.6, 77.2)
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


def _one_barbault(b, name=""):
    from app.services.mundane import barbault as B
    lons = _outer_now()
    r = B.cyclic_index(lons)
    if "error" in r:
        return None
    return f"cyclic index {r['index']:.0f}/1800 — {r['clustering']}"


def _deep_barbault(b, name=""):
    from app.services.mundane import barbault as B
    lons = _outer_now()
    r = B.cyclic_index(lons)
    if "error" in r:
        return None
    pairs = B.all_pairs(lons)[:4]
    return (B.summary(r) + "\n" + "\n".join(
        f"  {p['pair']} ({p['period']}): {p['phase']}" for p in pairs))


def _one_bradley(b, name=""):
    from app.services.mundane import bradley as BR
    lons = _outer_now()
    if len(lons) < 5:
        return None
    r = BR.siderograph(lons)
    return f"siderograph {r['siderograph']:+.2f} — turning points, not direction"


def _deep_bradley(b, name=""):
    from app.services.mundane import bradley as BR
    lons = _outer_now()
    if len(lons) < 5:
        return None
    r = BR.siderograph(lons)
    return BR.summary(r) + "\nMUNDANE/market scope. Not established; see its limitations."


def _one_landscheidt(b, name=""):
    from app.services.mundane import landscheidt as LS
    # Distances are needed as well as longitudes; approximate with mean radii when the
    # chart supplies only longitude, and say so.
    lons = _outer_now()
    means = {"jupiter": 5.203, "saturn": 9.537, "uranus": 19.19, "neptune": 30.07}
    pos = {k: {"longitude": lons[k], "distance": d} for k, d in means.items() if k in lons}
    if len(pos) < 3:
        return None
    r = LS.barycentre(pos)
    return (f"Sun {r['sun_distance_solar_radii']:.2f} solar radii from the barycentre "
            f"({'outside' if r['outside_photosphere'] else 'inside'} the photosphere)")


def _deep_landscheidt(b, name=""):
    from app.services.mundane import landscheidt as LS
    lons = _outer_now()
    means = {"jupiter": 5.203, "saturn": 9.537, "uranus": 19.19, "neptune": 30.07}
    pos = {k: {"longitude": lons[k], "distance": d} for k, d in means.items() if k in lons}
    if len(pos) < 3:
        return None
    r = LS.barycentre(pos)
    return (LS.summary(r) + "\nDistances approximated by mean orbital radii, so the offset "
            "is indicative rather than exact.\n" + LS.HYPOTHESIS["honest_summary"])


def _one_taiyi(b, name=""):
    from app.services.chinese import taiyi as T
    c = T.chart(datetime.datetime.now().year, epoch_year=1984)
    return f"太乙 in {c['taiyi']['palace_name']} — favours the {c['favoured']}"


def _deep_taiyi(b, name=""):
    from app.services.chinese import taiyi as T
    c = T.chart(datetime.datetime.now().year, epoch_year=1984)
    return T.summary(c) + "\nEpoch 1984 assumed; sources disagree and the chart is valid "\
                          "only against the epoch stated."


# ══════════════════════════════════════════════════════════════════════════════
# REGISTRATION
# ══════════════════════════════════════════════════════════════════════════════

MORE_SIGNS = {
    "humandesign": {
        "label": "Human Design",
        "aliases": ["human design", "humandesign", "bodygraph", "generator", "projector",
                    "manifestor", "reflector", "manifesting generator", "gene keys",
                    "authority", "hd type"],
        "facets": "type, strategy, authority, profile, defined_centres, channels, gene_keys",
        "one": _one_humandesign, "deep": _deep_humandesign, "method": "human_design",
    },
    "mansions": {
        "label": "Lunar mansions (manazil)",
        "aliases": ["lunar mansion", "lunar mansions", "manazil", "arabic mansions",
                    "28 mansions", "moon mansion"],
        "facets": "moon_mansion, sun_mansion, nature",
        "one": _one_mansions, "deep": _deep_mansions, "method": "lunar_mansions",
    },
    "evolutionary": {
        "label": "Evolutionary astrology",
        "aliases": ["evolutionary astrology", "soul astrology", "pluto polarity",
                    "south node past life", "jeff green", "steven forrest", "soul purpose"],
        "facets": "pluto_intention, polarity_point, south_node, north_node",
        "one": _one_evolutionary, "deep": _deep_evolutionary,
        "method": "evolutionary_astrology",
    },
    "qimen": {
        "label": "Qi Men Dun Jia (this moment)",
        "aliases": ["qi men", "qimen", "dun jia", "mysterious gates", "奇門遁甲",
                    "where should i go", "which direction"],
        "facets": "ju, duty_chief, duty_envoy, doors, stars, spirits",
        "one": _one_qimen, "deep": _deep_qimen, "method": "qimen_dunjia",
    },
    "daliuren": {
        "label": "Da Liu Ren (this moment)",
        "aliases": ["da liu ren", "liu ren", "大六壬", "four lessons",
                    "three transmissions"],
        "facets": "four_lessons, three_transmissions, twelve_generals",
        "one": _one_daliuren, "deep": _deep_daliuren, "method": "da_liu_ren",
    },
    "meihua": {
        "label": "Plum Blossom (this moment)",
        "aliases": ["plum blossom", "mei hua", "梅花易數", "shao yong"],
        "facets": "hexagram, ti_yong, verdict, changed",
        "one": _one_meihua, "deep": _deep_meihua, "method": "plum_blossom",
    },
    "barbault": {
        "label": "Barbault cyclic index (world)",
        "aliases": ["barbault", "cyclic index", "world crisis", "global outlook",
                    "mundane", "world situation"],
        "facets": "cyclic_index, clustering, pair_cycles",
        "one": _one_barbault, "deep": _deep_barbault, "method": "barbault_cyclic_index",
    },
    "bradley": {
        "label": "Bradley siderograph (markets)",
        "aliases": ["bradley", "siderograph", "market timing", "financial astrology",
                    "stock market"],
        "facets": "siderograph, components, turning_points",
        "one": _one_bradley, "deep": _deep_bradley, "method": "bradley_siderograph",
    },
    "landscheidt": {
        "label": "Solar barycentric (Landscheidt)",
        "aliases": ["landscheidt", "barycentre", "barycenter", "solar cycle",
                    "grand minimum", "sunspot"],
        "facets": "barycentre_offset, angular_momentum, hypothesis",
        "one": _one_landscheidt, "deep": _deep_landscheidt, "method": "landscheidt_torque",
    },
    "taiyi": {
        "label": "Tai Yi Shen Shu (era)",
        "aliases": ["tai yi", "taiyi", "太乙神數", "era", "dynasty", "state"],
        "facets": "taiyi_palace, host, guest, favoured",
        "one": _one_taiyi, "deep": _deep_taiyi, "method": "tai_yi",
    },
}

# Systems whose scope is NOT personal. The consensus engine already refuses them for
# personal questions by method scope; this list lets the pipeline label them too.
MUNDANE_IDS = {"barbault", "bradley", "landscheidt", "taiyi"}
MOMENT_IDS = {"qimen", "daliuren", "meihua"}


def register() -> Dict:
    """Add these to the wider-council bus. Idempotent."""
    from app.services.oracle import signatures as S

    added = []
    for sid, spec in MORE_SIGNS.items():
        if sid in S.SIGNS:
            continue
        S.SIGNS[sid] = spec
        added.append(sid)

    S.SIGNATURE_IDS = set(S.SIGNS)
    S.MINOR_SYSTEMS = {k: {"label": v["label"], "aliases": v["aliases"],
                           "sections": v["facets"]}
                       for k, v in S.SIGNS.items()}
    return {"added": added, "total": len(S.SIGNS)}
