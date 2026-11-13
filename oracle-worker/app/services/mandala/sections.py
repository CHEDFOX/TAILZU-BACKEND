"""
MANDALA SECTION BUILDERS
Each function takes a JyotishEngine and returns clean text for the Oracle.
"""
from app.services.oracle.section_errors import note_section_failure, vet_section

def build_base_chart(engine) -> str:
    """Base chart for mandala — birth location + directional summary."""
    planets = engine.planets
    asc = engine.ascendant
    lines = [
        f"Birth: {engine.latitude:.2f}N, {engine.longitude:.2f}E",
        f"Ascendant: {asc.get('rashi_name', '')} ({asc.get('nakshatra_name', '')})",
    ]
    for name in ["Sun","Moon","Mars","Mercury","Jupiter","Venus","Saturn","Rahu","Ketu"]:
        d = planets.get(name, {})
        retro = " R" if d.get("retrograde") else ""
        lines.append(f"{name:8s} {d.get('rashi_name',''):12s} H{str(d.get('house','?')):<3s}{retro}")
    return "\n".join(lines)


def _build_power_map(engine) -> str:
    try:
        r = engine.get_power_map()
        lines = []
        s = r.get("strongest_line", {})
        if s:
            lines.append(f"Closest line: {s.get('planet','')} {s.get('angle','')} ({s.get('keyword','')})")
            lines.append(f"  Effect: {s.get('effect','')}")
        zones = r.get("power_zones", [])
        for z in zones[:5]:
            lines.append(f"Zone: {z.get('planets',[])} at {z.get('lat',0)}N {z.get('lng',0)}E — {z.get('quality','')}")
        crossings = r.get("crossings", [])
        for c in crossings[:3]:
            lines.append(f"Crossing: {c.get('planet','')} MC×ASC at {c.get('lat',0)}N {c.get('lng',0)}E — {c.get('intensity','')}")
        return "\n".join(lines)
    except Exception as e:
        return f"Power map error: {str(e)[:80]}"


def _build_best_cities(engine) -> str:
    try:
        r = engine.get_best_cities()
        lines = []
        for c in r.get("top_5", []):
            lines.append(f"  {c['city']:15s} {c['score']:3d}/100 ({c['rating']}) — {c.get('key_change','')[:60]}")
        avoid = r.get("avoid", [])
        if avoid:
            lines.append("Avoid:")
            for c in avoid[:2]:
                lines.append(f"  {c['city']:15s} {c['score']:3d}/100")
        return "\n".join(lines)
    except Exception as e:
        return f"City ranking error: {str(e)[:80]}"


def _build_here_now(engine) -> str:
    try:
        r = engine.get_here_now()
        lines = [
            f"Location: {r.get('city','')} — {r.get('rating','')} ({r.get('overall_score',0)}/100)",
            f"Relocated ASC: {r.get('relocated_ascendant','')} (natal: {r.get('natal_ascendant','')})",
        ]
        s = r.get("scores", {})
        for area in ["career","love","health","wealth","spiritual"]:
            lines.append(f"  {area:10s} {s.get(area,0):3d}/100")
        changes = r.get("key_changes", [])
        for c in changes[:3]:
            lines.append(f"  {c}")
        return "\n".join(lines)
    except Exception as e:
        return f"Here now error: {str(e)[:80]}"


def _build_compass(engine) -> str:
    try:
        r = engine.get_compass()
        lines = [
            f"Primary: {r.get('primary_direction','')}",
            f"Secondary: {r.get('secondary_direction','')}",
            f"Avoid: {r.get('avoid_direction','')}",
        ]
        life = r.get("life_areas", {})
        for area, data in life.items():
            lines.append(f"  {area:10s} → {data.get('direction','')} ({data.get('score',0)})")
        compass = r.get("compass", [])
        for c in compass[:4]:
            tag = " [TRANSIT]" if c.get("transit_active") else ""
            lines.append(f"  {c['direction']:12s} {c['score']:3d} | {', '.join(c.get('planets',[]))} | {c.get('theme','')}{tag}")
        return "\n".join(lines)
    except Exception as e:
        return f"Compass error: {str(e)[:80]}"


def _build_relocation(engine) -> str:
    try:
        r = engine.get_relocation()
        lines = [
            f"Location: {r.get('city','')} — {r.get('rating','')} ({r.get('overall_score',0)}/100)",
            f"Best for: {r.get('best_for','')} | Worst for: {r.get('worst_for','')}",
        ]
        changes = r.get("key_changes", [])
        for c in changes[:5]:
            lines.append(f"  {c}")
        return "\n".join(lines)
    except Exception as e:
        return f"Relocation error: {str(e)[:80]}"


