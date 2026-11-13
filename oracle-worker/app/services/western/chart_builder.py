"""
WESTERN ASTROLOGY — Chart Builder & Oracle Integration
Produces a Western-specific briefing for the Oracle LLM.
Western persona: psychological, empowering, growth-oriented. Focus on aspects and configurations.
"""

from datetime import datetime
from typing import Dict

WESTERN_PERSONA = """You are a Western astrologer — psychologically insightful, empowering, growth-oriented.
You speak in terms of aspects, configurations, elements, and houses. Your language is warm but modern.
You reference the Big Three (Sun, Moon, Rising), major aspects, and current transits.
You focus on self-awareness, potential, and choice — not fate. You see challenging aspects as growth opportunities.

When discussing timing, reference progressed Moon, solar return themes, or outer planet transits.
When discussing personality, lead with the Big Three and dominant element/modality.
When discussing relationships, reference Venus, Mars, and the 7th house.

4 to 6 insightful sentences. No bullet points. Just flowing psychological insight."""


WESTERN_METHOD_CATALOG = """AVAILABLE WESTERN METHODS (pick 3-6):

CHART:
1. get_western_chart — Full tropical chart with aspects, configurations
2. get_western_big_three — Sun/Moon/Rising signs
3. get_western_aspects — All natal aspects with orbs
4. get_western_configurations — Grand Trine, T-Square, Yod, Stellium
5. get_western_profile — Full personality profile

TIMING:
6. get_western_transits — Current outer planet transits to natal
7. get_western_progressions — Secondary progressed chart
8. get_western_solar_return(year) — Solar return chart for a year
9. get_western_solar_arc — Solar arc directions

EXTRAS:
10. get_western_lilith — Black Moon Lilith position
11. get_western_fortune — Part of Fortune
12. get_western_fixed_stars — Fixed star conjunctions
13. get_western_void_moon — Void of Course Moon check

COMPATIBILITY:
14. get_western_compatibility — Synastry with another chart"""


def build_western_chart(engine) -> str:
    """Build a Western-specific chart briefing for the Oracle."""
    if hasattr(engine, '_western_chart_text') and engine._western_chart_text:
        return engine._western_chart_text

    lines = []

    try:
        from .chart import WesternChart
        wc = WesternChart(engine.birth_dt, engine.latitude, engine.longitude)
        wc._ensure_calculated()

        big3 = wc.get_big_three()
        lines.append("WESTERN CHART (Tropical):")
        lines.append(f"Sun: {big3['sun_sign']} | Moon: {big3['moon_sign']} | Rising: {big3['rising_sign']}")
        lines.append(f"Midheaven: {big3['midheaven_sign']} | Chart Ruler: {big3['chart_ruler']} (H{big3['chart_ruler_house']})")

        # Planet positions
        lines.append("")
        for name in ['Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto']:
            p = wc.planets.get(name, {})
            retro = " R" if p.get('retrograde') else ""
            dignity = f" [{p.get('dignity')}]" if p.get('dignity') not in ('Peregrine', None) else ""
            lines.append(f"{name}: {p.get('sign', '')} H{p.get('house', '?')}{retro}{dignity}")

        # Element balance
        balance = wc.get_element_balance()
        lines.append(f"\nDominant: {balance['dominant_element']} element, {balance['dominant_modality']} mode")
        if balance['weak_element']:
            lines.append(f"Weak: {balance['weak_element']}")

        # Key aspects
        aspects = wc.get_aspects()
        if aspects:
            lines.append("\nKEY ASPECTS:")
            for a in aspects[:6]:
                lines.append(f"  {a['planet1']}-{a['planet2']}: {a['aspect']} ({a['orb']}° orb, {a['nature']})")

        # Configurations
        configs = wc.get_configurations()
        if configs:
            lines.append("\nCONFIGURATIONS:")
            for c in configs:
                lines.append(f"  {c['name']}: {', '.join(c.get('planets', []))}")

        # Nodes
        nn = wc.planets.get('North Node', {})
        if nn:
            lines.append(f"\nNorth Node: {nn.get('sign', '')} H{nn.get('house', '?')}")

    except Exception as e:
        lines.append(f"Western chart calculation error: {str(e)[:100]}")

    result = "\n".join(lines)
    engine._western_chart_text = result
    return result


def build_western_system_prompt(intent: Dict, briefing: str, user_message: str) -> str:
    """Build Western-specific Oracle prompt."""
    language = intent.get("language", "english")
    lang_note = f"\nRespond in {language}." if language.lower() not in ("english", "en") else ""
    today = datetime.now().strftime("%B %d, %Y")

    return f"""{WESTERN_PERSONA}

TODAY: {today}{lang_note}

{briefing}

Maximum 120 words. Reference specific aspects and configurations. End with one empowering insight."""
