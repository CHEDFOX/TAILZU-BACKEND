"""
BPHS SECTION BUILDERS
Each function takes a JyotishEngine and returns clean, readable text
for one data section. The LLM reads this like a chart sheet.
"""

from app.services.oracle.section_errors import note_section_failure, vet_section
from datetime import datetime

RASHI_LORDS = {
    "Aries": "Mars", "Taurus": "Venus", "Gemini": "Mercury", "Cancer": "Moon",
    "Leo": "Sun", "Virgo": "Mercury", "Libra": "Venus", "Scorpio": "Mars",
    "Sagittarius": "Jupiter", "Capricorn": "Saturn", "Aquarius": "Saturn", "Pisces": "Jupiter",
}

RASHI_LIST = ["Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo",
              "Libra", "Scorpio", "Sagittarius", "Capricorn", "Aquarius", "Pisces"]


def build_base_chart(engine) -> str:
    """Base chart — always included. Positions, houses, lordships, dignity."""
    planets = engine.planets
    asc = engine.ascendant
    asc_rashi = asc.get("rashi_name", "")
    asc_idx = RASHI_LIST.index(asc_rashi) if asc_rashi in RASHI_LIST else 0

    lines = [f"Ascendant: {asc_rashi} {round(asc.get('longitude', 0) % 30, 1)}° ({asc.get('nakshatra_name', '')})"]

    for name in ["Sun", "Moon", "Mars", "Mercury", "Jupiter", "Venus", "Saturn", "Rahu", "Ketu"]:
        d = planets.get(name, {})
        rashi = d.get("rashi_name", "")
        retro = " R" if d.get("retrograde") else ""

        # Lordship
        lord_of = []
        for i in range(12):
            r = RASHI_LIST[(asc_idx + i) % 12]
            if RASHI_LORDS.get(r) == name:
                lord_of.append(str(i + 1))

        lord_str = f"  L{','.join(lord_of)}" if lord_of else ""
        lines.append(f"{name:8s} {rashi:12s} H{str(d.get('house', '?')):<3s} {d.get('nakshatra_name', ''):16s} {round(d.get('longitude', 0) % 30, 1):>5.1f}°{retro}{lord_str}")

    return "\n".join(lines)


def build_dashas_full(engine) -> str:
    """Full dasha timeline with dates."""
    lines = []
    try:
        dasha = engine.get_vimshottari_dasha()
        lines.append(f"Current: {dasha.get('dasha_string', '')}")

        periods = engine.get_vimshottari_periods()
        if periods:
            now = datetime.now()
            for p in periods:
                lord = p.get("lord", p.get("planet", ""))
                start = str(p.get("start", p.get("start_date", "")))[:10]
                end = str(p.get("end", p.get("end_date", "")))[:10]
                marker = " ◀ CURRENT" if start <= now.strftime("%Y-%m-%d") <= end else ""
                lines.append(f"  {lord:8s} {start} to {end}{marker}")
    except Exception as e:
        lines.append(f"Dasha calculation error: {str(e)[:80]}")
    return "\n".join(lines)


_TRANSIT_ORDER = ('Saturn', 'Jupiter', 'Rahu', 'Ketu', 'Mars', 'Sun', 'Venus', 'Mercury', 'Moon')


def build_transits(engine) -> str:
    """Current transits (gochara) read against this chart.

    This read `transit_effects` and `sade_sati.phase`, neither of which the engine
    returns, so the whole section came out as one line — "Overall: Mixed Period" —
    and a reader in Ashtama Shani (Saturn eighth from the Moon) was told nothing
    about Saturn at all. It now renders what get_current_transits() computes: each
    planet's sign and house from Moon and lagna with its effect and any vedha,
    Sade Sati or the Saturn dhaiya, Jupiter's year, and the double transit."""
    t = engine.get_current_transits() or {}
    ta = t.get("transit_analysis") or {}
    tr = ta.get("transits") or {}
    lines = []
    overall = t.get("overall_period") or ta.get("overall")
    if overall:
        lines.append(f"Overall: {overall} — {ta.get('favorable_count', 0)} favourable, "
                     f"{ta.get('challenging_count', 0)} challenging")
    for name in _TRANSIT_ORDER:
        d = tr.get(name)
        if not isinstance(d, dict) or not d.get("transit_rashi_name"):
            continue
        row = (f"  {name} in {d['transit_rashi_name']}: H{d.get('house_from_moon', '?')} from Moon, "
               f"H{d.get('house_from_lagna', '?')} from lagna")
        if d.get("natal_conjunctions"):
            row += f", over natal {', '.join(d['natal_conjunctions'])}"
        effect = d.get("effect") or ""
        if d.get("has_vedha") and d.get("vedha_by"):
            effect += (f" by {d['vedha_by']}" if "vedha" in effect.lower()
                       else f" (obstructed by {d['vedha_by']})")
        lines.append(row + (f" — {effect}" if effect else ""))
    ss = t.get("sade_sati") or {}
    if ss.get("is_sade_sati"):
        lines.append(f"  SADE SATI ACTIVE: {ss.get('sade_sati_phase', '')} phase, intensity "
                     f"{ss.get('intensity', '')}. {ss.get('recommendation', '')}".rstrip())
    elif ss.get("is_dhaiya"):
        kind = ss.get("dhaiya_type", "")
        rec = str(ss.get("recommendation", ""))
        if kind and rec.startswith(kind):
            rec = rec[len(kind):].lstrip(" -—:")
        lines.append(f"  SATURN DHAIYA: {kind}. {rec}".rstrip(" ."))
    jt = t.get("jupiter_transit") or {}
    if jt.get("jupiter_transit_rashi"):
        lines.append(f"  Jupiter's year: in {jt['jupiter_transit_rashi']}, H{jt.get('house_from_moon', '?')} "
                     f"from Moon, {'favourable' if jt.get('is_favorable') else 'unfavourable'} — "
                     f"{jt.get('effect', '')}")
    dt = t.get("double_transit") or {}
    active = [k.split("_", 2)[-1] for k, v in dt.items() if v]
    if active:
        lines.append(f"  Double transit (Jupiter and Saturn together) active on: {', '.join(active)}")
    return "\n".join(lines)


def build_yogas(engine, gender: str = "") -> str:
    """All yogas found in the chart. Where a yoga has a man's form and a woman's
    (Mahabhagya), only the reader's own is given when their gender is known."""
    lines = []
    g = (gender or "").lower()
    other = "(Female)" if g == "male" else "(Male)" if g == "female" else None
    try:
        yogas = engine.get_yogas()
        highlights = yogas.get("highlights", [])
        for y in highlights:
            if isinstance(y, dict):
                name = y.get("name", "")
                if other and name.endswith(other):
                    continue
                desc = y.get("description", y.get("effect", ""))[:100]
                lines.append(f"  {name}: {desc}")
        total = yogas.get("summary", {}).get("total_yogas", 0)
        lines.append(f"Total: {total} yogas")
    except Exception:
        pass
    return "\n".join(lines)


def build_navamsa(engine) -> str:
    """D9 Navamsa chart — marriage and spouse indicators."""
    lines = []
    try:
        nav = engine.get_navamsa_analysis()
        spouse = nav.get("spouse_description", nav.get("partner_nature", ""))
        if spouse:
            lines.append(f"Spouse nature: {spouse}")
        venus_nav = nav.get("venus_navamsa", {})
        if isinstance(venus_nav, dict):
            lines.append(f"Venus in D9: {venus_nav.get('sign', '')} — {venus_nav.get('interpretation', '')[:80]}")
        seventh = nav.get("seventh_lord_navamsa", nav.get("d9_7th_lord", {}))
        if isinstance(seventh, dict) and seventh:
            lines.append(f"7th lord in D9: {seventh.get('sign', '')} — {seventh.get('interpretation', '')[:80]}")
    except Exception:
        pass
    return "\n".join(lines)


def build_dasamsa(engine) -> str:
    """The D10, for work and standing. This read recommended_field and a tenth_lord
    dict the engine does not return, so it printed "10th lord:  in  H"."""
    d10 = engine.get_career_analysis() or {}
    lines = []
    if d10.get("dasamsa_ascendant"):
        lines.append(f"D10 ascendant: {d10['dasamsa_ascendant']}")
    th = d10.get("tenth_house") or {}
    if th.get("lord"):
        occ = ", ".join(th.get("occupants") or []) or "none"
        lines.append(f"D10 10th lord {th['lord']} in D10 H{th.get('lord_house', '?')}; occupants: {occ}; "
                     f"strength {th.get('strength', '?')}")
    if d10.get("career_type"):
        lines.append(f"Career field: {d10['career_type']}")
    if d10.get("secondary_careers"):
        lines.append(f"Also: {'; '.join(map(str, d10['secondary_careers']))}")
    bits = [f"{k.replace('_', ' ')} {d10[k]}" for k in ("career_strength", "rise_potential") if d10.get(k)]
    if bits:
        lines.append(", ".join(bits))
    return "\n".join(lines)


def build_house_detail(engine, house_num: int) -> str:
    """Deep analysis of a specific house."""
    lines = []
    try:
        planets = engine.planets
        asc_rashi = engine.ascendant_rashi

        # Find house sign, lord, occupants
        house_rashi_idx = (asc_rashi + house_num - 1) % 12
        house_sign = RASHI_LIST[house_rashi_idx]
        house_lord = RASHI_LORDS.get(house_sign, "")
        lord_data = planets.get(house_lord, {})

        lines.append(f"Sign: {house_sign} | Lord: {house_lord} in {lord_data.get('rashi_name', '')} H{lord_data.get('house', '?')}")

        occupants = [n for n, d in planets.items() if d.get('house') == house_num]
        if occupants:
            lines.append(f"Occupants: {', '.join(occupants)}")
        else:
            lines.append("Occupants: None (untenanted)")

        # Aspects on this house
        aspects = engine.get_planetary_aspects()
        if isinstance(aspects, dict):
            house_aspects = []
            for planet, asp_data in aspects.items():
                if isinstance(asp_data, dict):
                    aspected_houses = asp_data.get("aspected_houses", [])
                    if house_num in aspected_houses:
                        house_aspects.append(planet)
            if house_aspects:
                lines.append(f"Aspected by: {', '.join(house_aspects)}")
    except Exception:
        pass
    return "\n".join(lines)


def build_jaimini(engine) -> str:
    """The chara kārakas, soul to spouse. This looked up lower-case keys
    ('atmakaraka'); the engine returns 'Atmakaraka'…, so the section was always empty."""
    karakas = engine.get_jaimini_karakas() or {}
    asc = engine.ascendant_rashi
    lines = []
    for key in ("Atmakaraka", "Amatyakaraka", "Bhratrikaraka", "Matrikaraka", "Pitrikaraka",
                "Putrakaraka", "Gnatikaraka", "Darakaraka"):
        k = karakas.get(key) or {}
        if not isinstance(k, dict) or not k.get("planet"):
            continue
        r = k.get("rashi")
        house = f" H{((r - asc) % 12) + 1}" if isinstance(r, int) else ""
        line = f"{key} ({k.get('short', '')}): {k['planet']} in {k.get('rashi_name', '?')}{house}"
        if k.get("degree") is not None:
            line += f" at {k['degree']}°"
        if k.get("meaning"):
            line += f" — {k['meaning']}"
        lines.append(line)
    return "\n".join(lines)


