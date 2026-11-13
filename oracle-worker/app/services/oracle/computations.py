"""
COMPUTATION TOOLBOX — the engine's real capabilities exposed as named, parameterized
calls the LLM planner can request for a query. The LLM (a jyotiṣī) decides WHAT to
consult; these return the EXACT computed facts. The LLM never invents a placement —
it only asks for one, and gets the truth from the engine.

Each entry: name → (human description, param hint, fn(engine, params) -> short fact
string). Every fn is defensive: a failure returns '' and is skipped, never raises.
"""
import json
from datetime import datetime

RASHIS = ['Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo',
          'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces']
SIGN_LORD = ['Mars', 'Venus', 'Mercury', 'Moon', 'Sun', 'Mercury',
             'Venus', 'Mars', 'Jupiter', 'Saturn', 'Saturn', 'Jupiter']
_EXALT = {'Sun': 'Aries', 'Moon': 'Taurus', 'Mars': 'Capricorn', 'Mercury': 'Virgo',
          'Jupiter': 'Cancer', 'Venus': 'Pisces', 'Saturn': 'Libra'}
_OWN = {'Sun': {'Leo'}, 'Moon': {'Cancer'}, 'Mars': {'Aries', 'Scorpio'},
        'Mercury': {'Gemini', 'Virgo'}, 'Jupiter': {'Sagittarius', 'Pisces'},
        'Venus': {'Taurus', 'Libra'}, 'Saturn': {'Capricorn', 'Aquarius'}}


def _dignity(planet, rashi_name):
    if _EXALT.get(planet) == rashi_name:
        return "exalted (very strong)"
    if rashi_name in _OWN.get(planet, set()):
        return "own sign (strong)"
    debil = {v: k for k, v in _EXALT.items()}
    # debilitation = opposite of exaltation
    idx = RASHIS.index(rashi_name) if rashi_name in RASHIS else None
    if _EXALT.get(planet) and idx is not None:
        if RASHIS[(RASHIS.index(_EXALT[planet]) + 6) % 12] == rashi_name:
            return "debilitated (weak)"
    return ""


def _summ(d, max_len=340):
    """Compact any engine return into a short, high-signal fact string."""
    if d is None:
        return ""
    if isinstance(d, str):
        return d.strip()[:max_len]
    if isinstance(d, (int, float, bool)):
        return str(d)
    if isinstance(d, list):
        return "; ".join(_summ(x, 140) for x in d[:6] if x)[:max_len]
    if isinstance(d, dict):
        for k in ('reading', 'summary', 'verdict', 'interpretation', 'conclusion', 'effect', 'assessment'):
            v = d.get(k)
            if isinstance(v, str) and v.strip():
                return v.strip()[:max_len]
        parts = []
        for k, v in d.items():
            if isinstance(v, (str, int, float, bool)) and str(v).strip() and k not in ('error',):
                parts.append(f"{k}: {v}")
        if parts:
            return "; ".join(parts)[:max_len]
        try:
            return json.dumps(d, default=str)[:max_len]
        except Exception:
            return str(d)[:max_len]
    return str(d)[:max_len]


def _planets(engine):
    return getattr(engine, 'planets', {}) or {}


def _asc_rashi(engine):
    a = getattr(engine, 'ascendant_rashi', None)
    if a is None:
        a = (getattr(engine, 'ascendant', {}) or {}).get('rashi', 0)
    return a or 0


def _parse_date(s):
    if not s:
        return None
    for fmt in ('%Y-%m-%d', '%Y-%m', '%Y'):
        try:
            return datetime.strptime(str(s).strip()[:10], fmt)
        except Exception:
            continue
    return None


# ── the individual witnesses ──────────────────────────────────────────────────
def _house(engine, p):
    n = int(p.get('n', p.get('house', 1)))
    asc = _asc_rashi(engine)
    sign = RASHIS[(asc + n - 1) % 12]
    lord = SIGN_LORD[(asc + n - 1) % 12]
    ld = _planets(engine).get(lord, {}) or {}
    occ = [pl for pl, d in _planets(engine).items()
           if isinstance(d, dict) and d.get('house') == n]
    ldsign = ld.get('rashi_name', '?')
    dig = _dignity(lord, ldsign)
    return (f"House {n} ({sign}): lord {lord} sits in {ldsign} (H{ld.get('house','?')})"
            f"{' — ' + dig if dig else ''}; occupied by: {', '.join(occ) or 'no planets'}")