def _build_travel_windows(engine) -> str:
    try:
        r = engine.get_travel_windows(6)
        lines = []
        c = r.get("current", {})
        lines.append(f"Now: {'Favorable' if c.get('favorable') else 'Not ideal'} ({c.get('score',0)}/100)")
        for f in c.get("factors", []):
            lines.append(f"  {f}")
        windows = r.get("best_windows", [])
        for w in windows[:3]:
            lines.append(f"Window: {w.get('start','')} to {w.get('end','')} (avg {w.get('average_score',0)}, peak {w.get('peak_month','')})")
        d = r.get("best_direction", {})
        lines.append(f"Direction: {d.get('primary','')} | Foreign: {d.get('foreign','')}")
        lines.append(f"  {d.get('explanation','')}")
        dt = r.get("dasha_travel", {})
        lines.append(f"Dasha: {dt.get('assessment','')}")
        return "\n".join(lines)
    except Exception as e:
        return f"Travel error: {str(e)[:80]}"


SECTION_MAP = {
    "power_map":      ("ASTROCARTOGRAPHY (POWER MAP)", _build_power_map),
    "best_cities":    ("BEST CITIES FOR YOUR CHART", _build_best_cities),
    "here_now":       ("CURRENT LOCATION EFFECT", _build_here_now),
    "compass":        ("DIRECTION COMPASS", _build_compass),
    "relocation":     ("RELOCATION ANALYSIS", _build_relocation),
    "travel_windows": ("TRAVEL WINDOWS", _build_travel_windows),
}


def build_sections(engine, section_names: list, topic: str = None, extras: dict = None) -> str:
    parts = []
    for name in section_names:
        entry = SECTION_MAP.get(name)
        if not entry:
            continue
        label, builder = entry
        try:
            text = builder(engine)
            # The builders here catch their own exceptions and RETURN "Error: …"
            # — which went into the briefing as if it were chart data. Treat it as
            # the failure it is: report it and drop the section.
            if text and text.lstrip().startswith("Error:"):
                raise RuntimeError(text.strip()[:200])
            text = vet_section('mandala', name, text)
            if text and text.strip():
                parts.append(f"{label}:\n{text}")
        except Exception as _e:
            # Do not swallow this. A dropped section leaves the responder
            # believing it has data it was never given, and it writes anyway.
            note_section_failure('mandala', name, _e)
            continue
    return "\n\n".join(parts)


def _build_local_space(engine) -> str:
    try:
        r = engine.get_local_space()
        lines = []
        for p, d in r.get("lines",{}).items():
            lines.append(f"  {p:8s} {d.get('direction',''):12s} ({d.get('azimuth',0):>5.1f}) — {d.get('activate_when','')[:50]}")
        sp = r.get("strongest_pull",{})
        if sp: lines.append(f"Strongest: {sp.get('planet','')} {sp.get('direction','')}")
        lines.append(f"Love: {r.get('love_direction','')} | Career: {r.get('career_direction','')} | Spiritual: {r.get('spiritual_direction','')}")
        return "\n".join(lines)
    except Exception as e: return f"Error: {str(e)[:80]}"

def _build_geodetic_zodiac(engine) -> str:
    try:
        r = engine.get_geodetic_zodiac()
        lines = []
        b = r.get("birth",{})
        lines.append(f"Birth geodetic: {b.get('geodetic_sign','')} — {b.get('power_level','')}")
        lines.append(f"  {b.get('interpretation','')}")
        if b.get("resonant_planets"): lines.append(f"  Resonant: {', '.join(b['resonant_planets'])}")
        for m in r.get("country_matches",[])[:5]:
            lines.append(f"  {m['country']:15s} ({m['geodetic_sign']}) {m['score']:3d} — {'; '.join(m.get('reasons',[])[:2])}")
        return "\n".join(lines)
    except Exception as e: return f"Error: {str(e)[:80]}"

def _build_parans(engine) -> str:
    try:
        r = engine.get_parans()
        lines = []
        bp = r.get("birth_paran",{})
        if bp: lines.append(f"Birth paran: {bp.get('planet_1','')}-{bp.get('planet_2','')} at {bp.get('latitude',0)} — {bp.get('theme','')}")
        for p in r.get("favorable_bands",[])[:4]:
            lines.append(f"  {p.get('latitude',0):>5.1f} {p['planet_1']}-{p['planet_2']} ({p.get('quality','')}) — {p.get('life_area','')}")
        love = r.get("love_parans",[])
        if love: lines.append(f"Love paran: {love[0].get('latitude',0)} — {love[0].get('theme','')}")
        return "\n".join(lines)
    except Exception as e: return f"Error: {str(e)[:80]}"