def build_afflictions(engine) -> str:
    """Combustion, gandanta, sade sati."""
    lines = []
    try:
        comb = engine.get_combustion()
        if comb.get("combust_planets"):
            for cp in comb["combust_planets"]:
                lines.append(f"COMBUST: {cp['planet']} — {cp['severity']} ({cp['distance_from_sun']}° from Sun)")

        gand = engine.get_gandanta()
        if gand.get("gandanta_planets"):
            for gp in gand["gandanta_planets"]:
                lines.append(f"GANDANTA: {gp['planet']} — {gp['severity']} in {gp['gandanta_zone']}")

        sade = engine.check_sade_sati()
        if sade.get("is_sade_sati"):
            lines.append(f"SADE SATI: Active — {sade.get('phase', '')}")
        else:
            lines.append("Sade Sati: Not active")
    except Exception:
        pass
    return "\n".join(lines) if lines else "No major afflictions"


def build_medical(engine) -> str:
    """Medical astrology — health vulnerabilities."""
    lines = []
    try:
        med = engine.get_medical_report()
        vulns = med.get("vulnerabilities", med.get("health_areas", []))
        if isinstance(vulns, list):
            for v in vulns[:5]:
                if isinstance(v, dict):
                    lines.append(f"  {v.get('area', '')}: {v.get('description', v.get('indication', ''))[:80]}")
        longevity = med.get("longevity", "")
        if longevity:
            lines.append(f"Longevity: {longevity}")
    except Exception:
        pass
    return "\n".join(lines)


def build_remedies(engine) -> str:
    """Remedies for the planets that need them. This read `gemstones` and `mantras`;
    the engine returns weak_planets, gemstone_recommendations, mantra_recommendations
    and ritual_recommendations, so a remedy question had no remedies in its data."""
    rem = engine.get_remedies() or {}
    lines = []
    weak = [w for w in rem.get("weak_planets") or [] if isinstance(w, dict) and w.get("planet")]
    if weak:
        lines.append("Planets needing support: " + "; ".join(
            f"{w['planet']} ({', '.join(w.get('reasons') or []) or 'weak'})" for w in weak[:4]))
    for g in (rem.get("gemstone_recommendations") or [])[:2]:
        if isinstance(g, dict) and g.get("gemstone"):
            lines.append(f"Gemstone: {g['gemstone']} for {g.get('planet', '?')} — {g.get('reason', '')}")
    mr = rem.get("mantra_recommendations") or {}
    for m in (mr.get("primary_mantras") or [])[:2]:
        if isinstance(m, dict) and m.get("beej_mantra"):
            extra = ", ".join(x for x in (f"{m['japa_count']} japa" if m.get("japa_count") else "",
                                          str(m.get("best_time") or "")) if x)
            lines.append(f"Mantra for {m.get('for', '')}: {m['beej_mantra']}" + (f" ({extra})" if extra else ""))
    nm = mr.get("nakshatra_mantra") or {}
    if isinstance(nm, dict) and nm.get("mantra"):
        lines.append(f"Birth-star mantra ({nm.get('nakshatra', '')}, deity {nm.get('deity', '')}): {nm['mantra']}")
    for r in ((rem.get("ritual_recommendations") or {}).get("rituals") or [])[:2]:
        if not isinstance(r, dict):
            continue
        bits = [f"donate {r['donation']} on {r.get('donation_day', '')}".strip() if r.get("donation") else "",
                str(r.get("fasting") or ""), str(r.get("color_therapy") or "")]
        bits = [b for b in bits if b]
        if bits:
            lines.append(f"Ritual for {r.get('for', '')}: " + "; ".join(bits))
    return "\n".join(lines)


def build_classical_rules(engine, topic: str = None) -> str:
    """BPHS classical rules for a life event."""
    lines = []
    try:
        if topic:
            result = engine.get_classical_analysis(topic)
        else:
            result = engine.get_classical_analysis()

        if isinstance(result, dict) and 'events' not in result:
            summary = result.get("summary", "")
            supports = result.get("supports", [])
            opposes = result.get("opposes", [])
            if summary:
                lines.append(summary)
            for s in supports[:3]:
                text = s.get("text", str(s)) if isinstance(s, dict) else str(s)
                lines.append(f"  ✓ {text[:100]}")
            for o in opposes[:2]:
                text = o.get("text", str(o)) if isinstance(o, dict) else str(o)
                lines.append(f"  ✗ {text[:100]}")
    except Exception:
        pass
    return "\n".join(lines)


def build_personality(engine) -> str:
    """Moon, ascendant and birth-star nature, and how the running daśā colours them.

    This read moon_personality and ascendant_personality, which the engine does not
    return, so the section reached the model as two empty labels. It is the section
    the keyword fallback sends for any question it cannot place, so the most common
    fallback briefing carried no personality at all."""
    p = engine.get_personality() or {}
    lines = []
    for key, label in (("moon_sign", "Moon (emotional nature)"),
                       ("ascendant", "Ascendant (how the world meets them)")):
        d = p.get(key) or {}
        if not isinstance(d, dict) or not d.get("sign"):
            continue
        line = f"{label}: {d['sign']}"
        kind = f"{d.get('element', '')} {d.get('quality', '')}".strip()
        if kind:
            line += f" ({kind})"
        for k, name in (("traits", "traits"), ("strengths", "gifts"), ("weaknesses", "shadow"),
                        ("love_style", "in love"), ("career", "drawn to")):
            if d.get(k):
                line += f"; {name}: {d[k]}"
        lines.append(line)
    n = p.get("nakshatra") or {}
    if isinstance(n, dict) and n.get("nakshatra"):
        extra = ", ".join(f"{k} {n[k]}" for k in ("ruler", "deity", "gana", "symbol") if n.get(k))
        lines.append(f"Birth star: {n['nakshatra']}" + (f" ({extra})" if extra else ""))
    dp = p.get("dasha_personality") or {}
    if isinstance(dp, dict) and dp.get("combined"):
        lines.append(f"This chapter ({dp.get('current_dasha', '')}): {dp['combined']}")
    return "\n".join(lines)


def build_nadi(engine) -> str:
    """Bhrigu Nandi Nadi. This read `predictions`; the engine returns key_predictions
    per life area and conjunction readings, so the section was always empty."""
    nadi = engine.get_nadi_reading() or {}
    lines = []
    for area, items in (nadi.get("key_predictions") or {}).items():
        if isinstance(items, list) and items:
            lines.append(f"  {area}: {str(items[0])[:220]}")
    for c in (nadi.get("conjunction_readings") or [])[:3]:
        if isinstance(c, dict) and c.get("nadi_reading"):
            lines.append(f"  {' + '.join(c.get('planets') or [])} together in H{c.get('house', '?')}: "
                         f"{str(c['nadi_reading'])[:220]}")
    return "\n".join(lines)


def build_annual(engine, year: int = None) -> str:
    """Varshaphal annual prediction."""
    lines = []
    try:
        y = year or datetime.now().year
        vp = engine.get_varshaphal(y)
        overall = vp.get("overall", {})
        if isinstance(overall, dict):
            lines.append(f"Year {y}: {overall.get('rating', '')} ({overall.get('score', '')}/100)")
            lines.append(f"Summary: {overall.get('summary', '')[:120]}")
        yl = vp.get("year_lord", {})
        if isinstance(yl, dict):
            lines.append(f"Year lord: {yl.get('planet', '')} ({yl.get('strength', '')})")
    except Exception:
        pass
    return "\n".join(lines)


def build_prashna(engine) -> str:
    """Prashna for this moment."""
    lines = []
    try:
        pr = engine.cast_prashna_refined()
        refined = pr.get("refined_verdict", {})
        if isinstance(refined, dict):
            verdict = refined.get("verdict", "")
            conf = refined.get("confidence_pct", "")
            timing = refined.get("timing", "")
            lines.append(f"Verdict: {verdict} ({conf}% confidence)")
            if timing:
                lines.append(f"Timing: {timing}")
            reasons = refined.get("reasoning", [])
            for r in reasons[:3]:
                lines.append(f"  {r}")
    except Exception:
        pass
    return "\n".join(lines)


# ═══════════════════════════════════════════════════════════════
# SECTION DISPATCHER
# ═══════════════════════════════════════════════════════════════

