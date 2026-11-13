"""WESTERN SECTION BUILDERS — raw data for each Western section."""

from app.services.oracle.section_errors import note_section_failure, vet_section
from datetime import datetime


def _get_chart(engine):
    from .chart import WesternChart
    wc = WesternChart(engine.birth_dt, engine.latitude, engine.longitude)
    wc._ensure_calculated()
    return wc


def build_base_chart(engine) -> str:
    from .chart_builder import build_western_chart
    return build_western_chart(engine)


def build_aspects(engine) -> str:
    wc = _get_chart(engine)
    aspects = wc.get_aspects()
    lines = []
    for a in aspects[:12]:
        lines.append(f"{a['planet1']:10s} {a['aspect']:16s} {a['planet2']:10s} orb {a['orb']}° ({a['nature']})")
    return "\n".join(lines)


def build_configurations(engine) -> str:
    wc = _get_chart(engine)
    configs = wc.get_configurations()
    if not configs:
        return "No major configurations"
    lines = []
    for c in configs:
        lines.append(f"{c['name']}: {', '.join(c.get('planets', []))} — {c.get('description', '')[:80]}")
    return "\n".join(lines)


def build_progressions(engine) -> str:
    from .timing import SecondaryProgressions
    wc = _get_chart(engine)
    sp = SecondaryProgressions(wc).get_progressed_chart()
    lines = [f"Age: {sp.get('age_years', '')}"]
    pm = sp.get('progressed_moon', {})
    lines.append(f"Progressed Moon: {pm.get('sign', '')} H{pm.get('house', '')} — {pm.get('theme', '')}")
    changes = sp.get('sign_changes', [])
    if changes:
        lines.append(f"Sign changes: {', '.join(changes)}")
    for a in sp.get('aspects_to_natal', [])[:5]:
        lines.append(f"  P.{a['progressed']} {a['aspect']} N.{a['natal']} (orb {a['orb']}°)")
    return "\n".join(lines)


def build_solar_return(engine, year: int = None) -> str:
    from .timing import SolarReturn
    wc = _get_chart(engine)
    y = year or datetime.now().year
    sr = SolarReturn(wc, y).generate_solar_return()
    lines = [
        f"Year {y} — SR Ascendant: {sr.get('sr_ascendant', '')}",
        f"SR Sun H{sr.get('sr_sun_house', '')}: {sr.get('year_theme', '')}",
        f"SR Moon {sr.get('sr_moon_sign', '')} H{sr.get('sr_moon_house', '')}: {sr.get('emotional_theme', '')}",
    ]
    return "\n".join(lines)


def build_lunar_return(engine) -> str:
    from .extras import calculate_lunar_return
    wc = _get_chart(engine)
    natal_moon = wc.planets['Moon']['longitude']
    lr = calculate_lunar_return(natal_moon, engine.latitude, engine.longitude)
    return f"Lunar Return: {lr.get('lr_ascendant', '')} rising\nMoon H{lr.get('lr_moon_house', '')}: {lr.get('emotional_focus', '')}"


def build_solar_arc(engine) -> str:
    from .timing import SolarArcDirections
    wc = _get_chart(engine)
    sa = SolarArcDirections(wc).get_solar_arc()
    lines = [f"Solar Arc: {sa.get('solar_arc_degrees', '')}° (age {sa.get('age', '')})"]
    for a in sa.get('directed_aspects', [])[:5]:
        lines.append(f"  SA {a.get('directed', '')} {a.get('aspect', '')} N.{a.get('natal', '')} (orb {a.get('orb', '')}°)")
    return "\n".join(lines)


def build_lilith(engine) -> str:
    from .extras import calculate_lilith
    l = calculate_lilith(engine.birth_dt)
    return f"Lilith: {l.get('sign', '')} {l.get('degree', '')}° — {l.get('description', '')}"


def build_fortune(engine) -> str:
    from .extras import calculate_part_of_fortune
    wc = _get_chart(engine)
    is_night = wc.planets['Sun'].get('house', 1) > 6
    pof = calculate_part_of_fortune(wc._ascendant, wc.planets['Sun']['longitude'], wc.planets['Moon']['longitude'], is_night)
    return f"Part of Fortune: {pof.get('sign', '')} {pof.get('degree', '')}° — {pof.get('description', '')}"