def _build_sacred_sites(engine) -> str:
    try:
        r = engine.get_sacred_sites()
        lines = []
        for s in r.get("aligned_sites",[])[:6]:
            lines.append(f"  {s['name']:20s} [{s['alignment']}] — {s['theme'][:60]}")
            for reason in s.get("reasons",[])[:2]: lines.append(f"    {reason}")
        lords = r.get("spiritual_lords",{})
        lines.append(f"Dharma: {lords.get('9th_dharma','')} | Moksha: {lords.get('12th_moksha','')}")
        return "\n".join(lines)
    except Exception as e: return f"Error: {str(e)[:80]}"

def _build_eclipse_geo(engine) -> str:
    try:
        r = engine.get_eclipse_geography()
        lines = [f"Eclipses affecting you: {r.get('eclipses_affecting_you',0)}/{r.get('total_checked',0)}"]
        for e in r.get("eclipse_impacts",[])[:3]:
            lines.append(f"  {e['date']} {e['type']} in {e['sign']} — {e['impact_level']}")
            for h in e.get("acg_hits",[])[:2]: lines.append(f"    {h['planet']} {h['angle']}: {h['effect'][:60]}")
            if e.get("advice"): lines.append(f"    {e['advice'][:80]}")
        return "\n".join(lines)
    except Exception as e: return f"Error: {str(e)[:80]}"

def _build_migration(engine) -> str:
    try:
        r = engine.get_migration_roadmap()
        lines = []
        cur = r.get("current_phase",{})
        if cur:
            lines.append(f"NOW: {cur['lord']} dasha ({cur['start']} to {cur['end']}) — {cur['tendency']}")
            lines.append(f"  Best: {cur.get('best_city_type','')} | City: {cur.get('recommended_city','')}")
            ma = cur.get("move_advice",{})
            lines.append(f"  {'MOVE' if ma.get('should_move') else 'STAY'}: {ma.get('reason','')}")
        for p in r.get("phases",[]):
            if p["status"]=="future":
                lines.append(f"  {p['lord']:8s} {p['start'][:4]}-{p['end'][:4]} ({p['years']}y) {p.get('recommended_city','')}")
        return "\n".join(lines)
    except Exception as e: return f"Error: {str(e)[:80]}"

def _build_danger_zones(engine) -> str:
    try:
        r = engine.get_danger_zones()
        lines = []
        for d in r.get("danger_zones",[])[:6]:
            lines.append(f"  {d['city']:15s} [{d['severity']}] — {'; '.join(d['dangers'][:2])}")
        return "\n".join(lines)
    except Exception as e: return f"Error: {str(e)[:80]}"

def _build_relationship_geo(engine) -> str:
    try:
        r = engine.get_relationship_geography()
        lp = r.get("love_planets",{})
        lines = [f"7th lord: {lp.get('7th_lord','')} | Venus H{lp.get('venus_house','')} | DK: {lp.get('darakaraka','')}"]
        for c in r.get("love_cities",[])[:5]:
            lines.append(f"  {c['city']:15s} {c['love_score']:3d}/100 — {'; '.join(c.get('bonuses',[])[:2])}")
        return "\n".join(lines)
    except Exception as e: return f"Error: {str(e)[:80]}"

def _build_active_dir(engine) -> str:
    try:
        r = engine.get_active_direction()
        lines = [f"HOT NOW: {r.get('hot_direction','')}"]
        for a in r.get("activations",[])[:4]:
            lines.append(f"  {a['transit_planet']} activates {a['natal_planet']} ({a['direction']}, orb {a['orb']})")
        return "\n".join(lines)
    except Exception as e: return f"Error: {str(e)[:80]}"

SECTION_MAP["local_space"] = ("LOCAL SPACE LINES", _build_local_space)
SECTION_MAP["geodetic_zodiac"] = ("GEODETIC ZODIAC", _build_geodetic_zodiac)
SECTION_MAP["parans"] = ("PARAN LINES", _build_parans)
SECTION_MAP["sacred_sites"] = ("SACRED SITE ALIGNMENT", _build_sacred_sites)
SECTION_MAP["eclipse_geography"] = ("ECLIPSE GEOGRAPHY", _build_eclipse_geo)
SECTION_MAP["migration_roadmap"] = ("MIGRATION ROADMAP", _build_migration)
SECTION_MAP["danger_zones"] = ("DANGER ZONES", _build_danger_zones)
SECTION_MAP["relationship_geography"] = ("RELATIONSHIP GEOGRAPHY", _build_relationship_geo)
SECTION_MAP["active_direction"] = ("ACTIVE DIRECTION NOW", _build_active_dir)
SECTION_MAP["time_place_score"] = ("TIME-PLACE SCORE", _build_migration)