def _planet(engine, p):
    name = str(p.get('name', p.get('planet', ''))).title()
    d = _planets(engine).get(name, {}) or {}
    if not d:
        return ""
    sign = d.get('rashi_name', '?')
    dig = _dignity(name, sign)
    retro = ' retrograde' if (d.get('retrograde') or d.get('retro')) else ''
    return (f"{name}: {sign} (H{d.get('house','?')}), nakshatra {d.get('nakshatra_name','?')}"
            f"{retro}{' — ' + dig if dig else ''}")


def _house_lord(engine, p):
    n = int(p.get('n', p.get('house', 1)))
    lord = SIGN_LORD[(_asc_rashi(engine) + n - 1) % 12]
    return _planet(engine, {'name': lord}) + f"  (this is the ruler of house {n})"


def _dasha_at(engine, p):
    dt = _parse_date(p.get('date')) or datetime.now()
    try:
        r = engine.get_dasha_for_date(dt) or {}
        return f"Ruling period on {dt:%d %b %Y}: {r.get('dasha_string','')}"
    except Exception:
        return ""


def _transits_at(engine, p):
    dt = _parse_date(p.get('date')) or datetime.now()
    try:
        from app.services.core.ephemeris import get_ephemeris
        asc = _asc_rashi(engine)
        pl = get_ephemeris().get_all_planets(get_ephemeris().get_julian_day(dt)) or {}
        parts = []
        for name in ('Jupiter', 'Saturn', 'Rahu', 'Ketu', 'Mars'):  # the slow, event-making transits
            r = (pl.get(name) or {}).get('rashi')
            if r is None:
                continue
            h = ((r - asc) % 12) + 1
            parts.append(f"{name}→H{h}")
        return f"Sky on {dt:%d %b %Y} over their chart: " + ", ".join(parts)
    except Exception:
        return ""


def _safe(engine, attr, *args):
    try:
        m = getattr(engine, attr, None)
        return m(*args) if callable(m) else None
    except Exception:
        return None


def _karakas(engine, p):
    d = _safe(engine, 'get_jaimini_karakas')
    if not isinstance(d, dict):
        return ""
    order = [('Atmakaraka', 'AK=soul'), ('Amatyakaraka', 'AmK=career'), ('Bhratrikaraka', 'BK=siblings'),
             ('Matrikaraka', 'MK=mother'), ('Putrakaraka', 'PK=children'), ('Gnatikaraka', 'GK=obstacles'),
             ('Darakaraka', 'DK=SPOUSE')]
    parts = []
    for k, label in order:
        v = d.get(k)
        if isinstance(v, dict) and v.get('planet'):
            parts.append(f"{label}:{v['planet']}")
    return "Jaimini kārakas — " + ", ".join(parts) if parts else ""


def _kp_house(engine, p):
    n = int(p.get('house', p.get('n', 1)))
    d = _safe(engine, 'get_kp_significators', n)
    if not isinstance(d, dict):
        return ""
    levels = []
    for i in (1, 2, 3, 4):
        pls = d.get(f'level_{i}') or []
        if pls:
            levels.append(f"L{i}: {', '.join(str(x) for x in pls)}")
    return f"KP significators of house {n} (strongest→weakest): " + ("; ".join(levels) or "none")


def _yogas(engine, p):
    d = _safe(engine, 'get_yogas')
    cats = (d or {}).get('yogas', {}) if isinstance(d, dict) else {}
    out = []
    for _cat, lst in (cats.items() if isinstance(cats, dict) else []):
        for y in (lst or [])[:4]:
            if isinstance(y, dict) and y.get('name'):
                eff = (y.get('effects') or '').strip()[:48]
                out.append(y['name'] + (f" ({eff})" if eff else ""))
    return "Yogas present — " + "; ".join(out[:8]) if out else "No major yogas"


