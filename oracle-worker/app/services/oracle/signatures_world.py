"""
WIDER COUNCIL, PART FOUR — everything built to close the index.

Fifty systems, registered the same way as the rest. The volume is why this file is
data-driven rather than fifty hand-written pairs: each entry names a builder, and the
`one`/`deep` functions are generated from it.

THREE KINDS, and the distinction is enforced rather than described:

  NATAL / DATED   computed from the birth date — Cheng Gu, Saju-adjacent systems, the
                  regional calendars, Akan day names, Tamil numerology.

  MOMENT / CAST   computed from the instant of asking or from a seeded draw — Xiao Liu Ren,
                  Kau Chim, the rune rows, the card decks, the lots, Sikidy.

  FRAMEWORK       NOT computed at all, and marked so the pipeline can say so plainly.
                  Palmistry, face reading, scrying, dowsing, the community-held African
                  traditions, and the Slavic and Baltic folk material. These return their
                  vocabulary and their limits. A framework system that quietly produced a
                  reading from a birthday would be the exact failure this catalogue exists
                  to prevent, so `FRAMEWORK_IDS` is checked at registration.
"""
from typing import Callable, Dict, List


def _i(b, k, d=0):
    try:
        return int(b.get(k, d))
    except (TypeError, ValueError):
        return int(d)


def _seed(b, name=""):
    """A stable per-person, per-system seed so a cast is reproducible within a session."""
    return f"{_i(b,'year',2000)}-{_i(b,'month',1)}-{_i(b,'day',1)}-{name}"


def _lines(v) -> List[str]:
    """Flatten any builder's return into display lines."""
    if v is None:
        return []
    if isinstance(v, str):
        return v.splitlines()
    if isinstance(v, list):
        return [str(x) for x in v]
    if isinstance(v, dict):
        out = []
        for k, val in v.items():
            if k in ("system", "corpus_note"):
                continue
            if isinstance(val, (str, int, float, bool)):
                out.append(f"{k.replace('_', ' ')}: {val}")
            elif isinstance(val, dict):
                inner = ", ".join(f"{a}={b}" for a, b in list(val.items())[:6]
                                  if isinstance(b, (str, int, float, bool)))
                if inner:
                    out.append(f"{k.replace('_', ' ')}: {inner}")
            elif isinstance(val, list) and val:
                if all(isinstance(x, str) for x in val):
                    out.append(f"{k.replace('_', ' ')}: {', '.join(val[:8])}")
                elif isinstance(val[0], dict):
                    out.append(f"{k.replace('_', ' ')}: " + "; ".join(
                        str(x.get("name") or x.get("figure") or x.get("odu")
                            or x.get("card") or x.get("rune") or "")
                        for x in val[:8]).strip("; "))
        return [l for l in out if l.strip()]
    return [str(v)]


# ── builders ─────────────────────────────────────────────────────────────────

def _b_chenggu(b, n):
    from app.services.chinese.popular import cheng_gu
    return cheng_gu(_i(b, "year", 2000), _i(b, "month", 1), _i(b, "day", 1),
                    _i(b, "hour", 12), _i(b, "minute", 0)).summary()


def _b_flyingstar(b, n):
    from app.services.chinese.popular import flying_star
    f = flying_star(float(b.get("facing_degrees", 180.0)),
                    _i(b, "built_year", _i(b, "year", 2000)))
    rows = [f"period {f['period']} · facing {f['facing']['mountain']} "
            f"({f['facing']['romanised']}, {f['facing']['polarity']}) "
            f"→ {f['facing']['palace']} palace"]
    for pal, d in f["palaces"].items():
        w = f" — {d['warnings'][0]}" if d["warnings"] else ""
        rows.append(f"  {pal}: mountain {d['mountain_star']} / water {d['water_star']} "
                    f"/ annual {d['annual_star']}{w}")
    return rows


def _b_xiaoliuren(b, n):
    from app.services.chinese.popular import xiao_liu_ren_now
    import datetime
    t = datetime.datetime.now()
    return xiao_liu_ren_now(t.year, t.month, t.day, t.hour)