def _build_location_weather(engine) -> str:
    try:
        # Try to detect city/country from context — fallback to birth location country
        r = engine.get_location_weather(country_key='india')
        lines = [f"Country: {r.get('country','')} | ASC: {r.get('ascendant','')} | Mood: {r.get('mood','')}"]
        if r.get('current_dasha'): lines.append(f"National dasha: {r['current_dasha']}")
        for w in r.get('national_weather',[])[:4]:
            pi = w.get('personal_impact','')
            lines.append(f"  {w['planet']} in H{w['national_house']} ({w['national_domain']}) → your H{w['your_house']}")
            if pi: lines.append(f"    {pi[:80]}")
        return "\n".join(lines)
    except Exception as e: return f"Error: {str(e)[:80]}"

def _build_country_year(engine) -> str:
    try:
        from datetime import datetime
        r = engine.get_country_year('india', datetime.now().year)
        lines = [f"{r.get('country','')} {r.get('year','')}: {r.get('mood','')}"]
        for t in r.get('yearly_themes',[])[:4]: lines.append(f"  {t}")
        for w in r.get('national_weather',[])[:3]:
            lines.append(f"  {w['planet']} in {w['national_domain']} (H{w['national_house']})")
        return "\n".join(lines)
    except Exception as e: return f"Error: {str(e)[:80]}"

def _build_personal_mundane(engine) -> str:
    try:
        r = engine.get_personal_mundane('Mumbai')
        lines = [f"City: {r.get('city','')} | Country: {r.get('country','')}",
                 f"Relocation score: {r.get('relocation_score',0)} | National mood: {r.get('national_mood','')}",
                 f"Synthesis: {r.get('synthesis','')[:100]}"]
        for d in r.get('direct_impacts',[])[:3]:
            lines.append(f"  {d['national_effect']} → {d['meaning'][:60]}")
        return "\n".join(lines)
    except Exception as e: return f"Error: {str(e)[:80]}"

def _build_coordinate_mundane(engine) -> str:
    try:
        r = engine.analyze_coordinate_mundane(engine.latitude, engine.longitude)
        geo = r.get('geodetic',{})
        sky = r.get('current_sky',{})
        annual = r.get('annual_forecast',{})
        personal = r.get('personal_overlay',{})
        lines = [f"Location: {r.get('location','')} | Score: {r.get('combined_score',0)} | {r.get('rating','')}",
                 f"Geodetic ASC: {geo.get('geodetic_ascendant','')} | Favorability: {geo.get('favorability',0)}"]
        for tw in geo.get('transit_weather',[])[:3]:
            lines.append(f"  {tw['reading']}")
        lines.append(f"Sky now: {sky.get('current_ascendant','')} | Hora: {sky.get('hora_planet','')}")
        for ap in sky.get('angular_planets',[])[:2]:
            lines.append(f"  {ap['planet']} angular H{ap['house']} — {ap['nature']}")
        lines.append(f"Annual: {annual.get('year_outlook','')} ({annual.get('sankranti_ascendant','')} ASC)")
        for t in annual.get('year_themes',[])[:2]: lines.append(f"  {t}")
        lines.append(f"Personal: {personal.get('verdict','')} ({personal.get('resonance_score',0)}/100)")
        for imp in personal.get('impacts',[])[:2]:
            lines.append(f"  {imp['meaning'][:70]}")
        return "\n".join(lines)
    except Exception as e: return f"Error: {str(e)[:80]}"

def _build_globe_scan(engine) -> str:
    try:
        r = engine.scan_globe(10, 'overall')
        lines = [f"Globe scan: {r['total_points']} points at {r['resolution_deg']}° resolution",
                 f"Best point: {r['best_point']['lat']}°, {r['best_point']['lng']}° (score {r['best_point']['score']})",
                 f"Worst point: {r['worst_point']['lat']}°, {r['worst_point']['lng']}° (score {r['worst_point']['score']})",
                 f"Best longitude band: {r['best_longitude_band']}°"]
        return "\n".join(lines)
    except Exception as e: return f"Error: {str(e)[:80]}"

SECTION_MAP["location_weather"] = ("NATIONAL WEATHER", _build_location_weather)
SECTION_MAP["country_year"] = ("COUNTRY YEAR FORECAST", _build_country_year)
SECTION_MAP["personal_mundane"] = ("PERSONAL-MUNDANE OVERLAY", _build_personal_mundane)
SECTION_MAP["coordinate_mundane"] = ("COORDINATE ANALYSIS", _build_coordinate_mundane)
SECTION_MAP["globe_scan"] = ("GLOBAL SCAN", _build_globe_scan)