def _divisional(engine, p):
    div = int(p.get('division', 9))
    d = _safe(engine, 'get_divisional_chart', div)
    if not isinstance(d, dict):
        return ""
    name, purpose = d.get('name', f'D{div}'), d.get('purpose', '')
    pls = d.get('planets') or {}
    parts = []
    if isinstance(pls, dict):
        for pl, pv in pls.items():
            sg = (pv.get('rashi_name') or pv.get('sign') or '') if isinstance(pv, dict) else ''
            if sg:
                parts.append(f"{pl}:{sg}")
    body = ", ".join(parts[:9]) if parts else purpose
    return f"{name} (D{div} — {purpose}): {body}"


def _method(attr, *param_keys):
    """Wrap a zero/one-arg engine method into a witness, summarised."""
    def fn(engine, p):
        try:
            m = getattr(engine, attr, None)
            if not callable(m):
                return ""
            if param_keys:
                k = param_keys[0]
                v = p.get(k)
                if k in ('house', 'division', 'year'):
                    v = int(v) if v is not None else None
                if k == 'date':
                    v = _parse_date(v) or datetime.now()
                return _summ(m(v) if v is not None else m())
            return _summ(m())
        except Exception:
            return ""
    return fn


# name → (description for the planner, param hint, fn)
REGISTRY = {
    'house': ("A house's sign, its lord + where the lord sits (strength), and occupants. THE core witness for any life-area.", "n: 1-12", _house),
    'house_lord': ("The ruler of a house and its condition — how that life-area is 'run'.", "n: 1-12", _house_lord),
    'planet': ("One planet's exact sign, house, nakshatra, dignity, retrograde.", "name: Sun/Moon/Mars/Mercury/Jupiter/Venus/Saturn/Rahu/Ketu", _planet),
    'karakas': ("Jaimini chara karakas — the soul (Atmakaraka), spouse (Darakaraka), etc. significators.", "none", _karakas),
    'divisional': ("A divisional (varga) chart — check the topic's own chart: marriage=9, career=10, children=7, wealth=2, spirituality=20.", "division: 9/10/7/2/…", _divisional),
    'kp_house': ("KP significators for a house — the sharp yes/no on that matter.", "house: 1-12", _kp_house),
    'yogas': ("The notable yogas (raja/dhana/etc.) in the chart and what they confer.", "none", _yogas),
    'ashtakavarga': ("Ashtakavarga bindu strength for the houses — where transits land well.", "none", _method('get_ashtakavarga')),
    'dignity': ("Every planet's dignity (exalt/own/debilitated/etc.) — the strength backbone.", "none", _method('get_planetary_dignity')),
    'strength': ("Overall chart strength — strongest and weakest planets.", "none", _method('get_chart_strength')),
    'dasha_now': ("The currently running daśā (mahā/antar/pratyantar).", "none", _method('get_vimshottari_dasha')),
    'dasha_at': ("Which life-chapter (daśā) rules a SPECIFIC date.", "date: YYYY-MM-DD", _dasha_at),
    'transits_at': ("Where the slow event-making planets sit over the chart on a date (default today).", "date: YYYY-MM-DD (optional)", _transits_at),
    'sade_sati': ("Saturn's 7.5-year transit over the Moon — a major life-pressure marker.", "none", _method('check_sade_sati')),
    'manglik': ("Mangal/Kuja dosha (Mars affliction) — key for marriage.", "none", _method('check_manglik')),
    'annual': ("Varshaphal (annual chart) highlights for a given year.", "year: YYYY", _method('get_varshaphal', 'year')),
    'career_aptitude': ("The chart's vocational signature — natural career direction.", "none", _method('get_career_aptitude')),
    'nakshatra_profile': ("The birth-star profile (deep nature).", "none", _method('get_nakshatra_profile')),
    'arudha': ("Arudha padas — how the life-areas MANIFEST outwardly (perception vs reality).", "none", _method('get_arudha_padas')),
}