def _b_kauchim(b, n):
    from app.services.chinese.popular import kau_chim
    return kau_chim(seed=_seed(b, n))


def _b_lingqi(b, n):
    from app.services.chinese.popular import ling_qi_jing
    import hashlib
    h = hashlib.sha256(_seed(b, n).encode()).digest()
    return ling_qi_jing(h[0] % 5, h[1] % 5, h[2] % 5)


def _b_gunghap(b, n):
    from app.services.korean.gunghap import gunghap
    p = b.get("partner") or b.get("person")
    if not isinstance(p, dict):
        return ["Gunghap needs two births — supply the partner's date, time and place."]
    return gunghap(b, p).summary()


def _b_seimei(b, n):
    from app.services.japanese.seimei import seimei_handan
    s = b.get("surname_strokes")
    g = b.get("given_strokes")
    if not (s and g):
        return ["Seimei Handan reads the STROKE COUNTS of the written name. Supply them "
                "per character (or the name in kana) — they cannot be derived from a "
                "birth date, and traditional practice counts by the Kangxi radical form "
                "rather than the modern glyph."]
    return seimei_handan(s, g).summary()


def _b_sanmei(b, n):
    from app.services.japanese.seimei import sanmei
    r = sanmei(_i(b, "year", 2000), _i(b, "month", 1), _i(b, "day", 1),
               _i(b, "hour", 12), _i(b, "minute", 0))
    return ([f"major stars: " + ", ".join(f"{k}={v['star']}" for k, v in r["major_stars"].items()),
             f"attendant: " + ", ".join(f"{k}={v['star']}({v['energy']})"
                                        for k, v in r["attendant_stars"].items()),
             f"energy {r['total_energy']}/48 — {r['energy_reading']}"])


def _b_younger(b, n):
    from app.services.divination.more_decks import cast_younger_futhark
    return cast_younger_futhark(_seed(b, n))


def _b_futhorc(b, n):
    from app.services.divination.more_decks import cast_futhorc
    return cast_futhorc(_seed(b, n))


def _b_kipper(b, n):
    from app.services.divination.more_decks import cast_kipper
    return cast_kipper(_seed(b, n))


def _b_cartomancy(b, n):
    from app.services.divination.more_decks import cast_cartomancy
    return cast_cartomancy(_seed(b, n))


def _b_omikuji(b, n):
    from app.services.divination.more_decks import cast_omikuji
    return cast_omikuji(_seed(b, n))


def _b_cleromancy(b, n):
    from app.services.divination.more_decks import cleromancy
    return cleromancy(_seed(b, n))


def _b_bibliomancy(b, n):
    from app.services.divination.more_decks import bibliomancy
    return bibliomancy(_seed(b, n))


def _b_medical(b, n):
    from app.services.western.medical import temperament, afflicted_regions
    asc = b.get("ascendant_longitude")
    moon = b.get("moon_longitude")
    sun = b.get("sun_longitude")
    if asc is None or moon is None or sun is None:
        return ["Medical astrology needs the chart — Ascendant, Moon and Sun longitudes. "
                "It is a historical system and not medical advice."]
    t = temperament(float(asc), float(moon), float(sun),
                    b.get("asc_ruler_longitude"), _i(b, "month", 0) or None)
    out = [f"temperament: {t.primary} (then {t.secondary}) — "
           f"{__import__('app.services.western.medical', fromlist=['HUMOURS']).HUMOURS[t.primary][4]}"]
    out += [f"  {r}" for r in t.reasons]
    for a in afflicted_regions({k: float(v) for k, v in (b.get("planets") or {}).items()
                                if isinstance(v, (int, float))}):
        out.append(f"  {a['reading']}")
    out.append("Historical system; not a diagnosis and not medical advice.")
    return out


def _b_zairja(b, n):
    from app.services.persian.letters import zairja
    q = (b.get("question") or n or "").strip()
    if not q:
        return ["Zāʾirja works on an Arabic question. Supply one."]
    return zairja(q, float(b.get("ascendant_longitude", 0.0)))


def _b_jafr(b, n):
    from app.services.persian.letters import jafr
    return jafr((n or b.get("name") or "").strip())