def build_fixed_stars(engine) -> str:
    from .extras import check_fixed_star_conjunctions
    wc = _get_chart(engine)
    stars = check_fixed_star_conjunctions(wc.planets)
    if not stars:
        return "No major fixed star conjunctions"
    lines = []
    for s in stars[:5]:
        lines.append(f"{s['planet']} conjunct {s['star']} (orb {s['orb']}°): {s['meaning'][:80]}")
    return "\n".join(lines)


def build_void_moon(engine) -> str:
    from .extras import check_void_of_course
    from .chart import WesternChart
    wc = WesternChart(datetime.utcnow(), engine.latitude, engine.longitude)
    wc._ensure_calculated()
    vom = check_void_of_course(wc.planets['Moon']['longitude'], wc.planets)
    return f"Moon in {vom.get('moon_sign', '')}: {vom.get('interpretation', '')}"


def build_element_balance(engine) -> str:
    wc = _get_chart(engine)
    b = wc.get_element_balance()
    e = b['elements']
    return f"Fire={e['Fire']} Earth={e['Earth']} Air={e['Air']} Water={e['Water']}\nDominant: {b['dominant_element']} | Weak: {b['weak_element']} | Mode: {b['dominant_modality']}"


def build_synastry(engine) -> str:
    return "Synastry requires partner data"


def build_composite(engine) -> str:
    return "Composite requires partner data"


def build_retrogrades(engine) -> str:
    from .extras import check_retrograde_stations
    wc = _get_chart(engine)
    stations = check_retrograde_stations(engine.birth_dt, wc.planets)
    retros = [n for n in wc.planets if wc.planets[n].get('retrograde') and n not in ('North Node', 'South Node')]
    lines = []
    if retros:
        lines.append(f"Natal retrogrades: {', '.join(retros)}")
    for s in stations:
        lines.append(f"STATIONARY: {s['planet']} — {s['station']} in {s['sign']} ({s['power']})")
    return "\n".join(lines) if lines else "No retrogrades or stations"


SECTION_MAP = {
    'aspects': ('ASPECTS', build_aspects),
    'configurations': ('CONFIGURATIONS', build_configurations),
    'progressions': ('SECONDARY PROGRESSIONS', build_progressions),
    'solar_return': ('SOLAR RETURN', build_solar_return),
    'lunar_return': ('LUNAR RETURN', build_lunar_return),
    'solar_arc': ('SOLAR ARC DIRECTIONS', build_solar_arc),
    'lilith': ('BLACK MOON LILITH', build_lilith),
    'fortune': ('PART OF FORTUNE', build_fortune),
    'fixed_stars': ('FIXED STARS', build_fixed_stars),
    'void_moon': ('VOID OF COURSE MOON', build_void_moon),
    'element_balance': ('ELEMENT BALANCE', build_element_balance),
    'synastry': ('SYNASTRY', build_synastry),
    'composite': ('COMPOSITE', build_composite),
    'retrogrades': ('RETROGRADES', build_retrogrades),
    'profections': ('ANNUAL PROFECTIONS', lambda e: _build_profections(e)),
    'sect': ('SECT (DAY/NIGHT)', lambda e: _build_sect(e)),
    'arabic_parts': ('ARABIC PARTS', lambda e: _build_arabic_parts(e)),
    'zodiacal_releasing': ('ZODIACAL RELEASING', lambda e: _build_zr(e)),
    'antiscia': ('ANTISCIA', lambda e: _build_antiscia(e)),
    'midpoints': ('MIDPOINTS (COSMOBIOLOGY)', lambda e: _build_midpoints(e)),
    'harmonics': ('HARMONIC CHARTS', lambda e: _build_harmonics(e)),
    'western_horary': ('WESTERN HORARY', lambda e: _build_western_horary(e)),
    'mutual_receptions': ('MUTUAL RECEPTIONS', lambda e: _build_mutual_receptions(e)),
}


def _build_profections(engine) -> str:
    result = engine.get_western_profections()
    return f"Age {result.get('age', '')}: H{result.get('profected_house', '')} ({result.get('profected_sign', '')})\nLord of Year: {result.get('time_lord', '')} — {result.get('time_lord_meaning', '')}\nTheme: {result.get('theme', '')}"