SECTION_MAP = {
    'dashas_full': ('DASHA TIMELINE', build_dashas_full),
    'transits': ('CURRENT TRANSITS', build_transits),
    'yogas': ('YOGAS', lambda e, gender='': build_yogas(e, gender)),
    'navamsa': ('NAVAMSA (D9)', build_navamsa),
    'dasamsa': ('DASAMSA (D10)', build_dasamsa),
    'jaimini': ('JAIMINI', build_jaimini),
    'afflictions': ('AFFLICTIONS', build_afflictions),
    'medical': ('MEDICAL', build_medical),
    'remedies': ('REMEDIES', build_remedies),
    'classical_rules': ('CLASSICAL RULES', build_classical_rules),
    'personality': ('PERSONALITY', build_personality),
    'nadi': ('NADI READING', build_nadi),
    'annual': ('ANNUAL FORECAST', build_annual),
    'prashna': ('PRASHNA', build_prashna),
    'ashtakavarga': ('ASHTAKAVARGA', lambda e: _build_ashtakavarga(e)),
    'shadbala': ('SHADBALA (PLANET STRENGTH)', lambda e: _build_shadbala(e)),
    'divisional_charts': ('DIVISIONAL CHARTS', lambda e: _build_divisional(e)),
    'bhava_chalit': ('BHAVA CHALIT', lambda e: _build_bhava_chalit(e)),
    'alt_dashas': ('ALTERNATIVE DASHAS', lambda e: _build_alt_dashas(e)),
    'transit_deep': ('TRANSIT DEEP ANALYSIS', lambda e: _build_transit_deep(e)),
    'career_aptitude': ('CAREER APTITUDE', lambda e: _build_career_aptitude(e)),
    'numerology': ('NUMEROLOGY', lambda e: _build_numerology(e)),
    'vastu': ('VASTU', lambda e: _build_vastu(e)),
    'chakra': ('CHAKRA ANALYSIS', lambda e: _build_chakra(e)),
    'muhurta': ('MUHURTA (AUSPICIOUS TIMING)', lambda e: _build_muhurta(e)),
    'planetary_returns': ('PLANETARY RETURNS', lambda e: _build_planetary_returns(e)),
    'weekly_forecast': ('WEEKLY FORECAST', lambda e: _build_weekly(e)),
    'daily_snapshot': ('DAILY SNAPSHOT', lambda e: _build_daily_snapshot(e)),
    'past_events': ('PAST EVENT ANALYSIS', lambda e: _build_past_events(e)),
    'life_timeline': ('LIFE TIMELINE', lambda e: _build_life_timeline(e)),
    'relocation': ('RELOCATION ANALYSIS', lambda e: _build_relocation(e)),
    'baby_names': ('BABY NAMES', lambda e: _build_baby_names(e)),
    'sudarshana': ('SUDARSHANA CHAKRA', lambda e: _build_sudarshana(e)),
    'nakshatra_profile': ('NAKSHATRA PROFILE', lambda e: _build_nakshatra(e)),
    'yoga_timing': ('YOGA ACTIVATION TIMING', lambda e: _build_yoga_timing(e)),
    'lucky': ('LUCKY NUMBERS / COLORS / MANTRAS', lambda e: _build_lucky(e)),
    'bphs_advanced': ('BPHS ADVANCED', lambda e: _build_bphs_advanced(e)),
    'spiritual': ('SPIRITUAL ANALYSIS', lambda e: _build_spiritual(e)),
    'maraka': ('MARAKA (LONGEVITY)', lambda e: _build_maraka(e)),
    'argala': ('ARGALA & SARVATOBHADRA', lambda e: _build_argala(e)),
    'tithi_pravesh': ('TITHI PRAVESH', lambda e: _build_tithi_pravesh(e)),
    'chart_promise': ('CHART PROMISE', lambda e, t=None: _build_chart_promise(e, t)),
    'period_query': ('PERIOD ANALYSIS', lambda e: _build_period_query(e)),
    'manglik': ('MANGLIK ANALYSIS', lambda e: _build_manglik(e)),
    'pratyantar': ('PRATYANTAR DASHA', lambda e: _build_pratyantar(e)),
    'timing_windows': ('EVENT TIMING', lambda e, t=None: _build_timing_windows(e, t)),
    'arudha_padas': ('ARUDHA PADAS', lambda e: _build_arudha_padas(e)),
    'av_transits': ('ASHTAKAVARGA TRANSITS', lambda e: _build_av_transits(e)),
    'future_transits': ('FUTURE TRANSITS', lambda e: _build_future_transits(e)),
    'transit_aspects': ('TRANSIT ASPECTS', lambda e: _build_transit_aspects(e)),
    'name_numerology': ('NAME NUMEROLOGY', lambda e, name='': _build_name_numerology(e, name)),
    'compatibility': ('COMPATIBILITY — THEIR SIDE', lambda e: _build_compatibility_self(e)),
    'hora': ('HORA (PLANETARY HOURS)', lambda e: _build_hora(e)),
    'panchanga': ('PANCHANGA', lambda e: _build_panchanga(e)),
    'dasha_sandhi': ('DASHA SANDHI', lambda e: _build_dasha_sandhi(e)),
    'rashi_drishti': ('RASHI DRISHTI', lambda e: _build_rashi_drishti(e)),
    'av_sodhana': ('AV SODHANA', lambda e: _build_av_sodhana(e)),
    'prastara_av': ('PRASTARA ASHTAKAVARGA', lambda e: _build_prastara(e)),
    'shodhya_pinda': ('SHODHYA PINDA', lambda e: _build_shodhya_pinda(e)),
    'bhava_strengths': ('BHAVA STRENGTHS', lambda e: _build_bhava_strengths(e)),
    'ishta_kashta': ('ISHTA KASHTA PHALA', lambda e: _build_ishta_kashta(e)),
    'gemstones': ('GEMSTONE RECOMMENDATIONS', lambda e: _build_gemstones(e)),
    'synastry': ('SYNASTRY', lambda e: _build_synastry(e)),
    'composite': ('COMPOSITE CHART', lambda e: _build_composite(e)),
    'location': ('LOCATION ANALYSIS', lambda e: _build_location(e)),
    'raja_yogas': ('RAJA YOGAS', lambda e: _build_raja_yogas(e)),
    'dhana_yogas': ('DHANA YOGAS', lambda e: _build_dhana_yogas(e)),
    'daridra_yogas': ('DARIDRA YOGAS', lambda e: _build_daridra_yogas(e)),
    'female_horoscopy': ('FEMALE HOROSCOPY', lambda e, gender='': _build_female(e, gender)),
    'longevity': ('LONGEVITY', lambda e: _build_longevity(e)),
    'dasha_psychology': ('DASHA PSYCHOLOGY', lambda e: _build_dasha_psych(e)),
    'dasha_interpretation': ('DASHA INTERPRETATION', lambda e: _build_dasha_interp(e)),
    'special_lagnas': ('SPECIAL LAGNAS', lambda e: _build_special_lagnas(e)),
    'jaimini_complete': ('JAIMINI COMPLETE', lambda e: _build_jaimini_complete(e)),
    'upapada': ('UPAPADA LAGNA', lambda e: _build_upapada(e)),
    'muhurta_rules': ('MUHURTA RULES', lambda e: _build_muhurta_rules(e)),
}


# Sections that read something about the PERSON that the chart engine cannot hold:
# the engine is cached per birth chart and shared by everyone born at that moment,
# so per-request facts (the name) travel in `extras`, never on the engine.
_NEEDS_NAME = {'name_numerology'}
_NEEDS_GENDER = {'female_horoscopy', 'yogas'}


def build_sections(engine, section_names: list, topic: str = None, extras: dict = None) -> str:
    """Build all requested sections and return combined text."""
    extras = extras or {}
    parts = []

    for section_name in section_names:
        if section_name.startswith("house_detail:"):
            try:
                house_num = int(section_name.split(":")[1])
                text = build_house_detail(engine, house_num)
                if text:
                    parts.append(f"HOUSE {house_num} DETAIL:\n{text}")
            except (ValueError, IndexError):
                pass
            continue

        entry = SECTION_MAP.get(section_name)
        if not entry:
            continue

        label, builder = entry
        try:
            if section_name == 'classical_rules' and topic:
                text = builder(engine, topic)
            elif section_name in ('chart_promise', 'timing_windows') and topic:
                text = builder(engine, topic)
            elif section_name in _NEEDS_NAME:
                text = builder(engine, extras.get('name', ''))
            elif section_name in _NEEDS_GENDER:
                text = builder(engine, extras.get('gender', ''))
            else:
                text = builder(engine)
            text = vet_section('bphs', section_name, text)
            if text and text.strip():
                parts.append(f"{label}:\n{text}")
        except Exception as _e:
            # Do not swallow this. A dropped section leaves the responder
            # believing it has data it was never given, and it writes anyway.
            #
            # `name` was undefined here — the loop variable is section_name — so
            # the handler raised NameError from inside the except block and took
            # the WHOLE bphs build down with it. One failing section stopped
            # every other section in the tradition from reaching the briefing,
            # and the log line said only "name 'name' is not defined", which
            # names neither the section that failed nor the one real cause.
            # An error path that cannot run is worse than no error path.
            note_section_failure('bphs', section_name, _e)
            continue

    return "\n\n".join(parts)


# ═══════════════════════════════════════════════════════════════
# NEW SECTION BUILDERS (covering all remaining engine methods)
# ═══════════════════════════════════════════════════════════════

def _safe(fn, fallback=""):
    try:
        return fn()
    except Exception:
        return fallback

def _fmt_dict_list(items, key="", max_items=8):
    lines = []
    for item in (items or [])[:max_items]:
        if isinstance(item, dict):
            text = item.get(key, item.get("text", item.get("description", item.get("name", str(item)[:100]))))
            lines.append(f"  {str(text)[:120]}")
        else:
            lines.append(f"  {str(item)[:120]}")
    return "\n".join(lines)

def _build_ashtakavarga(engine) -> str:
    av = engine.get_ashtakavarga()
    lines = []
    sav = av.get("sarvashtakavarga", av.get("sav", {}))
    if isinstance(sav, dict):
        for sign, score in list(sav.items())[:12]:
            lines.append(f"  {sign}: {score} bindus")
    total = av.get("total_bindus", sum(sav.values()) if isinstance(sav, dict) else 0)
    lines.append(f"Total: {total}")
    return "\n".join(lines)

def _build_shadbala(engine) -> str:
    sb = engine.get_shadbala_complete()
    lines = []
    for planet, data in (sb if isinstance(sb, dict) else {}).items():
        if isinstance(data, dict) and 'total' in data:
            lines.append(f"  {planet}: {data['total']:.1f} rupas")
    cs = engine.get_chart_strength()
    if isinstance(cs, dict):
        lines.append(f"Chart Strength: {cs.get('score', '')}/100")
    return "\n".join(lines)

def _build_divisional(engine) -> str:
    """Each varga's own verdict. This read `summary`/`interpretation`, which no varga
    returns, so every chart printed as an empty label."""
    va = engine.get_varga_analysis() or {}
    lines = []
    for key, data in va.items():
        if not isinstance(data, dict):
            continue
        head = f"{data.get('chart', key)} ({data.get('purpose', '')})".replace(" ()", "")
        facts = []
        for k, v in data.items():
            if k in ("chart", "purpose") or v in (None, "", [], {}):
                continue
            if isinstance(v, (str, int, float, bool)):
                facts.append(f"{k.replace('_', ' ')}: {v}")
            elif isinstance(v, list) and all(isinstance(x, (str, int, float)) for x in v):
                facts.append(f"{k.replace('_', ' ')}: {', '.join(map(str, v))}")
            elif isinstance(v, dict):
                inner = ", ".join(f"{a.replace('_', ' ')} {b}" for a, b in v.items()
                                  if isinstance(b, (str, int, float, bool)) and str(b).strip())
                if inner:
                    facts.append(f"{k.replace('_', ' ')}: {inner}")
        if facts:
            lines.append(f"{head}: " + "; ".join(facts))
    return "\n".join(lines)

def _build_bhava_chalit(engine) -> str:
    bc = engine.get_bhava_chalit()
    lines = []
    shifts = bc.get("shifts", bc.get("shifted_planets", []))
    if isinstance(shifts, list):
        for s in shifts:
            if isinstance(s, dict):
                lines.append(f"  {s.get('planet', '')}: rashi H{s.get('rashi_house', '')} → bhava H{s.get('bhava_house', '')}")
    if not lines:
        lines.append("No planets shift between rashi and bhava charts")
    return "\n".join(lines)

def _build_alt_dashas(engine) -> str:
    """The running period in four other daśā systems, beside Vimshottari. This read a
    top-level `lord` none of them returns, so all four printed as empty labels."""
    lines = []
    for name, method in (("Yogini", "get_yogini_dasha"), ("Chara", "get_chara_dasha"),
                         ("Kalachakra", "get_kalachakra_dasha"), ("Narayana", "get_narayana_dasha")):
        try:
            d = getattr(engine, method)() or {}
        except Exception:
            continue
        cur = d.get("mahadasha") or d.get("current") or {}
        what = d.get("dasha_string", "")
        if isinstance(cur, dict):
            if cur.get("yogini"):
                what = f"{cur['yogini']} ({cur.get('planet', '')}, {cur.get('nature', '')})"
            elif cur.get("rashi_name") or isinstance(cur.get("rashi"), str):
                what = f"{cur.get('rashi_name') or cur['rashi']}" + (f" (lord {cur['lord']})" if cur.get("lord") else "")
            span = "–".join(str(cur.get(k, ""))[:10] for k in ("start", "end") if cur.get(k))
            if span:
                what += f", {span}"
        sub = d.get("antardasha") or {}
        if isinstance(sub, dict) and (sub.get("yogini") or sub.get("rashi_name")):
            what += f"; sub-period {sub.get('yogini') or sub.get('rashi_name')}"
        if what:
            lines.append(f"  {name}: {what}")
    cv = _safe(lambda: engine.cross_validate_dashas())
    if isinstance(cv, dict) and cv.get("agreement"):
        lines.append(f"Agreement with Vimshottari ({cv.get('vimshottari', '')}): {cv['agreement']} — "
                     f"{cv.get('description', '')}")
    return "\n".join(lines)