# ══════════════════════════════════════════════════════════════════════════════
# WESTERN council
# ══════════════════════════════════════════════════════════════════════════════
def _bd_dt(bd):
    """LOCAL clock time, exactly as the birth record states it. BaZi wants this —
    the four pillars are reckoned in local time — so do NOT convert it here."""
    return datetime(int(bd['year']), int(bd['month']), int(bd['day']),
                    int(bd.get('hour', 12) or 12), int(bd.get('minute', 0) or 0))


def _bd_dt_utc(bd, lat, lng):
    """The same moment in UTC, which is what WesternChart documents it takes
    ("birth_datetime: Birth date/time in UTC") and what JyotishEngine feeds it
    everywhere else (engine.birth_dt = local_to_utc(...), jyotish_engine.py:152).

    This block was handing it the raw local clock instead, so the witnesses
    disagreed with the chart printed directly above them in the same briefing —
    for a Mumbai birth, Rising read Capricorn here and Libra there, three signs
    apart, which is precisely UTC+5:30 of Ascendant motion. Every Western reading
    rested on whichever of the two the responder happened to quote."""
    local = _bd_dt(bd)
    try:
        from app.services.core.timezone_utils import get_timezone_manager
        return get_timezone_manager().local_to_utc(
            local, lat, lng, bd.get('timezone_offset'))
    except Exception as e:
        print(f"[computations] local_to_utc failed, using local time: {e}")
        return local


def _west(bd):
    from app.services.western.chart import WesternChart
    lat = float(bd.get('lat', bd.get('latitude', 28.6)) or 28.6)
    lng = float(bd.get('lng', bd.get('longitude', 77.2)) or 77.2)
    wc = WesternChart(_bd_dt_utc(bd, lat, lng), lat, lng)
    wc._ensure_calculated() if hasattr(wc, '_ensure_calculated') else None
    return wc


def _w_big3(wc, p):
    b = _safe0(wc, 'get_big_three')
    return "Sun/Moon/Rising — " + _summ(b) if b else ""


def _w_planet(wc, p):
    name = str(p.get('name', '')).title()
    d = (getattr(wc, 'planets', {}) or {}).get(name, {}) or {}
    if not d:
        return ""
    retro = ' retrograde' if d.get('retrograde') else ''
    return f"{name}: {d.get('sign','?')} (H{d.get('house','?')}){retro}, dignity {d.get('dignity','—')}"


def _w_aspects(wc, p):
    asp = _safe0(wc, 'get_aspects') or []
    out = [f"{a.get('planet1')} {a.get('aspect')} {a.get('planet2')} ({a.get('nature','')})"
           for a in asp[:6] if isinstance(a, dict)]
    return "Tightest aspects — " + "; ".join(out) if out else ""


def _w_elements(wc, p):
    return "Element/modality balance — " + _summ(_safe0(wc, 'get_element_balance'))


def _w_pattern(wc, p):
    cfg = _safe0(wc, 'get_configurations') or []
    out = [c.get('type', c.get('name', '')) for c in cfg if isinstance(c, dict)]
    return "Chart patterns — " + ", ".join([x for x in out if x]) if out else "No major aspect pattern"


def _w_transits(wc, p):
    tr = _safe0(wc, 'get_current_transits') or []
    out = [f"{t.get('transit_planet')} {t.get('aspect')} natal {t.get('natal_planet')} ({t.get('nature','')})"
           for t in tr[:6] if isinstance(t, dict)]
    return "Current transits to natal — " + "; ".join(out) if out else ""


def _safe0(obj, attr, *a):
    try:
        m = getattr(obj, attr, None)
        return m(*a) if callable(m) else None
    except Exception:
        return None



def _w_planets_dict(wc):
    """{name: longitude} from the Western chart, for the modules that take raw degrees."""
    pl = _safe0(wc, 'get_planets') or {}
    out = {}
    if isinstance(pl, dict):
        for k, v in pl.items():
            lon = v.get('longitude') if isinstance(v, dict) else None
            if lon is not None:
                out[str(k).lower()] = float(lon)
    return out