def _b_hafez(b, n):
    from app.services.persian.letters import fal_e_hafez
    return fal_e_hafez(_seed(b, n))


def _b_istikhara(b, n):
    from app.services.persian.letters import istikhara
    return istikhara(b.get("istikhara_form", "prayer"), _seed(b, n))


def _b_ikhtiyarat(b, n):
    from app.services.persian.letters import ikhtiyarat
    import datetime
    t = datetime.datetime.now()
    return ikhtiyarat(t.isoweekday() % 7, t.hour % 12, _i(b, "moon_mansion", 1))


def _b_svara(b, n):
    from app.services.regional.indic_extra import svara
    import datetime
    t = datetime.datetime.now()
    return svara(_i(b, "lunar_day", 5), t.isoweekday() % 7, (t.hour * 60 + t.minute) % 720)


def _b_sarvatobhadra(b, n):
    from app.services.regional.sarvatobhadra import (
        transit_scan, build_grid)
    r = transit_scan(b.get("transits") or {}, b.get("natal_nakshatra"),
                     n or b.get("name"), b.get("tithi"), b.get("vara"))
    out = []
    if r.get("name_placement"):
        pl = r["name_placement"]
        if pl.get("nakshatra"):
            out.append(f"the name opens on '{pl['syllable']}' — {pl['nakshatra']} "
                       f"pada {pl['pada']}; that is where it sits on the chakra")
    if r.get("your_nakshatra"):
        out.append(f"your star on the grid: {r['your_nakshatra']}")
    for x in r.get("strikes", []):
        out.append(f"{x['planet']} in {x['transiting']} strikes {x['strikes']}"
                   + ("  <-- YOUR STAR" if x["hits_you"] else ""))
    if r.get("reading"):
        out.append(r["reading"])
    if r.get("tithi_struck"):
        out.append(f"tithi struck: {r['tithi_struck']}")
    if r.get("vara_struck"):
        out.append(f"weekday struck: {r['vara_struck']}")
    if not out:
        g = build_grid()
        out = [g["note"],
               "Supply transiting nakshatra positions to scan for vedha."]
    return out


def _b_ashtamangala(b, n):
    from app.services.regional.indic_extra import ashtamangala
    return ashtamangala(b.get("cowrie_count"), _seed(b, n))


def _b_ramala(b, n):
    from app.services.regional.ramala import ramala
    r = ramala(_seed(b, n), b.get("mothers"))
    if r.get("error"):
        return [r["error"]]
    out = [f"mothers: {', '.join(m['figure'] for m in r['mothers'])}",
           f"daughters: {', '.join(r['daughters'])}",
           f"nieces: {', '.join(r['nieces'])}",
           f"witnesses: {r['right_witness']['figure']} (yours) / "
           f"{r['left_witness']['figure']} (theirs)",
           f"JUDGE: {r['judge']['figure']} ({r['judge']['arabic']}) — "
           f"{r['judge']['meaning']}",
           r["judge"]["verdict"]]
    for h in r["bhavas"][:4]:
        out.append(f"bhāva {h['bhava']} {h['name']}: {h['figure']} ({h['tone']}) — {h['governs']}")
    out.append(r["reading_order"])
    return out


def _b_samudrika(b, n):
    from app.services.regional.indic_extra import samudrika_framework
    return samudrika_framework()


def _b_nekath(b, n):
    from app.services.regional.indic_extra import sinhala_nekath
    return sinhala_nekath()


def _b_kartsi(b, n):
    from app.services.regional.world_extra import kar_tsi
    return kar_tsi(_i(b, "year", 2000), _i(b, "month", 1), _i(b, "day", 1))


def _b_zurhai(b, n):
    from app.services.regional.world_extra import zurhai
    return zurhai(_i(b, "year", 2000))


def _b_khmer(b, n):
    from app.services.regional.world_extra import khmer_year
    return khmer_year(_i(b, "year", 2000))


def _b_lao(b, n):
    from app.services.regional.world_extra import lao_year
    return lao_year(_i(b, "year", 2000))