def _build_transit_deep(engine) -> str:
    lines = []
    td = _safe(lambda: engine.get_transit_deep())
    if isinstance(td, dict):
        for key in ['summary', 'sade_sati', 'retrogrades']:
            val = td.get(key, "")
            if val:
                lines.append(f"  {key}: {str(val)[:100]}")
    tc = _safe(lambda: engine.get_transit_calendar(3))
    if isinstance(tc, dict):
        for m in tc.get("months", [])[:3]:
            if isinstance(m, dict):
                lines.append(f"  {m.get('short', '')}: {m.get('score', '')}/100 — {m.get('theme', '')[:60]}")
    vedha = _safe(lambda: engine.get_vedha())
    if isinstance(vedha, dict) and vedha.get("obstructed_count"):
        lines.append(f"  Vedha: {vedha['obstructed_count']} transits obstructed")
    ecl = _safe(lambda: engine.get_eclipse_calendar())
    if isinstance(ecl, dict):
        upcoming = ecl.get("eclipses", ecl.get("upcoming", []))
        if isinstance(upcoming, list) and upcoming:
            e = upcoming[0]
            if isinstance(e, dict):
                lines.append(f"  Next eclipse: {e.get('date', '')} {e.get('type', '')} — {str(e.get('personal_impact', ''))[:60]}")
    return "\n".join(lines)

def _build_career_aptitude(engine) -> str:
    """The chart's vocational signals. This read `top_fields`, which the engine does
    not return, so the section was always empty."""
    ca = engine.get_career_aptitude() or {}
    lines = []
    if ca.get("tenth_lord"):
        occ = ", ".join(ca.get("tenth_occupants") or []) or "none"
        lines.append(f"10th lord: {ca['tenth_lord']}; planets in the 10th: {occ}")
    ranked = [r for r in (ca.get("rankings") or []) if isinstance(r, dict) and r.get("reasons")]
    if ranked:
        lines.append("Fields ranked by the share of their own chart checks that hold (counted, not a percentage):")
        for r in ranked[:5]:
            n = r.get("evidence", len(r["reasons"]))
            of = f" of {r['checks']}" if r.get("checks") else ""
            lines.append(f"  {str(r['field']).replace('_', ' ')} — {n}{of}: {'; '.join(r['reasons'])}")
    return "\n".join(lines)

def _build_numerology(engine) -> str:
    n = engine.get_numerology()
    lines = []
    if isinstance(n, dict):
        lines.append(f"Mulank: {n.get('mulank', n.get('life_path', ''))}")
        lines.append(f"Bhagyank: {n.get('bhagyank', n.get('destiny', ''))}")
    pd = engine.get_personal_day()
    if isinstance(pd, dict):
        lines.append(f"Personal day: {pd.get('day', '')} | month: {pd.get('month', '')} | year: {pd.get('year', '')}")
    return "\n".join(lines)

def _build_vastu(engine) -> str:
    """Directions for this chart: lucky, career, wealth, sleep and rooms. This read a
    single best_direction the engine does not return, so it printed a blank label."""
    v = engine.get_vastu() or {}
    lines = []
    ld = v.get("lucky_directions") or {}
    names = [(k, k.replace("_direction", "").replace("primary_lucky", "most fortunate").replace("_", " "))
             for k in ("primary_lucky", "career_direction", "wealth_direction", "relationship_direction",
                       "home_direction", "fortune_direction")]
    dirs = [f"{label} {ld[k]}" for k, label in names if ld.get(k)]
    if dirs:
        lines.append("Directions: " + "; ".join(dirs))
    for k, txt in ((ld.get("explanation") or {}).items()):
        if txt:
            lines.append(f"  why {k}: {txt}")
    sl = v.get("sleeping") or {}
    if sl.get("head_direction"):
        lines.append(f"Sleep with the head to the {sl['head_direction']}" + (f"; avoid {sl['avoid']}" if sl.get("avoid") else ""))
    for room, d in (v.get("room_placement") or {}).items():
        if isinstance(d, dict) and d.get("ideal"):
            lines.append(f"  {room.replace('_', ' ')}: {d['ideal']} (avoid {d.get('avoid', '?')}) — {d.get('reason', '')}")
    for r in (v.get("direction_remedies") or [])[:3] if isinstance(v.get("direction_remedies"), list) else []:
        if r:
            lines.append(f"  remedy: {r if isinstance(r, str) else '; '.join(f'{a}: {b}' for a, b in r.items())}")
    return "\n".join(lines)

def _build_chakra(engine) -> str:
    """The seven chakras by their ruling planets. The engine returns them as a dict
    keyed by chakra name; this iterated it as a list of dicts and found nothing."""
    c = engine.get_chakra_analysis() or {}
    ch = c.get("chakras") or {}
    items = (ch.items() if isinstance(ch, dict)
             else [(x.get("name", ""), x) for x in ch if isinstance(x, dict)])
    lines = []
    for name, d in items:
        if not isinstance(d, dict):
            continue
        line = f"  {name}: {d.get('status', '?')}" + (" (afflicted)" if d.get("afflicted") else "")
        if d.get("ruling_planet"):
            line += f" — ruled by {d['ruling_planet']}" + (f", {d['planet_strength']}" if d.get("planet_strength") else "")
        if d.get("remedy") and (d.get("afflicted") or str(d.get("status", "")).lower() in ("weak", "blocked", "imbalanced", "underactive", "overactive")):
            line += f"; remedy: {d['remedy']}"
        lines.append(line)
    return "\n".join(lines)

def _build_muhurta(engine) -> str:
    """The best dates in the next month and today's Abhijit window. This read `dates`;
    the engine returns top_dates and best_date, so the dates were dropped, and the
    hora it added came from the server's clock."""
    lines = []
    m = _safe(lambda: engine.find_muhurta("general", 30))
    if isinstance(m, dict):
        best = m.get("best_date") or {}
        if best.get("date"):
            lines.append(f"Best date: {best['date']} ({best.get('weekday', '')}), {best.get('tithi', '')}, "
                         f"nakshatra {best.get('nakshatra', '')} — {'; '.join(best.get('reasons') or [])}")
        for d in (m.get("top_dates") or [])[:5]:
            if isinstance(d, dict) and d.get("date") and d.get("date") != best.get("date"):
                lines.append(f"  {d['date']} ({d.get('weekday', '')}): {d.get('tithi', '')}, {d.get('nakshatra', '')}"
                             f" — {'; '.join((d.get('reasons') or [])[:2])}")
        if m.get("days_scanned"):
            lines.append(f"({m.get('dates_found', '?')} good dates in the next {m['days_scanned']} days)")
    t = _safe(lambda: engine.get_daily_timing())
    ab = (t or {}).get("abhijit_muhurta") if isinstance(t, dict) else None
    if isinstance(ab, dict) and ab.get("start"):
        lines.append(f"Abhijit today, local time: {ab['start']}–{ab['end']} — {ab.get('description', '')}")
    return "\n".join(lines)

def _build_planetary_returns(engine) -> str:
    pr = engine.get_planetary_returns()
    lines = []
    if isinstance(pr, dict):
        for planet, data in pr.items():
            if isinstance(data, dict):
                lines.append(f"  {planet}: {str(data.get('date', data.get('next_return', '')))[:40]} — {str(data.get('interpretation', ''))[:60]}")
    return "\n".join(lines)

def _build_weekly(engine) -> str:
    """The coming seven days. This read `summary`; the engine returns each day, the
    best day and the hardest, so the section was always empty."""
    w = engine.get_weekly_forecast() or {}
    lines = []
    for d in w.get("days") or []:
        if isinstance(d, dict) and d.get("date"):
            lines.append(f"  {d['date']}: {d.get('highlight', '')}; day score {d.get('score', '?')}/100; "
                         f"Rahu kalam {d.get('rahu_kalam', '?')}")
    for key, label in (("best_day", "Best day"), ("worst_day", "Hardest day")):
        b = w.get(key) or {}
        if isinstance(b, dict) and b.get("date"):
            lines.append(f"{label}: {b['date']} — {b.get('reason', '')}")
    return "\n".join(lines)

def _build_daily_snapshot(engine) -> str:
    lines = []
    rd = _safe(lambda: engine.get_realtime_dashboard())
    if isinstance(rd, dict):
        lines.append(f"Hora: {rd.get('current_hora', '')}")
        lines.append(f"Advice: {str(rd.get('quick_advice', ''))[:80]}")
    dr = _safe(lambda: engine.get_daily_ritual())
    if isinstance(dr, dict):
        lines.append(f"Ritual: {str(dr.get('ritual', dr.get('suggestion', '')))[:80]}")
    br = _safe(lambda: engine.get_biorhythm())
    if isinstance(br, dict):
        lines.append(f"Biorhythm: P={br.get('physical', '')} E={br.get('emotional', '')} I={br.get('intellectual', '')}")
    cmf = _safe(lambda: engine.get_color_metal_food())
    if isinstance(cmf, dict):
        lines.append(f"Today: color={cmf.get('color', '')} metal={cmf.get('metal', '')} food={cmf.get('food', '')}")
    return "\n".join(lines)

def _build_past_events(engine, event_date=None, event_type=None) -> str:
    if not event_date:
        return "Provide event date and type for past event analysis"
    result = engine.explain_past_event(event_date, event_type or "general")
    return str(result.get("explanation", result.get("summary", "")))[:300] if isinstance(result, dict) else ""

def _build_life_timeline(engine) -> str:
    """The next five years, each with its theme and the factors behind it. This read
    period/theme; the engine returns year/primary_theme, so every year was blank."""
    lt = engine.get_life_timeline(5) or {}
    lines = []
    for y in lt.get("timeline") or []:
        if isinstance(y, dict) and y.get("year"):
            line = f"  {y['year']}: {y.get('primary_theme', '')} (score {y.get('score', '?')})"
            if y.get("factors"):
                line += f" — {'; '.join(map(str, y['factors'][:3]))}"
            lines.append(line)
    for key, label in (("best_year", "Best year"), ("most_challenging", "Hardest year")):
        b = lt.get(key) or {}
        if b.get("year"):
            lines.append(f"{label}: {b['year']} — {b.get('theme', '')}")
    return "\n".join(lines)

def _build_relocation(engine) -> str:
    return "Provide city name for relocation analysis"

def _build_baby_names(engine) -> str:
    """Names by the birth star's syllable. The engine returns names split by gender
    in a dict; this expected a list, so it was always empty."""
    bn = engine.get_baby_names() or {}
    if not isinstance(bn, dict):
        return ""
    lines = []
    if bn.get("starting_sound"):
        lines.append(f"Birth star {bn.get('nakshatra', '?')} pada {bn.get('pada', '?')}: names that open with "
                     f"\"{bn['starting_sound']}\"")
    names = bn.get("names")
    if isinstance(names, dict):
        for g, lst in names.items():
            if lst:
                lines.append(f"  {g}: {', '.join(map(str, lst[:8]))}")
    elif isinstance(names, list) and names:
        lines.append(f"  {', '.join(map(str, names[:10]))}")
    return "\n".join(lines)