def _w_midpoints(wc, p):
    """Ebertin's midpoint tree for the luminaries and angles — the cosmobiology witness."""
    from app.services.western import cosmobiology as C
    lons = _w_planets_dict(wc)
    if len(lons) < 3:
        return ""
    tree = C.midpoint_tree(lons)
    focus = (p or {}).get('name') or 'sun'
    focus = str(focus).lower()
    entries = (tree.get('trees') or {}).get(focus) or []
    if not entries:
        # fall back to whichever body carries the most midpoints
        trees = tree.get('trees') or {}
        if not trees:
            return ""
        focus = max(trees, key=lambda k: len(trees[k]))
        entries = trees[focus]
    parts = [f"{e['notation']} ({e['orb']:.1f}\u00b0)" for e in entries[:5]]
    return f"Midpoint tree on {focus} (90\u00b0 dial, tight orb) — " + "; ".join(parts)


def _w_lunation(wc, p):
    """Rudhyar's soli-lunar phase."""
    from app.services.western import lunation as L
    lons = _w_planets_dict(wc)
    if 'sun' not in lons or 'moon' not in lons:
        return ""
    ph = L.phase(lons['sun'], lons['moon'])
    return (f"Lunation phase — {ph['phase']} ({ph['phase_index']}/8), "
            f"{ph['elongation']:.0f}\u00b0 from the Sun: {ph['keyword']}. {ph['meaning']}")




WEST_REGISTRY = {
    'big_three': ("Sun, Moon and Rising — the core identity, emotions, persona.", "none", _w_big3),
    'planet': ("One planet's sign, house, dignity, retrograde.", "name: Sun/Moon/Mercury/Venus/Mars/Jupiter/Saturn/Uranus/Neptune/Pluto", _w_planet),
    'aspects': ("The tightest major aspects — the chart's core dynamics.", "none", _w_aspects),
    'elements': ("Balance of fire/earth/air/water and the modalities — temperament.", "none", _w_elements),
    'pattern': ("Major aspect patterns (t-square, grand trine, etc.).", "none", _w_pattern),
    'transits': ("Current outer-planet transits hitting the natal chart — the live weather.", "none", _w_transits),
    # midpoints/lunation are NOT duplicates of western/sections.py: that module renders
    # midpoint ACTIVATIONS and the PROGRESSED lunation. These are Ebertin's dial-based
    # TREE and Rudhyar's NATAL phase — different computations, and both absent there.
    'midpoints': ("Ebertin midpoint tree on the 90\u00b0 dial — what a body is built from.", "name: sun/moon/mercury/venus/mars/jupiter/saturn (default sun)", _w_midpoints),
    'lunation': ("Rudhyar's soli-lunar phase — how they characteristically begin and release.", "none", _w_lunation),
}


# ══════════════════════════════════════════════════════════════════════════════
# CHINESE (BaZi) council
# ══════════════════════════════════════════════════════════════════════════════
def _bazi(bd):
    from app.services.chinese.bazi import BaZiChart
    return BaZiChart(_bd_dt(bd))


def _c_daymaster(ch, p):
    return "Day Master (the core self) — " + _summ(_safe0(ch, 'get_day_master'))


def _c_pillars(ch, p):
    return "Four Pillars — " + _summ(_safe0(ch, 'get_four_pillars'))


def _c_elements(ch, p):
    return "Five-element balance — " + _summ(_safe0(ch, 'get_element_balance'))


def _c_tengods(ch, p):
    return "Ten Gods (life-forces) — " + _summ(_safe0(ch, 'get_ten_gods'))


def _c_animal(ch, p):
    return "Year animal — " + _summ(_safe0(ch, 'get_animal_sign'))


def _c_luck(ch, p):
    lp = _safe0(ch, 'get_luck_periods', 8, str(p.get('gender', 'male'))) or []
    return "Luck periods (decade cycles) — " + "; ".join(_summ(x, 90) for x in lp[:6] if x)