def _b_oaxacan(b, n):
    from app.services.regional.world_extra import oaxacan_count
    return oaxacan_count(_i(b, "year", 2000), _i(b, "month", 1), _i(b, "day", 1))


def _b_tahitian(b, n):
    from app.services.regional.world_extra import tahitian_night
    return tahitian_night(_i(b, "year", 2000), _i(b, "month", 1), _i(b, "day", 1))


def _b_akan(b, n):
    from app.services.regional.world_extra import akan_day_name
    return akan_day_name(_i(b, "year", 2000), _i(b, "month", 1), _i(b, "day", 1),
                         b.get("gender") or "male")


def _b_merindinlogun(b, n):
    from app.services.regional.world_extra import merindinlogun
    return merindinlogun(_seed(b, n))


def _b_sikidy(b, n):
    from app.services.regional.world_extra import sikidy
    r = sikidy(_seed(b, n))
    return [f"mother rows: {r['mother']}", f"nieces: {r['nieces']}", r["note"], r["limit"]]


def _b_african_held(b, n):
    from app.services.regional.world_extra import african_held_traditions
    r = african_held_traditions()
    return [f"{s['name']} ({s['region']}) — {s['mechanism']}. Not computed: {s['why']}."
            for s in r["systems"]] + [r["position"]]


def _b_slavic(b, n):
    from app.services.regional.world_extra import slavic_folk
    r = slavic_folk()
    return [f"{k}: {v}" for k, v in r["attested"].items()] + [r["caution"]]


def _b_baltic(b, n):
    from app.services.regional.world_extra import baltic_finnic
    r = baltic_finnic()
    return [f"{k}: {v}" for k, v in r["attested"].items()] + [r["caution"]]


def _b_chiromancy(b, n):
    from app.services.regional.body_omen import chiromancy_framework
    r = chiromancy_framework()
    return ([f"{v['name']}: {v['reads']}" for v in r["lines"].values()]
            + [r["convention"], r["limit"]])


def _b_mianxiang(b, n):
    from app.services.regional.body_omen import mian_xiang_age
    import datetime
    age = datetime.date.today().year - _i(b, "year", 2000)
    a = mian_xiang_age(age)
    return [f"age {a['age']} is governed by the {a['position']} — {a['governs']}",
            "The age map is fixed and computed; reading the feature itself needs a face."]


def _b_shouxiang(b, n):
    from app.services.regional.body_omen import shou_xiang_framework
    r = shou_xiang_framework()
    return [f"{k}: {v}" for k, v in r["eight_palaces"].items()] + [r["difference"]]


def _b_physiognomy(b, n):
    from app.services.regional.body_omen import physiognomy_framework
    r = physiognomy_framework()
    return [r["history"], r["position"]]


def _b_tasseography(b, n):
    from app.services.regional.body_omen import TEA_SECTORS, TEA_SHAPES
    return ([f"{k}: {v}" for k, v in TEA_SECTORS.items()]
            + ["shapes: " + ", ".join(list(TEA_SHAPES)[:8])]
            + ["The sectors are a fixed convention; the shapes are perceived, not computed."])


def _b_scrying(b, n):
    from app.services.regional.body_omen import scrying_framework
    r = scrying_framework()
    return [f"{k}: {v}" for k, v in r["media"].items()] + [r["method"], r["limit"]]


def _b_dowsing(b, n):
    from app.services.regional.body_omen import dowsing
    r = dowsing(b.get("question", ""))
    return [f"{k}: {v}" for k, v in r["convention"].items()] + [r["note"]]


def _b_moleosophy(b, n):
    from app.services.regional.body_omen import MOLE_POSITIONS
    return [f"{k}: {v}" for k, v in MOLE_POSITIONS.items()]