def _build_sudarshana(engine) -> str:
    """Sudarshana chakra: the year of life now running, read from lagna, Moon and Sun
    at once. This read a description field no ring has, so it printed empty labels.
    Each year of life activates the next house (year 1 the first, year 13 the first
    again), and that house's lords and occupants from the three charts colour it."""
    sc = engine.get_sudarshana() or {}
    cycle = sc.get("cycle") or {}
    if not cycle:
        return ""
    lines = [f"Rings: lagna {sc.get('lagna_rashi', '?')}, Moon {sc.get('moon_rashi', '?')}, Sun {sc.get('sun_rashi', '?')}"]
    try:
        b, now = engine.birth_local, engine.local_now()
        age = now.year - b.year - ((now.month, now.day) < (b.month, b.day))
        house = (age % 12) + 1
        h = cycle.get(house) or cycle.get(str(house)) or {}
        if h:
            parts = []
            for ring in ("lagna", "moon", "sun"):
                r = h.get(ring) or {}
                if r:
                    occ = ", ".join(r.get("occupants") or []) or "empty"
                    parts.append(f"from {ring} lord {r.get('lord', '?')}, {occ}")
            lines.append(f"Year of life {age + 1} activates house {house} ({h.get('house_name', '')}: "
                         f"{', '.join(h.get('meaning') or [])}) — " + "; ".join(parts)
                         + f"; strength {h.get('activation_strength', '?')}")
    except Exception:
        pass
    strong = sorted((v for v in cycle.values() if isinstance(v, dict)),
                    key=lambda v: -(v.get("activation_strength") or 0))[:3]
    if strong:
        lines.append("Most charged houses: " + "; ".join(
            f"{v.get('house')} {v.get('house_name', '')} ({v.get('activation_strength')})" for v in strong))
    return "\n".join(lines)

def _build_nakshatra(engine) -> str:
    np = engine.get_nakshatra_profile()
    mp = np.get("moon_profile", {}) if isinstance(np, dict) else {}
    lines = []
    if isinstance(mp, dict):
        lines.append(f"Moon Nakshatra: {mp.get('nakshatra', '')} Pada {mp.get('pada', '')}")
        for key in ['personality', 'career', 'health', 'relationship']:
            val = mp.get(key, "")
            if val:
                lines.append(f"  {key}: {str(val)[:100]}")
    return "\n".join(lines)

def _build_yoga_timing(engine) -> str:
    yt = engine.get_yoga_timing()
    lines = []
    if isinstance(yt, list):
        for y in yt[:8]:
            if isinstance(y, dict):
                lines.append(f"  {y.get('yoga', y.get('name', ''))}: {y.get('activation', y.get('timing', y.get('period', '')))}")
    return "\n".join(lines)

def _build_lucky(engine) -> str:
    """Numbers, today's mantra and remedies. This read lucky_numbers/mantra/
    primary_remedy; the engine returns mulank/bhagyank, primary_mantra and
    transit_remedies, so all three lines were blank."""
    lines = []
    ln = _safe(lambda: engine.get_lucky_numbers())
    if isinstance(ln, dict) and (ln.get("mulank") or ln.get("lucky_single_digits")):
        line = f"Mulank {ln.get('mulank', '?')}, bhagyank {ln.get('bhagyank', '?')}"
        if ln.get("lucky_single_digits"):
            line += f"; lucky digits {', '.join(map(str, ln['lucky_single_digits']))}"
        if ln.get("avoid_numbers"):
            line += f"; avoid {', '.join(map(str, ln['avoid_numbers']))}"
        lines.append(line)
        if ln.get("phone_hint"):
            lines.append(f"  {ln['phone_hint']}")
    dm = _safe(lambda: engine.get_dynamic_mantra())
    if isinstance(dm, dict) and dm.get("primary_mantra"):
        lines.append(f"Mantra now: {dm['primary_mantra']} for {dm.get('primary_planet', '')} — {dm.get('reason', '')}"
                     + (f" ({dm['count']}×, {dm.get('best_time', '')})" if dm.get("count") else ""))
    dr = _safe(lambda: engine.get_dynamic_remedies())
    for r in ((dr or {}).get("transit_remedies") or [])[:3] if isinstance(dr, dict) else []:
        if isinstance(r, dict) and r.get("remedy"):
            lines.append(f"  for {r.get('for', '')} ({r.get('urgency', '')}): {r['remedy']}")
    return "\n".join(lines)

def _build_bphs_advanced(engine) -> str:
    """States, strength in the vargas, wars, Nabhasa yogas, pushkara and retrogrades.
    This read fields none of these return (score, total, planet1, a list of pushkara
    names, a retrograde summary), so it printed nine planets with blank strengths."""
    lines = []
    av = _safe(lambda: engine.get_avasthas())
    if isinstance(av, dict):
        states = []
        for p, d in av.items():
            if not isinstance(d, dict):
                continue
            bits = [x for x in ((d.get("bala_mrita") or {}).get("avastha"), (d.get("deeptadi") or {}).get("avastha"),
                                (d.get("shayan") or {}).get("avastha")) if x]
            if bits:
                states.append(f"{p} {'/'.join(bits)}")
        if states:
            lines.append("Avasthas (age/brightness/posture): " + "; ".join(states))
    vm = _safe(lambda: engine.get_vimshopaka())
    if isinstance(vm, dict):
        rows = [f"{p} {d['vimshopaka']}/{d.get('max', 20)} {d.get('classification', '')}".strip()
                for p, d in vm.items() if isinstance(d, dict) and d.get("vimshopaka") is not None]
        if rows:
            lines.append("Vimshopaka (strength across the vargas): " + "; ".join(rows))
    gy = _safe(lambda: engine.get_graha_yuddha())
    if isinstance(gy, dict):
        for w in (gy.get("wars") or [])[:3]:
            if isinstance(w, dict):
                a, b = w.get("planet1") or w.get("planets", ["?", "?"])[0], w.get("planet2") or (w.get("planets") or ["?", "?"])[-1]
                lines.append(f"Planetary war: {a} vs {b} — winner {w.get('winner', '?')}")
    ny = _safe(lambda: engine.get_nabhasa_yogas())
    if isinstance(ny, dict):
        for y in (ny.get("yogas") or [])[:4]:
            if isinstance(y, dict) and y.get("name"):
                lines.append(f"Nabhasa: {y['name']} ({y.get('type', '')}) — {y.get('description', '')}")
    pk = _safe(lambda: engine.get_pushkara())
    if isinstance(pk, dict):
        for p in (pk.get("pushkara_planets") or [])[:5]:
            if isinstance(p, dict) and p.get("planet"):
                kind = " and ".join(k for k, f in (("navamsa", p.get("pushkara_navamsa")), ("bhaga", p.get("pushkara_bhaga"))) if f)
                lines.append(f"Pushkara {kind}: {p['planet']} in {p.get('rashi', '?')} at {p.get('degree', '?')}° — "
                             f"{p.get('significance', '')}")
            elif isinstance(p, str):
                lines.append(f"Pushkara: {p}")
    nr = _safe(lambda: engine.get_natal_retrogrades())
    if isinstance(nr, dict):
        for p in (nr.get("planets") or [])[:4]:
            if isinstance(p, dict) and p.get("planet"):
                lines.append(f"Retrograde at birth: {p['planet']} in H{p.get('house', '?')} — {p.get('effects', '')}")
    return "\n".join(lines)

def _build_spiritual(engine) -> str:
    """Renunciation combinations and the karakamsa. This read karakamsa purpose/
    indication; the engine returns life_purpose and the karakamsa sign."""
    lines = []
    sy = _safe(lambda: engine.get_sannyasa_yogas())
    if isinstance(sy, dict):
        ys = [y for y in (sy.get("yogas") or []) if isinstance(y, dict)]
        lines.append(f"Sannyasa / pravrajya: {sy.get('overall') or (str(len(ys)) + ' found')}")
        for y in ys[:3]:
            lines.append(f"  {y.get('name', '')}: {y.get('description', '')}")
    km = _safe(lambda: engine.get_karakamsa())
    if isinstance(km, dict) and (km.get("karakamsa_name") or km.get("life_purpose")):
        lines.append(f"Karakamsa: {km.get('karakamsa_name', '?')} (Atmakaraka {km.get('atmakaraka', '?')}, "
                     f"house {km.get('swamsa_house', '?')} from the lagna) — {km.get('life_purpose', '')}")
    return "\n".join(lines)

def _build_maraka(engine) -> str:
    m = engine.get_maraka()
    if isinstance(m, dict):
        planets = m.get("maraka_planets", [])
        return f"Maraka planets: {', '.join(str(p) for p in planets)}" if planets else "No strong maraka influence"
    return ""

def _build_argala(engine) -> str:
    """Argala — which houses each house is supported or blocked by — and the
    Sarvatobhadra vedhas now. This iterated the top-level keys (system,
    house_analysis) as houses, so it printed "Hhouse_analysis:"."""
    lines = []
    ar = _safe(lambda: engine.get_argala())
    ha = (ar or {}).get("house_analysis") if isinstance(ar, dict) else None
    if isinstance(ha, dict):
        for h, d in sorted(ha.items(), key=lambda kv: int(kv[0])):
            if isinstance(d, dict):
                lines.append(f"  H{h} ({', '.join((d.get('house_meaning') or [])[:2])}): net support "
                             f"{d.get('net_support', '?')} — {d.get('overall', '')}")
    sb = _safe(lambda: engine.get_sarvatobhadra())
    if isinstance(sb, dict):
        for v in (sb.get("vedhas") or [])[:5]:
            if isinstance(v, dict):
                lines.append(f"  Vedha now: transiting {v.get('transit_planet', '?')} ({v.get('transit_nakshatra', '?')}) "
                             f"strikes natal {v.get('natal_planet', '?')} ({v.get('natal_nakshatra', '?')}) — "
                             f"{v.get('type', '')}: {v.get('effect', '')}")
    return "\n".join(lines)

def _build_tithi_pravesh(engine) -> str:
    tp = engine.get_tithi_pravesh()
    lines = []
    if isinstance(tp, dict):
        analysis = tp.get("analysis", {})
        if isinstance(analysis, dict):
            lines.append(f"Rating: {analysis.get('overall_rating', '')} (score {analysis.get('score', '')})")
        cv = tp.get("cross_validation", {})
        if isinstance(cv, dict):
            lines.append(f"Confidence: {cv.get('confidence', '')}")
    return "\n".join(lines)

def _build_chart_promise(engine, topic=None) -> str:
    if topic:
        cp = engine.get_chart_promise(topic)
    else:
        cp = engine.get_chart_promise()
    lines = []
    if isinstance(cp, dict):
        if 'events' in cp:
            for event, data in cp['events'].items():
                if isinstance(data, dict):
                    lines.append(f"  {event}: {data.get('summary', '')[:80]}")
        else:
            lines.append(f"  {cp.get('summary', '')}")
            supports = cp.get('supports', [])
            for s in (supports if isinstance(supports, list) else [])[:3]:
                text = s.get('text', str(s)) if isinstance(s, dict) else str(s)
                lines.append(f"    ✓ {text[:80]}")
    return "\n".join(lines)

def _build_period_query(engine) -> str:
    now = datetime.now()
    result = _safe(lambda: engine.get_period_analysis(3))
    lines = []
    if isinstance(result, dict):
        lines.append(f"Next 3 months: {str(result.get('summary', result.get('themes', '')))[:150]}")
    return "\n".join(lines)

