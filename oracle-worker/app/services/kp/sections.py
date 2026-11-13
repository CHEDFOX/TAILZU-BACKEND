"""KP SECTION BUILDERS — raw data for each KP section."""

from app.services.oracle.section_errors import note_section_failure, vet_section


def build_base_chart(engine) -> str:
    """KP base chart — planets with star lord and sub lord."""
    from .chart_builder import build_kp_chart
    return build_kp_chart(engine)


def build_cusps(engine) -> str:
    from ..kp.kp_complete import KPComplete
    kpc = KPComplete(engine)
    cusps = kpc.get_placidus_cusps()
    lines = []
    for h in range(1, 13):
        c = cusps.get(h, {})
        lines.append(f"H{h:2d}: {c.get('rashi_name', ''):12s} {c.get('degree_in_sign', 0):5.1f}° | Star: {c.get('nakshatra_lord', ''):8s} Sub: {c.get('sub_lord', ''):8s}")
    return "\n".join(lines)


def build_significators(engine) -> str:
    from ..kp.kp_complete import KPComplete
    kpc = KPComplete(engine)
    lines = []
    for planet in ['Sun', 'Moon', 'Mars', 'Mercury', 'Jupiter', 'Venus', 'Saturn', 'Rahu', 'Ketu']:
        try:
            sig = kpc.get_planet_significators(planet)
            houses = sig.get('all_signified_houses', sig.get('signifies', []))
            lines.append(f"{planet:8s} signifies H{','.join(str(h) for h in sorted(houses) if isinstance(h, int))}")
        except Exception:
            pass
    return "\n".join(lines)


def build_event_promise(engine, topic: str = None) -> str:
    from ..kp.kp_complete import KPComplete
    kpc = KPComplete(engine)
    lines = []
    events = [topic] if topic else ['marriage', 'career', 'wealth', 'childbirth', 'education', 'travel_foreign']
    for event in events:
        try:
            result = kpc.analyze_event_kp(event)
            lines.append(f"{event}: {result.get('verdict', '')} — CSL {result.get('cusp_sub_lord', '')} signifies H{','.join(str(h) for h in result.get('csl_signified_houses', []))}")
        except Exception:
            pass
    return "\n".join(lines)


def build_ruling_planets(engine) -> str:
    from ..kp.kp_complete import KPComplete
    kpc = KPComplete(engine)
    rp = kpc.get_ruling_planets()
    lines = [
        f"Day lord: {rp.get('day_lord', '')}",
        f"Moon sign lord: {rp.get('moon_sign_lord', '')}",
        f"Moon star lord: {rp.get('moon_star_lord', '')}",
        f"Moon sub lord: {rp.get('moon_sub_lord', '')}",
        f"Asc sign lord: {rp.get('asc_sign_lord', '')}",
        f"Asc star lord: {rp.get('asc_star_lord', '')}",
        f"Ruling planets: {', '.join(rp.get('ruling_planets', []))}",
    ]
    return "\n".join(lines)


def build_dba_timing(engine, topic: str = None) -> str:
    from ..kp.kp_timing import KPTransitTiming
    kpt = KPTransitTiming(engine)
    if topic:
        result = kpt.check_dba_for_event(topic)
        md = result.get('mahadasha', {})
        ad = result.get('antardasha', {})
        return f"DBA for {topic}: {result.get('verdict', '')}\n  MD {md.get('lord', '')} matches H{','.join(str(h) for h in md.get('matches', []))}\n  AD {ad.get('lord', '')} matches H{','.join(str(h) for h in ad.get('matches', []))}"
    else:
        scan = kpt.scan_dba_all_events()
        lines = [f"Top active: {', '.join(scan.get('top_active_events', []))}"]
        for event, data in list(scan.get('events', {}).items())[:6]:
            lines.append(f"  {event}: {data.get('matches', 0)}/3 DBA match — {data.get('confidence', '')}")
        return "\n".join(lines)