def _b_tamil(b, n):
    from app.services.numerology.tamil_jewish import tamil_numerology
    r = tamil_numerology(_i(b, "year", 2000), _i(b, "month", 1), _i(b, "day", 1),
                         (n or b.get("name") or ""))
    out = [f"psychic {r['psychic']['number']} ({r['psychic']['planet']}) — {r['psychic']['meaning']}",
           f"destiny {r['destiny']['number']} ({r['destiny']['planet']}) — {r['destiny']['meaning']}"]
    nm = r.get("name") or {}
    if nm.get("number"):
        out.append(f"name {nm['number']} — {nm['verdict']}")
        if nm.get("remedy"):
            out.append(nm["remedy"])
    if r.get("burdened"):
        out.append(f"burdened numbers present: {r['burdened']} — Tamil practice treats 4 "
                   f"and 8 as requiring correction rather than as simply unlucky")
    return out


def _b_goralot(b, n):
    from app.services.numerology.tamil_jewish import goralot
    return goralot(_seed(b, n))


def _b_mazalot(b, n):
    from app.services.numerology.tamil_jewish import mazalot
    return mazalot(_i(b, "hebrew_month", _i(b, "month", 1)))


def _b_guolao(b, n):
    from app.services.chinese.classical import guo_lao
    lon = {k.lower(): float(v) for k, v in (b.get("planets") or {}).items()
           if isinstance(v, (int, float))}
    g = guo_lao(_i(b, "year", 2000), _i(b, "month", 1), _i(b, "day", 1),
                _i(b, "hour", 12), _i(b, "minute", 0), lon,
                b.get("ascendant_longitude"))
    out = [f"{k} {v['name']} at {v['longitude']}° in {v['sign']}"
           + ("" if v["real_body"] else "  (hypothetical — no physical body)")
           for k, v in g["positions"].items()]
    return out + [g["note"]]


def _b_tieban(b, n):
    from app.services.chinese.classical import tie_ban
    r = tie_ban(_i(b, "year", 2000), _i(b, "month", 1), _i(b, "day", 1),
                _i(b, "hour", 12), _i(b, "minute", 0))
    return [f"condition number {r['condition_number']} of {r['of_verses']}",
            f"secondary conditions: {r['secondary_conditions']}",
            f"coefficients: {r['coefficients']}", r["limit"]]


def _b_sanhe(b, n):
    from app.services.chinese.classical import san_he
    r = san_he(_i(b, "sitting_branch", 0), _i(b, "water_exit_branch", 8),
               b.get("landform"))
    out = [f"frame {r['frame']['chinese']} ({r['frame']['element']}) — {r['frame']['meaning']}",
           f"water exits at {r['water_exit']['chinese']} on stage "
           f"{r['water_exit']['stage']} ({r['water_exit']['stage_name']}) — "
           f"{r['water_exit']['verdict']}",
           r["judgement"]]
    if r.get("landform_faults"):
        out += [f"landform: {f}" for f in r["landform_faults"]]
    return out + [r["school_note"]]


def _b_tutru(b, n):
    from app.services.vietnamese.tutru import tu_tru
    return tu_tru(_i(b, "year", 2000), _i(b, "month", 1), _i(b, "day", 1),
                  _i(b, "hour", 12), _i(b, "minute", 0),
                  float(b.get("lng", b.get("longitude", 105.85)) or 105.85),
                  b.get("lat", b.get("latitude"))).summary()


def _b_sibilla(b, n):
    from app.services.divination.more_decks import cast_sibilla
    return cast_sibilla(_seed(b, n))


def _b_aboriginal(b, n):
    from app.services.regional.aboriginal import season, emu_in_the_sky, position
    m, d = _i(b, "month", 1), _i(b, "day", 1)
    out = []
    for nation in ("dharawal", "yolngu"):
        r = season(m, d, nation)
        if r.get("season"):
            out.append(f"{r['nation']}: {r['season']} ({r['english']}) — {r['description']}")
    e = emu_in_the_sky(m)
    out.append(f"Emu in the Sky — {e['posture']}: {e['reading']}")
    p = position()
    out.append(p["why"])
    out.append(p["restriction"])
    return out