def _build_sect(engine) -> str:
    result = engine.get_western_sect()
    lines = [f"Chart type: {result.get('chart_type', '')}"]
    for key in ['benefic_of_sect', 'malefic_of_sect', 'malefic_contrary']:
        d = result.get(key, {})
        if isinstance(d, dict):
            lines.append(f"  {d.get('planet', '')}: {d.get('role', '')} (H{d.get('house', '')})")
    return "\n".join(lines)

def _build_arabic_parts(engine) -> str:
    parts = engine.get_western_arabic_parts()
    lines = []
    for name in ['Fortune', 'Spirit', 'Eros', 'Marriage', 'Career', 'Children']:
        p = parts.get(name, {})
        if isinstance(p, dict):
            lines.append(f"  {name}: {p.get('sign', '')} {p.get('degree', '')}° — {p.get('meaning', '')}")
    return "\n".join(lines)

def _build_zr(engine) -> str:
    result = engine.get_western_zodiacal_releasing()
    cp = result.get('current_period', {})
    if isinstance(cp, dict):
        peak = " ★ PEAK PERIOD" if cp.get('peak') else ""
        return f"Current: {cp.get('sign', '')} (age {cp.get('start_age', '')}-{cp.get('end_age', '')}){peak}\nSystem: {result.get('system', '')}"
    return ""

def _build_antiscia(engine) -> str:
    result = engine.get_western_antiscia()
    connections = result.get('hidden_connections', [])
    if connections:
        lines = [f"  {c.get('planet1', '')} ↔ {c.get('planet2', '')} ({c.get('type', '')}, orb {c.get('orb', '')}°)" for c in connections[:5]]
        return "\n".join(lines)
    return "No close antiscia connections"

def _build_midpoints(engine) -> str:
    result = engine.get_western_midpoints()
    acts = result.get('activations', [])
    if acts:
        lines = [f"  {a.get('planet', '')} on {a.get('midpoint', '')} ({a.get('aspect', '')}, orb {a.get('orb', '')}°): {a.get('meaning', '')[:60]}" for a in acts[:6]]
        return "\n".join(lines)
    return "No natal midpoint activations"

def _build_harmonics(engine) -> str:
    result = engine.get_western_harmonics()
    lines = []
    for key in ['h5_creativity', 'h7_inspiration', 'h9_spiritual']:
        h = result.get(key, {})
        if isinstance(h, dict):
            conj = h.get('conjunctions', [])
            conj_str = ", ".join(f"{c.get('planet1','')}-{c.get('planet2','')}" for c in conj[:3]) if conj else "none"
            lines.append(f"  {h.get('title', '')}: conjunctions: {conj_str}")
    return "\n".join(lines)

def _build_western_horary(engine) -> str:
    return "Cast at moment of question — requires live query"

def _build_mutual_receptions(engine) -> str:
    result = engine.get_western_mutual_receptions()
    if isinstance(result, list) and result:
        lines = [f"  {r.get('planet1', '')} in {r.get('sign1', '')} ↔ {r.get('planet2', '')} in {r.get('sign2', '')} — {r.get('meaning', '')[:60]}" for r in result]
        return "\n".join(lines)
    return "No mutual receptions"


def build_sections(engine, section_names: list, topic: str = None, extras: dict = None) -> str:
    parts = []
    for name in section_names:
        entry = SECTION_MAP.get(name)
        if not entry:
            continue
        label, builder = entry
        try:
            text = builder(engine)
            text = vet_section('western', name, text)
            if text and text.strip():
                parts.append(f"{label}:\n{text}")
        except Exception as _e:
            # Do not swallow this. A dropped section leaves the responder
            # believing it has data it was never given, and it writes anyway.
            note_section_failure('western', name, _e)
            continue
    return "\n\n".join(parts)

# ═══ NEW WESTERN SECTIONS ═══
def _build_dignities_full(engine) -> str:
    r = engine.get_western_full_dignities()
    lines = []
    for p, d in (r if isinstance(r, dict) else {}).items():
        if isinstance(d, dict):
            lines.append(f"  {p}: score {d.get('score',0)} | {', '.join(d.get('dignities',[]))}")
    return "\n".join(lines)

def _build_almuten(engine) -> str:
    r = engine.get_western_almuten()
    return f"Almuten: {r.get('almuten','')} (score {r.get('score',0)})" if isinstance(r, dict) else ""