def build_transit_triggers(engine, topic: str = None) -> str:
    from ..kp.kp_timing import KPTransitTiming
    kpt = KPTransitTiming(engine)
    topic = topic or "career"
    triggers = kpt.check_transit_triggers(topic)
    lines = []
    for t in triggers[:5]:
        status = "★ ACTIVE" if t.get('active') else "partial"
        lines.append(f"{t.get('transit_planet', ''):8s} in {t.get('transit_sign', ''):12s} Star:{t.get('star_lord', ''):8s} Sub:{t.get('sub_lord', ''):8s} [{status}]")
    return "\n".join(lines) if lines else "No active transit triggers"


def build_horary(engine, number: int = None) -> str:
    if not number:
        return "No KP number provided"
    from ..kp.kp_horary import KPHorary
    kph = KPHorary(number, "", "general", engine.latitude, engine.longitude)
    result = kph.analyze()
    return f"Number {number}: {result.get('ascendant', {}).get('sign', '')} / {result.get('ascendant', {}).get('star', '')} / {result.get('ascendant', {}).get('sub', '')}\nVerdict: {result.get('verdict', '')} ({result.get('confidence_pct', '')}%)\nReason: {result.get('reasoning', '')}"


def build_fortuna(engine) -> str:
    from ..kp.kp_complete import KPComplete
    kpc = KPComplete(engine)
    f = kpc.get_kp_fortuna()
    return f"Fortuna: {f.get('sign', '')} H{f.get('house', '')} | Star: {f.get('star_lord', '')} Sub: {f.get('sub_lord', '')} — {f.get('interpretation', '')}"


def build_fruitfulness(engine) -> str:
    from ..kp.kp_complete import KPComplete
    kpc = KPComplete(engine)
    lines = []
    for h in [5, 7]:
        f = kpc.check_fruitfulness(h)
        lines.append(f"H{h}: CSL {f.get('cusp_sub_lord', '')} in {f.get('csl_sign', '')} — {f.get('fertility', '')} ({f.get('strength', '')})")
    return "\n".join(lines)


def build_untenanted(engine) -> str:
    from ..kp.kp_complete import KPComplete
    kpc = KPComplete(engine)
    result = kpc.get_untenanted_houses()
    lines = [f"Untenanted: H{','.join(str(h) for h in result.get('untenanted_houses', []))}"]
    for d in result.get('details', [])[:6]:
        lines.append(f"  H{d.get('house', '')}: owner {d.get('owner', '')}, CSL {d.get('cusp_sub_lord', '')}")
    return "\n".join(lines)


SECTION_MAP = {
    'cusps': ('CUSPAL SUB-LORDS', cusps_fn := build_cusps),
    'significators': ('SIGNIFICATORS', build_significators),
    'event_promise': ('EVENT PROMISE', build_event_promise),
    'ruling_planets': ('RULING PLANETS', build_ruling_planets),
    'dba_timing': ('DBA TIMING', build_dba_timing),
    'transit_triggers': ('TRANSIT TRIGGERS', build_transit_triggers),
    'horary': ('KP HORARY', build_horary),
    'fortuna': ('FORTUNA', build_fortuna),
    'fruitfulness': ('FRUITFULNESS', build_fruitfulness),
    'untenanted': ('UNTENANTED HOUSES', build_untenanted),
    'medical': ('KP MEDICAL', lambda e: _build_kp_medical(e)),
    'stellar_theory': ('STELLAR THEORY', lambda e: _build_stellar(e)),
    'four_level': ('4-LEVEL CHAIN', lambda e: _build_four_level(e)),
}


def _build_kp_medical(engine) -> str:
    result = engine.get_kp_medical()
    lines = []
    for key in ['constitution', 'disease_tendency', 'vulnerable_area', 'chronic_risk', 'hospitalization']:
        val = result.get(key, '')
        if val:
            lines.append(f"  {key.replace('_', ' ').title()}: {val}")
    return "\n".join(lines)

def _build_stellar(engine) -> str:
    result = engine.get_kp_stellar_theory()
    lines = []
    for planet, data in result.items():
        if isinstance(data, dict):
            lines.append(f"  {data.get('behavior', '')}")
    return "\n".join(lines[:9])