def _build_compatibility_self(engine) -> str:
    """Their side of a match. A compatibility score needs both charts and the chat
    has one, so the section says so and gives what one chart can: the 7th house,
    Venus, the Darakaraka, the Navamsa's marriage reading and Manglik status. The
    classifier could always pick `compatibility`, and there was no builder at all."""
    lines = ["A match score needs the partner's birth date, time and place, which were not given. "
             "Their side of any match:"]
    h7 = build_house_detail(engine, 7)
    if h7:
        lines.append("  7th house: " + "; ".join(x.strip() for x in h7.splitlines() if x.strip()))
    v = (engine.planets or {}).get("Venus") or {}
    if v.get("rashi_name"):
        lines.append(f"  Venus in {v['rashi_name']} H{v.get('house', '?')}" + (" (retrograde)" if v.get("retrograde") else ""))
    dk = (engine.get_jaimini_karakas() or {}).get("Darakaraka") or {}
    if dk.get("planet"):
        lines.append(f"  Darakaraka (the spouse significator): {dk['planet']} in {dk.get('rashi_name', '?')}")
    d9 = (engine.get_varga_analysis() or {}).get("navamsa_d9") or {}
    if d9.get("marriage_strength") or d9.get("spouse_description"):
        lines.append(f"  Navamsa: marriage {d9.get('marriage_strength', '?')}; the partner it describes: "
                     f"{d9.get('spouse_description', '?')}")
    m = engine.check_manglik() or {}
    if isinstance(m, dict) and "is_manglik" in m:
        lines.append(f"  Manglik: {'yes' if m['is_manglik'] else 'no'} ({m.get('dosha_strength', '')})")
    return "\n".join(lines)


def _build_manglik(engine) -> str:
    """Mangal dosha from lagna, Moon and Venus, with its cancellations. This read
    is_cancelled and severity; the engine returns has_cancellation, cancellations and
    dosha_strength, so the severity line was always blank."""
    m = engine.check_manglik() or {}
    if not isinstance(m, dict) or "is_manglik" not in m:
        return ""
    lines = [f"Manglik: {'Yes' if m['is_manglik'] else 'No'} — {m.get('dosha_strength', '')}".rstrip(" —")]
    for ref, a in (m.get("analysis") or {}).items():
        if isinstance(a, dict):
            house = next((v for k, v in a.items() if k.startswith("mars_house")), "?")
            sev = a.get("severity")
            lines.append(f"  from {a.get('reference', ref)}: Mars in H{house} — "
                         f"{'manglik' if a.get('is_manglik') else 'clear'}" + (f" ({sev})" if sev else ""))
    for c in (m.get("cancellations") or [])[:3]:
        if isinstance(c, dict) and c.get("condition"):
            lines.append(f"  cancellation: {c['condition']} — {c.get('details', '')} ({c.get('strength', '')})")
    if m.get("recommendation"):
        lines.append(f"  {m['recommendation']}")
    return "\n".join(lines)

def _build_pratyantar(engine) -> str:
    pd = engine.get_pratyantar_dasha()
    lines = []
    if isinstance(pd, dict):
        current = pd.get("current", pd.get("pratyantar", ""))
        lines.append(f"Current: {current}")
        upcoming = pd.get("upcoming", pd.get("next", []))
        for u in (upcoming if isinstance(upcoming, list) else [])[:5]:
            if isinstance(u, dict):
                lines.append(f"  {u.get('lord', u.get('planet', ''))}: {str(u.get('start', ''))[:10]} to {str(u.get('end', ''))[:10]}")
    return "\n".join(lines)

def _build_timing_windows(engine, topic=None) -> str:
    """When the chart's own rules say an event can come: its promise (the rules for and
    against), whether the running daśā activates it, and the transit trigger.

    The window this printed was not computed. predict_event offsets it from TODAY — six
    months, twelve, or three to N, by how many conditions hold — and this printed only
    the two dates, labelled "Best window", so the prompt's own rule ("dates are data")
    licensed the model to state them; asked next month, the "window" moved a month.
    It now gives the verdict and its conditions, and the window only as the rule of
    thumb it is. The dated windows are the daśā chapters in TIMING FOCUS."""
    topic_event = {
        "marriage": "marriage", "love": "relationship", "relationship": "relationship",
        "compatibility": "relationship", "career": "career", "job": "job_change",
        "work": "career", "promotion": "promotion", "business": "business",
        "wealth": "wealth", "money": "wealth", "finance": "wealth", "health": "health_issue",
        "children": "childbirth", "family": "property", "property": "property",
        "home": "property", "travel": "foreign", "foreign": "foreign",
        "education": "education", "spirituality": "spiritual", "spiritual": "spiritual",
    }
    ev = topic_event.get((topic or "").strip().lower())
    if not ev:
        scan = engine.scan_all_predictions() or {}
        rows = [r for r in (scan.get("top_indicated") or []) if isinstance(r, dict) and r.get("event")]
        lines = [f"  {r['event'].replace('_', ' ')}: {r.get('verdict', '')} — daśā {r.get('dasha', '')}, "
                 f"transit {r.get('transit', '')}" for r in rows[:6]]
        if lines:
            lines.insert(0, "Events this chart indicates in the running period, strongest first:")
        return "\n".join(lines)
    r = engine.predict_event(ev) or {}
    if r.get("error") or not r.get("verdict"):
        return ""
    lines = [f"{ev.replace('_', ' ').capitalize()}: {r['verdict']}"]
    if r.get("timing_assessment"):
        lines.append(f"  {r['timing_assessment']}")
    cp = r.get("chart_promise") or {}
    if cp:
        line = f"  Promise: {cp.get('summary') or cp.get('level', '')}"
        if cp.get("key_supports"):
            line += f"; for it: {'; '.join(map(str, cp['key_supports'][:2]))}"
        if cp.get("key_oppositions"):
            line += f"; against: {'; '.join(map(str, cp['key_oppositions'][:2]))}"
        if cp.get("denials"):
            line += f"; denied by: {'; '.join(map(str, cp['denials'][:2]))}"
        lines.append(line)
    d = r.get("dasha") or {}
    if d.get("mahadasha"):
        lines.append(f"  Daśā {d['mahadasha']}/{d.get('antardasha', '')}: activation {d.get('activation', '?')}"
                     + (f" — {d['description']}" if d.get("description") else ""))
    t = r.get("transit") or {}
    if t.get("strength"):
        bits = []
        if t.get("double_transit_houses"):
            bits.append(f"Jupiter and Saturn both on H{', H'.join(map(str, t['double_transit_houses']))}")
        if t.get("partial_transit_houses"):
            bits.append(f"one of them on H{', H'.join(map(str, t['partial_transit_houses']))}")
        lines.append(f"  Transit trigger: {t['strength']}" + (f" ({'; '.join(bits)})" if bits else ""))
    k = r.get("karaka") or {}
    if k.get("planet"):
        lines.append(f"  Karaka {k['planet']} in H{k.get('house', '?')}" + (f", {k['dignity']}" if k.get("dignity") else ""))
    w = r.get("window") or {}
    if w.get("description"):
        lines.append(f"  Rule of thumb: {w['description']} — counted from today, not a computed date.")
    return "\n".join(lines)

def _build_arudha_padas(engine) -> str:
    result = _safe(lambda: engine.get_arudha_padas())
    lines = []
    if isinstance(result, dict):
        for pada, data in result.items():
            if isinstance(data, dict):
                lines.append(f"  {pada}: {data.get('sign', '')} H{data.get('house', '')} — {str(data.get('interpretation', ''))[:80]}")
            elif isinstance(data, str):
                lines.append(f"  {pada}: {data}")
    return "\n".join(lines[:12])

def _build_av_transits(engine) -> str:
    result = _safe(lambda: engine.get_ashtakavarga_transits())
    lines = []
    if isinstance(result, dict):
        for planet, data in list(result.items())[:9]:
            if isinstance(data, dict):
                bindus = data.get('bindus', data.get('score', ''))
                lines.append(f"  {planet} transit: {bindus} bindus — {'favorable' if isinstance(bindus, (int,float)) and bindus >= 4 else 'weak'}")
    return "\n".join(lines)

def _build_future_transits(engine) -> str:
    """When the slow planets change sign over the next two years, and the houses
    each ingress lights from the Moon and the lagna. This read `events`; the engine
    returns major_transits per planet, so real future dates were dropped."""
    result = engine.get_future_transits() or {}
    lines = []
    for planet, rows in (result.get("major_transits") or {}).items():
        for r in (rows or [])[:5]:
            if isinstance(r, dict) and r.get("date"):
                lines.append(f"  {r['date']}: {planet} {r.get('from_rashi', '?')} → {r.get('to_rashi', '?')} "
                             f"(H{r.get('house_from_moon', '?')} from Moon, H{r.get('house_from_lagna', '?')} from lagna)")
    lines.sort()
    if lines and result.get("months_scanned"):
        lines.insert(0, f"Sign changes in the next {result['months_scanned']} months:")
    return "\n".join(lines)

def _build_transit_aspects(engine) -> str:
    result = _safe(lambda: engine.get_transit_aspects())
    lines = []
    aspects = result.get("aspects", result) if isinstance(result, dict) else (result if isinstance(result, list) else [])
    for a in (aspects if isinstance(aspects, list) else [])[:8]:
        if isinstance(a, dict):
            lines.append(f"  {a.get('transit_planet', '')} {a.get('aspect', '')} natal {a.get('natal_planet', '')} — {str(a.get('effect', ''))[:60]}")
    return "\n".join(lines)

def _build_name_numerology(engine, name: str = "") -> str:
    """The name's own number, Chaldean and Pythagorean. It needs the NAME, which the
    engine (cached per birth chart, shared by everyone born then) does not hold, so
    it is passed in per request. It used to call the engine with no name, raise,
    and come back empty every time."""
    name = (name or "").strip()
    if not name:
        return ""
    r = engine.get_name_numerology(name) or {}
    nk = r.get("namank") or {}
    lines = []
    ch, py = nk.get("chaldean") or {}, nk.get("pythagorean") or {}
    if ch.get("root"):
        line = f"Chaldean: {ch.get('compound', '?')}/{ch['root']}"
        if ch.get("compound_name"):
            line += f" — {ch['compound_name']}: {ch.get('compound_meaning', '')}"
        if ch.get("root_meaning"):
            line += f"; root {ch['root']} {ch['root_meaning']}"
        lines.append(line)
    if py.get("root"):
        lines.append(f"Pythagorean: {py.get('compound', '?')}/{py['root']}"
                     + (f" — {py['root_meaning']}" if py.get("root_meaning") else ""))
    for k, v in r.items():
        if k != "namank" and isinstance(v, (str, int, float)) and str(v).strip():
            lines.append(f"{k.replace('_', ' ')}: {v}")
    return "\n".join(lines)

def _build_hora(engine) -> str:
    """The planetary hour now at the chart's place, and what it suits. This read keys
    the hora record does not have (activities, best_for at the top level) and called
    get_next_hora without the planet it needs."""
    lines = []
    h = _safe(lambda: engine.get_current_hora_info())
    if isinstance(h, dict) and h.get("hora_lord"):
        info = h.get("hora_info") or {}
        line = f"Current hora: {h['hora_lord']} ({h.get('start', '?')}–{h.get('end', '?')} local, "
        line += f"{h.get('minutes_remaining', '?')} min left; day lord {h.get('day_lord', '?')})"
        lines.append(line)
        if info.get("best_for"):
            lines.append(f"  Best for: {info['best_for']}")
        if info.get("avoid"):
            lines.append(f"  Avoid: {info['avoid']}")
        for planet in ("Jupiter", "Venus"):
            if planet != h["hora_lord"]:
                nh = _safe(lambda p=planet: engine.get_next_hora(p))
                if isinstance(nh, dict) and nh.get("hours_away", -1) >= 0:
                    lines.append(f"  Next {planet} hora: {str(nh.get('starts_at', ''))[11:16]} local "
                                 f"(in {nh['hours_away']} h)")
    return "\n".join(lines)