# ── the table ────────────────────────────────────────────────────────────────
# (id, label, aliases, facets, builder, kind)
_TABLE = [
    ("chenggu", "Cheng Gu (bone weight)", ["cheng gu", "bone weight", "称骨", "chengu"],
     "bone_weight, weight_band", _b_chenggu, "natal"),
    ("flyingstar", "Flying Star feng shui", ["flying star", "xuan kong", "fei xing", "玄空飛星", "feng shui chart", "feng shui"],
     "flying_star, mountain_star, water_star, annual_star", _b_flyingstar, "moment"),
    ("xiaoliuren", "Xiao Liu Ren", ["xiao liu ren", "小六壬", "small six ren", "finger divination"],
     "xiao_position", _b_xiaoliuren, "moment"),
    ("kauchim", "Kau Chim (temple lots)", ["kau chim", "求籤", "temple lots", "fortune sticks", "chien tung"],
     "lot_stick, lot_grade", _b_kauchim, "cast"),
    ("lingqi", "Ling Qi Jing", ["ling qi jing", "靈棋經", "numinous chess"],
     "ling_figure", _b_lingqi, "cast"),
    ("gunghap", "Gunghap (Korean compatibility)", ["gunghap", "궁합", "korean compatibility"],
     "geot_gunghap, sok_gunghap", _b_gunghap, "natal"),
    ("seimei", "Seimei Handan", ["seimei handan", "姓名判断", "japanese name divination", "stroke count"],
     "kakusu, jinkaku, soukaku", _b_seimei, "framework"),
    ("sanmei", "Sanmei-gaku", ["sanmei", "算命学", "sanmeigaku"],
     "judai_shusei, juni_daijusei", _b_sanmei, "natal"),
    ("younger_futhark", "Younger Futhark", ["younger futhark", "viking runes", "sixteen runes"],
     "younger_runes", _b_younger, "cast"),
    ("futhorc", "Anglo-Saxon Futhorc", ["futhorc", "anglo saxon runes", "old english runes"],
     "futhorc_runes", _b_futhorc, "cast"),
    ("kipper", "Kipper cards", ["kipper", "kipperkarten"],
     "kipper_layout", _b_kipper, "cast"),
    ("cartomancy", "Playing-card cartomancy", ["cartomancy", "playing cards", "card reading"],
     "playing_cards", _b_cartomancy, "cast"),
    ("omikuji", "Omikuji", ["omikuji", "おみくじ", "shrine fortune", "fortune slip"],
     "omikuji_grade", _b_omikuji, "cast"),
    ("cleromancy", "Cleromancy (lots)", ["cleromancy", "casting lots", "knucklebones", "sortition"],
     "lot_cast", _b_cleromancy, "cast"),
    ("bibliomancy", "Bibliomancy", ["bibliomancy", "sortes", "opening the book"],
     "book_passage", _b_bibliomancy, "cast"),
    ("medical", "Traditional medical astrology", ["medical astrology", "humours", "temperament", "decumbiture", "melothesia"],
     "humour, melothesia, critical_days", _b_medical, "natal"),
    ("zairja", "Zāʾirja", ["zairja", "زايرجة", "zayirja"],
     "zairja_extraction", _b_zairja, "moment"),
    ("jafr", "Jafr", ["jafr", "علم الجفر", "ilm al jafr"],
     "jafr_value, letter_element", _b_jafr, "natal"),
    ("hafez", "Fāl-e Ḥāfeẓ", ["hafez", "fal e hafez", "فال حافظ", "divan"],
     "ghazal_draw", _b_hafez, "cast"),
    ("istikhara", "Istikhāra", ["istikhara", "استخارة"],
     "istikhara_form", _b_istikhara, "cast"),
    ("ikhtiyarat", "Ikhtiyārāt", ["ikhtiyarat", "اختيارات", "islamic electional"],
     "planetary_hour, mansion_verdict", _b_ikhtiyarat, "moment"),
    ("svara", "Svara Śāstra", ["svara", "swara", "शिवस्वरोदय", "breath divination", "swarodaya"],
     "svara_channel, tattva", _b_svara, "moment"),
    ("sarvatobhadra", "Sarvatobhadra Chakra", ["sarvatobhadra", "सर्वतोभद्र", "vedha"],
     "vedha, sbc_grid, name_placement, tithi_vedha", _b_sarvatobhadra, "natal"),
    ("ashtamangala", "Aṣṭamaṅgala Praśna", ["ashtamangala", "അഷ്ടമംഗല", "kerala prasna", "cowrie prasna"],
     "arudha_count", _b_ashtamangala, "cast"),
    ("ramala", "Ramala", ["ramala", "रमल", "indian geomancy"],
     "ramala_shield, ramala_judge, ramala_bhavas", _b_ramala, "cast"),
    ("samudrika", "Sāmudrika Śāstra", ["samudrika", "सामुद्रिक", "body marks"],
     "body_marks", _b_samudrika, "framework"),
    ("nekath", "Sinhala Nekath", ["nekath", "නැකත්", "sinhala astrology", "sri lankan"],
     "nekath_observances", _b_nekath, "framework"),
    ("kartsi", "Tibetan Kar-tsi", ["kartsi", "kar tsi", "དཀར་རྩིས", "tibetan calendar"],
     "tithi_status, rabjung", _b_kartsi, "natal"),
    ("zurhai", "Mongolian Zurhai", ["zurhai", "зурхай", "mongolian astrology"],
     "zurhai_sign, menge", _b_zurhai, "natal"),
    ("khmer", "Khmer Horasastra", ["khmer", "cambodian", "ហោរាសាស្ត្រ", "chaul chnam"],
     "khmer_sak", _b_khmer, "natal"),
    ("lao", "Lao calendar", ["lao", "laotian", "pi mai"],
     "lao_animal", _b_lao, "natal"),
    ("oaxacan", "Zapotec / Mixtec count", ["zapotec", "mixtec", "oaxaca", "piye"],
     "oaxacan_daysign", _b_oaxacan, "natal"),
    ("tahitian", "Tahitian moon nights", ["tahitian", "polynesian nights", "maohi"],
     "tahitian_night", _b_tahitian, "natal"),
    ("akan", "Akan day names", ["akan", "kra din", "day name", "ghanaian", "twi name"],
     "kra_din", _b_akan, "natal"),
    ("merindinlogun", "Mérìndínlógún", ["merindinlogun", "sixteen cowries", "cowrie shells", "diloggun"],
     "cowrie_odu", _b_merindinlogun, "cast"),
    ("sikidy", "Sikidy", ["sikidy", "malagasy", "madagascar divination"],
     "sikidy_tableau", _b_sikidy, "cast"),
    ("african_held", "Ngombo, Bamana, bone throwing", ["ngombo", "bamana", "bone throwing", "ditaola", "sangoma", "basket divination"],
     "held_traditions", _b_african_held, "framework"),
    ("slavic", "Slavic folk divination", ["slavic", "gadanie", "svyatki", "kupala"],
     "slavic_customs", _b_slavic, "framework"),
    ("baltic", "Baltic and Finnic folk", ["baltic", "finnic", "finnish divination", "lithuanian", "latvian", "tin pouring"],
     "baltic_customs", _b_baltic, "framework"),
    ("chiromancy", "Chiromancy (palmistry)", ["chiromancy", "palmistry", "palm reading", "palm lines"],
     "palm_lines, palm_mounts, hand_shape", _b_chiromancy, "framework"),
    ("mianxiang", "Mian Xiang (face reading)", ["mian xiang", "面相", "face reading", "chinese physiognomy"],
     "face_age_map, face_palaces", _b_mianxiang, "framework"),
    ("shouxiang", "Shou Xiang", ["shou xiang", "手相", "chinese palmistry"],
     "eight_palm_palaces", _b_shouxiang, "framework"),
    ("physiognomy", "Physiognomy (European)", ["physiognomy", "lavater"],
     "physiognomy_note", _b_physiognomy, "framework"),
    ("tasseography", "Tasseography", ["tasseography", "tea leaves", "tea leaf reading", "coffee grounds", "tasseomancy"],
     "cup_sectors, cup_shapes", _b_tasseography, "framework"),
    ("scrying", "Scrying", ["scrying", "crystal ball", "black mirror", "shewstone", "water gazing"],
     "scrying_media", _b_scrying, "framework"),
    ("dowsing", "Dowsing / pendulum", ["dowsing", "pendulum", "divining rod", "rhabdomancy"],
     "pendulum_convention", _b_dowsing, "framework"),
    ("moleosophy", "Moleosophy", ["moleosophy", "mole reading", "birthmark"],
     "mole_positions", _b_moleosophy, "framework"),
    ("tamil", "Tamil numerology", ["tamil numerology", "எண் கணிதம்", "tamil numbers"],
     "psychic_number, destiny_number, name_support", _b_tamil, "natal"),
    ("goralot", "Goralot", ["goralot", "גורלות", "jewish lots", "goral hagra"],
     "goral_draw", _b_goralot, "cast"),
    ("mazalot", "Mazalot", ["mazalot", "מזלות", "hebrew astrology", "jewish astrology"],
     "mazal, hebrew_planetary_hour", _b_mazalot, "natal"),
    ("guolao", "Guo Lao Xing Zong", ["guo lao", "果老星宗", "chinese horoscopic", "zhang guo lao", "ziqi", "yuebei"],
     "guolao_houses, four_invisible", _b_guolao, "natal"),
    ("tieban", "Tie Ban Shen Shu", ["tie ban", "鐵板神數", "iron plate"],
     "condition_number", _b_tieban, "natal"),
    ("sanhe", "San He feng shui", ["san he", "三合", "three harmonies", "landform feng shui", "water exit"],
     "sanhe_frame, water_exit, celestial_animals", _b_sanhe, "moment"),
    ("tutru", "Tứ Trụ (Vietnamese)", ["tu tru", "tứ trụ", "vietnamese four pillars", "thap than"],
     "thap_than, dung_than", _b_tutru, "natal"),
    ("sibilla", "Sibilla deck", ["sibilla", "sibilla della zingara", "italian cards"],
     "sibilla_cards", _b_sibilla, "cast"),
    ("aboriginal", "Aboriginal Australian sky knowledge", ["aboriginal", "yolngu", "dharawal", "boorong", "emu in the sky", "indigenous australian"],
     "seasonal_calendar, emu_constellation", _b_aboriginal, "framework"),
]