def _build_four_level(engine) -> str:
    lines = []
    for name in ['Moon', 'Sun', 'Mars', 'Mercury', 'Jupiter', 'Venus', 'Saturn']:
        r = engine.get_kp_four_level(name)
        lines.append(f"  {name}: Star={r.get('star_lord','')} Sub={r.get('sub_lord','')} SS={r.get('sub_sub_lord','')} SSS={r.get('sub_sub_sub_lord','')}")
    return "\n".join(lines)


def build_sections(engine, section_names: list, topic: str = None, extras: dict = None) -> str:
    extras = extras or {}
    parts = []
    for name in section_names:
        entry = SECTION_MAP.get(name)
        if not entry:
            continue
        label, builder = entry
        try:
            if name == 'horary':
                text = builder(engine, extras.get('kp_number'))
            elif name in ('event_promise', 'dba_timing', 'transit_triggers') and topic:
                text = builder(engine, topic)
            else:
                text = builder(engine)
            text = vet_section('kp', name, text)
            if text and text.strip():
                parts.append(f"{label}:\n{text}")
        except Exception as _e:
            # Do not swallow this. A dropped section leaves the responder
            # believing it has data it was never given, and it writes anyway.
            note_section_failure('kp', name, _e)
            continue
    return "\n\n".join(parts)

# ═══ NEW KP SECTIONS ═══
def _build_sensitive_pts(engine) -> str:
    r = engine.get_kp_sensitive_points(6)
    if not isinstance(r, dict):
        return ""
    triggers = r.get('triggers') or []
    if triggers:
        return "\n".join(f"  {t.get('date','')}: {t.get('planet','')} crosses H{t.get('house','')} cusp (dist {t.get('distance','')}°)" for t in triggers[:8])
    near = r.get('closest') or []
    if not near:
        return ""
    return (f"No slow planet (Jupiter, Saturn, Rahu) comes within {r.get('orb', 2.0)}° of a cusp in the next "
            f"{r.get('months_scanned', 6)} months. Nearest: " + "; ".join(
                f"{c['planet']} {c['distance']}° from the H{c['house']} cusp around {c['date']}" for c in near))

def _build_kp_profession(engine) -> str:
    r = engine.get_kp_profession()
    return f"10th CSL: {r.get('10th_csl','')} | Nature: {r.get('nature','')} | Govt: {r.get('government','')} | Fields: {', '.join(r.get('fields',[]))}" if isinstance(r, dict) else ""

def _build_interlinks(engine) -> str:
    r = engine.get_kp_cuspal_interlinks()
    return "\n".join(f"  H{i.get('house1','')}-H{i.get('house2','')}: {i.get('meaning','')}" for i in (r if isinstance(r, list) else [])[:6])

def _build_lost_obj(engine) -> str:
    r = engine.get_kp_lost_object()
    return f"Direction: {r.get('direction','')} | Found: {r.get('will_be_found','')} | {r.get('advice','')}" if isinstance(r, dict) else ""

def _build_rp_timing(engine) -> str:
    r = engine.get_kp_rp_timing()
    if isinstance(r, dict):
        return f"RP: {', '.join(r.get('ruling_planets',[]))} | Day: {r.get('current_day_lord','')} | Hora: {r.get('current_hora_lord','')} | Active: {r.get('rp_active','')}"
    return ""

SECTION_MAP['sensitive_points'] = ('SENSITIVE POINT CALENDAR', _build_sensitive_pts)
SECTION_MAP['kp_profession'] = ('KP PROFESSION', _build_kp_profession)
SECTION_MAP['cuspal_interlinks'] = ('CUSPAL INTERLINKS', _build_interlinks)
SECTION_MAP['lost_object'] = ('LOST OBJECT', _build_lost_obj)
SECTION_MAP['rp_timing'] = ('RULING PLANET TIMING', _build_rp_timing)


def _build_ruling_now(engine) -> str:
    try:
        from app.services.lifestyle import kp as kp_life
        return kp_life.briefing(engine)
    except Exception:
        return ""

SECTION_MAP['ruling_now'] = ('RULING PLANETS NOW (favourable moment / colour / direction)', _build_ruling_now)