CN_REGISTRY = {
    'day_master': ("The Day Master — core self, its element and strength.", "none", _c_daymaster),
    'pillars': ("The four pillars (year/month/day/hour) — the life structure.", "none", _c_pillars),
    'elements': ("Five-element balance — what's strong, weak, missing, favourable.", "none", _c_elements),
    'ten_gods': ("The Ten Gods — wealth, power, output, resource forces relative to the self.", "none", _c_tengods),
    'animal': ("The year animal and its element.", "none", _c_animal),
    'luck': ("The decade luck cycles — long-range timing.", "gender: male/female", _c_luck),
}


_REG_BY_SYSTEM = {'western': WEST_REGISTRY, 'chinese': CN_REGISTRY}


def toolbox_menu(system="bphs"):
    """The menu the planner sees — one line per witness, per system."""
    reg = _REG_BY_SYSTEM.get((system or "bphs").lower(), REGISTRY)
    return "\n".join(f"- {name}({dp[1]}): {dp[0]}" for name, dp in reg.items())


def run_plan(engine, plan):
    """Execute a planner's list of [{name, params}] → a grounded dossier string."""
    if engine is None or not isinstance(plan, list):
        return ""
    seen, lines = set(), []
    for step in plan[:14]:                    # cap so we never over-fire
        if not isinstance(step, dict):
            continue
        name = step.get('name')
        params = step.get('params') or step.get('args') or {}
        if not isinstance(params, dict):
            params = {}
        key = f"{name}:{sorted(params.items())}"
        if name not in REGISTRY or key in seen:
            continue
        seen.add(key)
        try:
            fact = REGISTRY[name][2](engine, params)
        except Exception:
            fact = ""
        if fact and fact.strip():
            lines.append("• " + fact.strip())
    if not lines:
        return ""
    return "=== DEEP ANALYSIS (the witnesses this question calls for — real, computed) ===\n" + "\n".join(lines)


def _run_registry(host, reg, plan):
    seen, lines = set(), []
    for step in (plan or [])[:12]:
        if not isinstance(step, dict):
            continue
        name, params = step.get('name'), (step.get('params') or {})
        if not isinstance(params, dict):
            params = {}
        key = f"{name}:{sorted(params.items())}"
        if name not in reg or key in seen:
            continue
        seen.add(key)
        try:
            fact = reg[name][2](host, params)
        except Exception:
            fact = ""
        if fact and fact.strip():
            lines.append("• " + fact.strip())
    if not lines:
        return ""
    return "=== DEEP ANALYSIS (the witnesses this question calls for — real, computed) ===\n" + "\n".join(lines)


def _with_known_gender(plan, birth_data):
    """The person's gender, from their birth record, on every step that reads one.

    The planner cannot know it — it sees the question, not the profile — and its
    toolbox hint says "gender: male/female", so it guesses, or the step falls back
    to "male". The luck decades run FORWARD or BACKWARD by the year stem's
    polarity and the person's gender, so a guess reverses a woman's whole timeline.
    The record wins over the planner whenever the record has an answer."""
    g = (birth_data or {}).get('gender')
    if g not in ('male', 'female') or not isinstance(plan, list):
        return plan
    out = []
    for step in plan:
        if isinstance(step, dict) and step.get('name') == 'luck':
            step = {**step, 'params': {**(step.get('params') or {}), 'gender': g}}
        out.append(step)
    return out


def run_deep(system, birth_data, vedic_engine, plan):
    """System-aware deep analysis: Vedic uses the jyotish engine; Western/Chinese
    build their own chart from birth_data and run their own council."""
    s = (system or 'bphs').lower()
    try:
        if s == 'western':
            return _run_registry(_west(birth_data), WEST_REGISTRY, plan) if birth_data else ""
        if s == 'chinese':
            return (_run_registry(_bazi(birth_data), CN_REGISTRY, _with_known_gender(plan, birth_data))
                    if birth_data else "")
        return run_plan(vedic_engine, plan)
    except Exception:
        return run_plan(vedic_engine, plan) if s not in ('western', 'chinese') else ""