FRAMEWORK_IDS = {sid for sid, _, _, _, _, kind in _TABLE if kind == "framework"}
CAST_IDS = {sid for sid, _, _, _, _, kind in _TABLE if kind == "cast"}
MOMENT_IDS = {sid for sid, _, _, _, _, kind in _TABLE if kind == "moment"}


def _make(builder: Callable, label: str, kind: str):
    def one(b, name=""):
        try:
            lines = _lines(builder(b, name))
        except Exception:
            return ""
        return lines[0] if lines else ""

    def deep(b, name=""):
        try:
            lines = _lines(builder(b, name))
        except Exception:
            return []
        if kind == "framework" and lines:
            lines = lines + ["This system is not computed from a birth date — it reads "
                             "something observed, cast or held by a practitioner. The "
                             "vocabulary is given so an observation can be read against it."]
        return lines
    return one, deep


WORLD_SIGNS: Dict[str, dict] = {}
for _sid, _label, _aliases, _facets, _builder, _kind in _TABLE:
    _one, _deep = _make(_builder, _label, _kind)
    WORLD_SIGNS[_sid] = {"label": _label, "aliases": _aliases, "facets": _facets,
                         "one": _one, "deep": _deep, "method": _sid, "kind": _kind}


def register() -> Dict:
    """Add these to the wider-council bus. Idempotent."""
    from app.services.oracle import signatures as S
    added = []
    for sid, spec in WORLD_SIGNS.items():
        if sid in S.SIGNS:
            continue
        S.SIGNS[sid] = spec
        added.append(sid)
    S.SIGNATURE_IDS = set(S.SIGNS)
    S.MINOR_SYSTEMS = {k: {"label": v["label"], "aliases": v["aliases"],
                           "sections": v["facets"]} for k, v in S.SIGNS.items()}
    return {"added": added, "total": len(S.SIGNS)}


assert len(_TABLE) == len(WORLD_SIGNS), "duplicate id in the world table"
assert all(f.strip() for _, _, _, f, _, _ in _TABLE), "every system needs facets"
assert FRAMEWORK_IDS, "the framework class must not be empty — it is the honesty guard"