def _build_panchanga(engine) -> str:
    """Today's five limbs. This read `name`/`value`; the engine returns tithi_name,
    nakshatra_name, yoga_name and karana_name, so all five limbs came out blank."""
    p = engine.get_panchanga() or {}
    lines = []
    t = p.get("tithi") or {}
    if t.get("tithi_name"):
        line = f"  Tithi: {t['tithi_name']} ({t.get('paksha', '')} paksha)"
        if t.get("nature"):
            line += f" — {t['nature']}"
        if t.get("recommended_activity"):
            line += f"; suits {str(t['recommended_activity']).lower()}"
        lines.append(line)
    v = p.get("vara") or {}
    if v.get("vara"):
        line = f"  Vara: {v['vara']} (lord {v.get('vara_lord', '?')})"
        if v.get("nature"):
            line += f" — {v['nature']}"
        if v.get("good_for"):
            line += f"; good for {str(v['good_for']).lower()}"
        lines.append(line)
    n = p.get("nakshatra") or {}
    if n.get("nakshatra_name"):
        lines.append(f"  Nakshatra: {n['nakshatra_name']} (lord {n.get('nakshatra_lord', '?')}, pada "
                     f"{n.get('pada', '?')}, deity {n.get('deity', '?')})"
                     + (f" — {n['nature']}" if n.get("nature") else ""))
    y = p.get("yoga") or {}
    if y.get("yoga_name"):
        lines.append(f"  Yoga: {y['yoga_name']}" + (f" — {y['nature']}" if y.get("nature") else ""))
    k = p.get("karana") or {}
    if k.get("karana_name"):
        lines.append(f"  Karana: {k['karana_name']}" + (f" — {k['nature']}" if k.get("nature") else ""))
    return "\n".join(lines)

def _build_dasha_sandhi(engine) -> str:
    result = _safe(lambda: engine.get_dasha_sandhi())
    if isinstance(result, dict):
        sandhi = result.get("sandhi_periods", result.get("transitions", []))
        lines = []
        for s in (sandhi if isinstance(sandhi, list) else [])[:5]:
            if isinstance(s, dict):
                lines.append(f"  {s.get('from', '')} → {s.get('to', '')}: {str(s.get('date', ''))[:10]} — {str(s.get('effect', ''))[:60]}")
        if not lines:
            lines.append("No critical dasha transitions upcoming")
        return "\n".join(lines)
    return ""

def _build_rashi_drishti(engine) -> str:
    result = _safe(lambda: engine.get_rashi_drishti())
    lines = []
    if isinstance(result, dict):
        for sign, data in list(result.items())[:12]:
            if isinstance(data, dict):
                aspected_by = data.get('aspected_by', [])
                if aspected_by:
                    lines.append(f"  {sign}: aspected by {', '.join(str(a) for a in aspected_by[:4])}")
    return "\n".join(lines)

def _build_av_sodhana(engine) -> str:
    """Ashtakavarga after the trikona and ekadhipatya reductions: the SAV sign by sign,
    and each planet's own chart by its totals. The reductions used to run on sign
    indices instead of bindus (see bphs/av_sodhana.py), so every figure was wrong."""
    result = _safe(lambda: engine.get_av_sodhana())
    if not isinstance(result, dict):
        return ""
    lines = []
    sav = result.get("SAV")
    if isinstance(sav, dict):
        rows = [f"{x.get('sign', '?')} {x.get('original', '?')}→{x.get('after_sodhana', '?')}"
                for x in (sav.get("details") or []) if isinstance(x, dict)]
        lines.append(f"SAV: {sav.get('original_total', '?')} bindus before reduction, {sav.get('reduced_total', '?')} after"
                     + (" — " + ", ".join(rows) if rows else ""))
    planets = [f"{p} {d.get('original_total', '?')}→{d.get('reduced_total', '?')}"
               for p, d in result.items() if p != "SAV" and isinstance(d, dict)]
    if planets:
        lines.append("Each planet's own chart, before→after: " + "; ".join(planets))
    return "\n".join(lines)

def _build_prastara(engine) -> str:
    result = _safe(lambda: engine.get_prastara_av())
    if isinstance(result, dict):
        lines = [f"Total rows: {len(result)}"]
        for planet, grid in list(result.items())[:3]:
            if isinstance(grid, (list, dict)):
                lines.append(f"  {planet}: {str(grid)[:100]}")
        return "\n".join(lines)
    return ""

def _build_shodhya_pinda(engine) -> str:
    """Each planet's numerical strength from its reduced ashtakavarga (BPHS Ch. 43).
    The engine nests the planets under `planets`; this iterated the top level and
    printed one empty row named "planets"."""
    result = _safe(lambda: engine.get_shodhya_pinda())
    rows = (result or {}).get("planets") if isinstance(result, dict) else None
    if not isinstance(rows, dict):
        rows = result if isinstance(result, dict) else {}
    out = []
    for planet, d in sorted(rows.items(), key=lambda kv: (kv[1] or {}).get("rank", 99) if isinstance(kv[1], dict) else 99):
        if isinstance(d, dict) and d.get("shodhya_pinda") is not None:
            out.append(f"  {planet}: shodhya pinda {d['shodhya_pinda']} (rashi {d.get('rashi_pinda', '?')}, "
                       f"graha {d.get('graha_pinda', '?')})" + (f", rank {d['rank']}" if d.get("rank") else ""))
    return "\n".join(out)

def _build_bhava_strengths(engine) -> str:
    result = _safe(lambda: engine.get_bhava_strengths())
    lines = []
    if isinstance(result, dict):
        for house, data in sorted(result.items(), key=lambda x: str(x[0])):
            if isinstance(data, dict):
                lines.append(f"  H{house}: {data.get('strength', data.get('score', ''))}")
    return "\n".join(lines[:12])

def _build_ishta_kashta(engine) -> str:
    result = _safe(lambda: engine.get_ishta_kashta())
    lines = []
    if isinstance(result, dict):
        for planet, data in result.items():
            if isinstance(data, dict):
                ishta = data.get('ishta', 0)
                kashta = data.get('kashta', 0)
                net = ishta - kashta if isinstance(ishta, (int,float)) and isinstance(kashta, (int,float)) else 0
                lines.append(f"  {planet}: ishta={ishta} kashta={kashta} net={'positive' if net > 0 else 'negative'}")
    return "\n".join(lines[:9])

def _build_gemstones(engine) -> str:
    """Gemstones and how to wear them. The engine returns a LIST of recommendations;
    this expected a dict holding one, so it was always empty."""
    recs = engine.get_gemstone_recommendations() or []
    if isinstance(recs, dict):
        recs = recs.get("recommendations") or recs.get("gemstones") or []
    lines = []
    for g in recs[:4]:
        if not isinstance(g, dict) or not g.get("gemstone"):
            continue
        line = f"  {g['gemstone']} for {g.get('planet', '?')}: {g.get('reason', '')}"
        how = [x for x in (f"set in {g['metal']}" if g.get("metal") else "", g.get("finger", ""),
                           g.get("weight", ""),
                           f"first worn on a {g['day_to_wear']}" if g.get("day_to_wear") else "",
                           g.get("time", "")) if x]
        if how:
            line += " — " + ", ".join(how)
        if g.get("substitute"):
            line += f"; substitutes: {', '.join(map(str, g['substitute'][:3]))}"
        if g.get("contraindications"):
            line += f"; caution: {g['contraindications']}"
        lines.append(line)
    return "\n".join(lines)

def _build_synastry(engine) -> str:
    return "Synastry requires partner birth data"

def _build_composite(engine) -> str:
    return "Composite chart requires partner birth data"

def _build_location(engine) -> str:
    result = _safe(lambda: engine.analyze_location())
    if isinstance(result, dict):
        return f"Current location analysis: {str(result.get('summary', result.get('analysis', '')))[:200]}"
    return "Provide target city for location analysis"

def _build_raja_yogas(engine) -> str:
    result = _safe(lambda: engine.get_raja_yogas())
    lines = []
    yogas = result.get("yogas", result) if isinstance(result, dict) else (result if isinstance(result, list) else [])
    for y in (yogas if isinstance(yogas, list) else [])[:8]:
        if isinstance(y, dict):
            lines.append(f"  {y.get('name', '')}: {str(y.get('description', y.get('effect', '')))[:80]}")
    return "\n".join(lines) if lines else "No raja yogas identified"

def _build_dhana_yogas(engine) -> str:
    result = _safe(lambda: engine.get_dhana_yogas())
    lines = []
    yogas = result.get("yogas", result) if isinstance(result, dict) else (result if isinstance(result, list) else [])
    for y in (yogas if isinstance(yogas, list) else [])[:8]:
        if isinstance(y, dict):
            lines.append(f"  {y.get('name', '')}: {str(y.get('description', y.get('effect', '')))[:80]}")
    return "\n".join(lines) if lines else "No dhana yogas identified"

def _build_daridra_yogas(engine) -> str:
    result = _safe(lambda: engine.get_daridra_yogas())
    lines = []
    for y in (result if isinstance(result, list) else [])[:8]:
        if isinstance(y, dict):
            # check_daridra_yogas returns {'text','source','nature'} — no 'name',
            # no 'description'. Reading the wrong keys rendered every detected
            # poverty yoga as a bare "  :" and the Oracle was shown nothing where
            # BPHS Ch.42 had actually fired.
            body = str(y.get('text') or y.get('description') or y.get('effect') or '').strip()
            name = str(y.get('name') or y.get('yoga') or y.get('source') or '').strip()
            if not body and not name:
                continue
            lines.append(f"  {name}: {body[:160]}" if name and body else f"  {name or body[:160]}")
    return "\n".join(lines) if lines else "No daridra yogas found"

def _build_female(engine, gender: str = "") -> str:
    """BPHS's rules for a woman's chart (Ch. 78–80). They describe the husband and the
    marriage FROM a woman's chart, so they are only given for one: the engine applies
    them to every chart, and a man was told what his "husband" would be like. The
    gender comes from the birth record; unknown, the rules arrive labelled."""
    g = (gender or "").lower()
    if g == "male":
        return ""
    result = _safe(lambda: engine.get_female_horoscopy())
    lines = []
    for r in (result if isinstance(result, list) else [])[:6]:
        if isinstance(r, dict):
            txt = r.get("text") or r.get("description") or r.get("effect") or r.get("rule") or ""
            if txt:
                src = f" ({r['source']})" if r.get("source") else ""
                lines.append(f"  {txt}{src}")
    if lines and g != "female":
        lines.insert(0, "(These rules read a woman's chart; the gender was not given.)")
    return "\n".join(lines)

def _build_longevity(engine) -> str:
    result = _safe(lambda: engine.get_longevity())
    if isinstance(result, dict):
        category = result.get('longevity_category', result.get('category', ''))
        years = result.get('estimated_years', result.get('years', ''))
        method = result.get('method', '3-pair')
        lines = [f"Category: {category}"]
        if years:
            lines.append(f"Estimate: {years}")
        lines.append(f"Method: {method}")
        pairs = result.get('pairs', [])
        for p in (pairs if isinstance(pairs, list) else [])[:3]:
            if isinstance(p, dict):
                lines.append(f"  Pair: {p.get('planet1', '')} + {p.get('planet2', '')} = {p.get('result', '')}")
        return "\n".join(lines)
    return ""