def _build_hayz(engine) -> str:
    r = engine.get_western_hayz()
    lines = [f"  {p}: {d.get('condition','')}" for p, d in (r if isinstance(r, dict) else {}).items()]
    return "\n".join(lines)

def _build_joys(engine) -> str:
    r = engine.get_western_joys()
    in_joy = [j for j in (r if isinstance(r, list) else []) if j.get('in_joy')]
    return "\n".join(f"  {j.get('planet','')} in H{j.get('joy_house','')} — REJOICING" for j in in_joy) if in_joy else "No planets in their joy houses"

def _build_asteroids(engine) -> str:
    r = engine.get_western_asteroids()
    return "\n".join(f"  {n}: {d.get('sign','')} {d.get('degree','')}° — {d.get('meaning','')[:60]}" for n, d in (r if isinstance(r, dict) else {}).items())

def _build_planet_nodes(engine) -> str:
    r = engine.get_western_planetary_nodes()
    lines = [f"  {p}: NN {d.get('north_node',{}).get('sign','')} / SN {d.get('south_node',{}).get('sign','')}" for p, d in list((r if isinstance(r, dict) else {}).items())[:5]]
    return "\n".join(lines)

def _build_prenatal(engine) -> str:
    r = engine.get_western_prenatal()
    return f"{r.get('type','')}: {r.get('sign','')} {r.get('degree','')}° ({r.get('date','')}) — {r.get('meaning','')}" if isinstance(r, dict) else ""

def _build_decennials(engine) -> str:
    r = engine.get_western_decennials()
    c = r.get('current', {}) if isinstance(r, dict) else {}
    return f"Current: {c.get('planet','')} (age {c.get('start_age','')}-{c.get('end_age','')})" if c else ""

def _build_tertiary(engine) -> str:
    r = engine.get_western_tertiary()
    return f"Tertiary Moon: {r.get('tertiary_moon_sign','')} H{r.get('tertiary_moon_house','')}" if isinstance(r, dict) else ""

def _build_converse(engine) -> str:
    r = engine.get_western_converse()
    return f"Converse Moon: {r.get('converse_moon_sign','')} — {r.get('meaning','')}" if isinstance(r, dict) else ""

def _build_prog_lunation(engine) -> str:
    r = engine.get_western_prog_lunation()
    return f"Phase: {r.get('phase','')} | Angle: {r.get('angle','')}° | Next New Moon age: {r.get('next_new_moon_age','')}" if isinstance(r, dict) else ""

def _build_electional(engine) -> str:
    r = engine.get_western_electional()
    if isinstance(r, dict):
        return f"Score: {r.get('score','')}/100 ({r.get('rating','')}) | VoC: {r.get('void_of_course','')}\n" + "\n".join(f"  {f}" for f in r.get('factors',[]))
    return ""

SECTION_MAP['full_dignities'] = ('5-TIER ESSENTIAL DIGNITIES', _build_dignities_full)
SECTION_MAP['almuten'] = ('ALMUTEN', _build_almuten)
SECTION_MAP['hayz'] = ('HAYZ / PLANETARY CONDITION', _build_hayz)
SECTION_MAP['planetary_joys'] = ('PLANETARY JOYS', _build_joys)
SECTION_MAP['asteroids'] = ('ASTEROIDS', _build_asteroids)
SECTION_MAP['planetary_nodes'] = ('PLANETARY NODES', _build_planet_nodes)
SECTION_MAP['prenatal'] = ('PRENATAL ECLIPSE/LUNATION', _build_prenatal)
SECTION_MAP['decennials'] = ('DECENNIALS', _build_decennials)
SECTION_MAP['tertiary'] = ('TERTIARY PROGRESSIONS', _build_tertiary)
SECTION_MAP['converse'] = ('CONVERSE PROGRESSIONS', _build_converse)
SECTION_MAP['prog_lunation'] = ('PROGRESSED LUNATION CYCLE', _build_prog_lunation)
SECTION_MAP['electional'] = ('ELECTIONAL ASTROLOGY', _build_electional)


def _build_daily_guidance(engine) -> str:
    try:
        from app.services.lifestyle import western
        return western.briefing(engine)
    except Exception:
        return ""

SECTION_MAP['daily_guidance'] = ('TODAY — DAILY GUIDANCE (day ruler / Moon phase / hour)', _build_daily_guidance)