def _build_dasha_psych(engine) -> str:
    """How each level of the running daśā tends to feel from the inside. This read
    psychological_state/dasha_lord; the engine returns overall_state, life_theme,
    current_chapter, current_mood and the rest. Its oracle_tone field is an
    instruction to the responder, not a fact about the person, and is left out."""
    r = _safe(lambda: engine.get_dasha_psychology())
    if not isinstance(r, dict):
        return ""
    lines = []
    if r.get("dasha_string"):
        lines.append(f"Running: {r['dasha_string']}")
    for k, label in (("overall_state", "Overall"), ("life_theme", "The chapter"), ("current_chapter", "The sub-period"),
                     ("current_mood", "This stretch"), ("today_energy", "Today"), ("user_needs", "What they need"),
                     ("current_risks", "Risks")):
        if r.get(k):
            lines.append(f"{label}: {r[k]}")
    return "\n".join(lines)

def _build_dasha_interp(engine) -> str:
    """What the running daśā lords rule and do, level by level, per BPHS. This read a
    flat dasha_lord; the engine returns mahadasha / antardasha / pratyantardasha."""
    r = _safe(lambda: engine.get_dasha_interpretation())
    if not isinstance(r, dict):
        return ""
    lines = []
    for level in ("mahadasha", "antardasha", "pratyantardasha"):
        d = r.get(level) or {}
        if not (isinstance(d, dict) and d.get("dasha_lord")):
            continue
        bits = []
        ruled = ", ".join(f"H{h}" for h in (d.get("houses_ruled") or []))
        if ruled:
            bits.append(f"rules {ruled}")
        if d.get("placed_in_house"):
            bits.append(f"placed in H{d['placed_in_house']}")
        bits += [str(d[k]) for k in ("nature", "strength") if d.get(k)]
        line = f"{level.capitalize()} {d['dasha_lord']}: " + ", ".join(bits)
        if d.get("themes"):
            line += f"; themes {', '.join(map(str, d['themes']))}"
        if d.get("text"):
            line += f" — {d['text']}"
        lines.append(line)
    return "\n".join(lines)

def _build_special_lagnas(engine) -> str:
    result = _safe(lambda: engine.get_special_lagnas())
    lines = []
    if isinstance(result, dict):
        for lagna_name in ['hora_lagna', 'ghati_lagna']:
            d = result.get(lagna_name, {})
            if isinstance(d, dict):
                lines.append(f"  {lagna_name.replace('_', ' ').title()}: {d.get('sign', '')} — {str(d.get('effect', d.get('interpretation', '')))[:80]}")
    return "\n".join(lines)

def _build_jaimini_complete(engine) -> str:
    result = _safe(lambda: engine.get_complete_jaimini())
    lines = []
    if isinstance(result, dict):
        # Arudha Padas
        padas = result.get('arudha_padas', {})
        for key in ['A1', 'A7', 'A10', 'A12']:
            p = padas.get(key, {})
            if isinstance(p, dict):
                lines.append(f"  {p.get('name', key)}: {p.get('rashi', '')} H{p.get('house', '')}")
        # Swamsa
        sw = result.get('swamsa', {})
        if isinstance(sw, dict) and sw.get('swamsa_sign'):
            lines.append(f"  Swamsa: {sw['swamsa_sign']} — {sw.get('soul_purpose', '')}")
        # Jaimini yogas
        jy = result.get('jaimini_yogas', [])
        for y in (jy if isinstance(jy, list) else [])[:3]:
            if isinstance(y, dict):
                lines.append(f"  {y.get('name', '')}: {str(y.get('description', ''))[:60]}")
    return "\n".join(lines)

def _build_upapada(engine) -> str:
    result = _safe(lambda: engine.get_upapada())
    if isinstance(result, dict):
        lines = [
            f"Upapada: {result.get('upapada_sign', '')} H{result.get('upapada_house', '')}",
            f"UL Lord: {result.get('upapada_lord', '')} in H{result.get('upapada_lord_house', '')}",
            f"Spouse: {result.get('spouse_indication', '')}",
            f"Marriage: {result.get('marriage_longevity', '')}",
        ]
        return "\n".join(lines)
    return ""

def _build_muhurta_rules(engine) -> str:
    lines = []
    for event in ['marriage', 'business_start', 'travel', 'education_start']:
        result = _safe(lambda e=event: engine.get_muhurta_rules(e))
        if isinstance(result, dict):
            rules = result.get('rules', {})
            special = rules.get('special', '') if isinstance(rules, dict) else ''
            lines.append(f"  {event}: {special[:80]}")
    return "\n".join(lines)

# ═══ NEW BPHS SECTIONS ═══
def _build_d60(engine) -> str:
    r = _safe(lambda: engine.get_d60_interpretation())
    return "\n".join(f"  {p}: {d.get('name','')} — {d.get('past_life','')[:80]}" for p, d in (r if isinstance(r, dict) else {}).items())

def _build_remaining_vargas(engine) -> str:
    r = _safe(lambda: engine.get_remaining_vargas())
    lines = []
    for div, data in (r if isinstance(r, dict) else {}).items():
        if isinstance(data, dict):
            lines.append(f"  {div} ({data.get('name','')}): {data.get('theme','')} | {', '.join(data.get('key_planets', []))}")
    return "\n".join(lines)

def _build_mrityu_bhaga_sec(engine) -> str:
    r = _safe(lambda: engine.get_mrityu_bhaga())
    if isinstance(r, list) and r:
        return "\n".join(f"  {m.get('planet','')}: {m.get('degree','')}° (MB={m.get('mrityu_bhaga','')}) — {m.get('severity','')}" for m in r)
    return "No planets at Mrityu Bhaga"

def _build_bhrigu_bindu_sec(engine) -> str:
    r = _safe(lambda: engine.get_bhrigu_bindu())
    return r.get('interpretation', '') if isinstance(r, dict) else ""

def _build_pada_archetypes(engine) -> str:
    r = _safe(lambda: engine.get_pada_archetypes())
    lines = []
    for p, d in (r if isinstance(r, dict) else {}).items():
        if isinstance(d, dict):
            lines.append(f"  {p}: {d.get('nakshatra','')} P{d.get('pada','')} → {d.get('navamsa_sign','')} ({d.get('nature','')})")
    return "\n".join(lines)

def _build_pancha_pakshi_sec(engine) -> str:
    r = _safe(lambda: engine.get_pancha_pakshi())
    if isinstance(r, dict):
        return f"Bird: {r.get('birth_bird','')} | Activity: {r.get('current_activity','')} | {r.get('advice','')}"
    return ""

def _build_graha_shanti_sec(engine) -> str:
    r = _safe(lambda: engine.get_graha_shanti())
    lines = []
    for planet, data in (r if isinstance(r, dict) else {}).items():
        if isinstance(data, dict):
            lines.append(f"  {planet}: {data.get('gemstone','')} ({data.get('weight_min_ct','')}ct {data.get('metal','')}) | {data.get('day','')} | {data.get('mantra','')[:40]}... ×{data.get('count','')}")
    return "\n".join(lines)

SECTION_MAP['d60_past_life'] = ('D60 PAST LIFE', _build_d60)
SECTION_MAP['remaining_vargas'] = ('REMAINING DIVISIONAL CHARTS', _build_remaining_vargas)
def _build_upagrahas_sec(engine) -> str:
    """The sub-planets, as a chart sheet.

    Two families, and they are printed apart because they answer different
    questions. The five from the Sun are shadow-points every chart has in the
    same relation to its Sun; the five from time are the ascendant at a
    particular part of the birth day, and Gulika is the one classical readers
    actually use — the place a chart drags, delays and hardens.

    Kept to one line each, in the same shape as the base chart above: the model
    reads this as a sheet, and a paragraph per point would crowd out the planets
    it has to be read against.
    """
    u = _safe(lambda: engine.get_upagrahas())
    if not isinstance(u, dict) or not u:
        return ""
    kaala = [(k, v) for k, v in u.items() if v.get("family") == "kaala"]
    solar = [(k, v) for k, v in u.items() if v.get("family") == "solar"]
    lines = []
    if kaala:
        lines.append("From the parts of the day (the ascendant of each part):")
        for k, v in kaala:
            lines.append(f"  {k:13s} {v.get('rashi_name',''):12s} H{v.get('house','?'):<3} "
                         f"{round(v.get('degree_in_rashi', 0), 1):>5.1f}°  "
                         f"{v.get('nakshatra_name','')}")
    if solar:
        lines.append("From the Sun (shadow points):")
        for k, v in solar:
            lines.append(f"  {k:13s} {v.get('rashi_name',''):12s} H{v.get('house','?'):<3} "
                         f"{round(v.get('degree_in_rashi', 0), 1):>5.1f}°  "
                         f"{v.get('nakshatra_name','')}")
    # What each one MEANS, once, at the foot — the names alone are opaque even to
    # a model that knows the tradition, and the meaning is what makes the
    # placement usable in a reading.
    lines.append("")
    lines.append("Gulika/Maandi (Saturn's part): where the chart drags, delays, hardens; "
                 "the heaviest of these. Mrityu: abrupt endings. Kaala: what the hour "
                 "itself imposes. Ardhaprahara: dealings that go astray. Yamaghantaka: "
                 "counsel that comes too late. Dhuma: what stays obscured, grief that "
                 "does not clear. Vyatipata: reversal out of order. Parivesha: protection "
                 "that is also confinement. Indrachapa: promise that does not last. "
                 "Upaketu: loss of direction, the end of a matter.")
    return "\n".join(lines)


SECTION_MAP['mrityu_bhaga'] = ('MRITYU BHAGA', _build_mrityu_bhaga_sec)
SECTION_MAP['bhrigu_bindu'] = ('BHRIGU BINDU', _build_bhrigu_bindu_sec)
SECTION_MAP['pada_archetypes'] = ('108 PADA ARCHETYPES', _build_pada_archetypes)
SECTION_MAP['pancha_pakshi'] = ('PANCHA PAKSHI', _build_pancha_pakshi_sec)
SECTION_MAP['upagrahas'] = ('UPAGRAHAS (SUB-PLANETS)', _build_upagrahas_sec)
SECTION_MAP['graha_shanti'] = ('GRAHA SHANTI (COMPLETE)', _build_graha_shanti_sec)


# ── Lifestyle / today-dependent guidance (Vedic + numerology) ──
def _build_daily_guidance_sec(engine) -> str:
    try:
        from app.services.lifestyle import vedic
        return vedic.briefing(engine)
    except Exception:
        return ""

def _build_numerology_today_sec(engine) -> str:
    try:
        from app.services.lifestyle import numerology
        bd = {}
        d = getattr(engine, 'birth_dt', None)
        if d is not None:
            bd = {'day': d.day, 'month': d.month, 'year': d.year}
        return numerology.briefing(bd)
    except Exception:
        return ""

SECTION_MAP['daily_guidance'] = ('TODAY — DAILY GUIDANCE (wear / direction / windows)', _build_daily_guidance_sec)
SECTION_MAP['numerology_today'] = ('NUMEROLOGY TODAY (personal day / lucky number)', _build_numerology_today_sec)
