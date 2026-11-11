"""
BPHS CH.5 — SPECIAL LAGNAS

Hora Lagna: Wealth and sustenance indicator
Ghati Lagna: Power and authority indicator
Varnada Lagna: Dignity and social standing

Calculation per BPHS:
Hora Lagna = Birth time in ghatikas × 2.5 + Sun longitude
Ghati Lagna = Birth time in ghatikas × 5 + Sun longitude
"""

from typing import Dict
from ..core.constants import RASHI_NAMES, RASHI_LORDS
from ..core.utils import normalize_longitude, get_rashi_from_longitude


def calculate_hora_lagna(engine) -> Dict:
    """
    BPHS Ch.5: Hora Lagna for wealth determination.
    Hora Lagna = (birth ghatikas from sunrise × 30/2.5) + Sun longitude
    Simplified: each hora = ~1 hour. Count horas from sunrise, add to Sun.
    """
    # Get Sun longitude as base
    sun_long = engine.planets.get('Sun', {}).get('longitude', 0)
    
    # Approximate: birth hour from midnight, each hour = 1 hora = 30 degrees
    birth_dt = engine._birth_datetime if hasattr(engine, '_birth_datetime') else None
    if birth_dt:
        hours_from_midnight = birth_dt.hour + birth_dt.minute / 60
        hora_advance = hours_from_midnight * 30 / 2.5  # Each 2.5 hours = 30 degrees
        hora_long = normalize_longitude(sun_long + hora_advance)
    else:
        hora_long = sun_long
    
    hora_rashi = get_rashi_from_longitude(hora_long)
    hora_lord = RASHI_LORDS[hora_rashi]
    asc = engine.ascendant_rashi
    hora_house = (hora_rashi - asc) % 12 + 1
    
    return {
        'longitude': hora_long,
        'rashi': hora_rashi,
        'rashi_name': RASHI_NAMES[hora_rashi],
        'lord': hora_lord,
        'house': hora_house,
    }


def calculate_ghati_lagna(engine) -> Dict:
    """
    BPHS Ch.5: Ghati Lagna for power/authority.
    Ghati Lagna = (birth ghatikas × 30/5) + Sun longitude
    """
    sun_long = engine.planets.get('Sun', {}).get('longitude', 0)
    
    birth_dt = engine._birth_datetime if hasattr(engine, '_birth_datetime') else None
    if birth_dt:
        hours_from_midnight = birth_dt.hour + birth_dt.minute / 60
        ghati_advance = hours_from_midnight * 30 / 5  # Each 5 hours = 30 degrees
        ghati_long = normalize_longitude(sun_long + ghati_advance)
    else:
        ghati_long = sun_long
    
    ghati_rashi = get_rashi_from_longitude(ghati_long)
    ghati_lord = RASHI_LORDS[ghati_rashi]
    asc = engine.ascendant_rashi
    ghati_house = (ghati_rashi - asc) % 12 + 1
    
    return {
        'longitude': ghati_long,
        'rashi': ghati_rashi,
        'rashi_name': RASHI_NAMES[ghati_rashi],
        'lord': ghati_lord,
        'house': ghati_house,
    }


def get_special_lagna_effects(engine) -> Dict:
    """Get effects of special lagnas for the chart."""
    hora = calculate_hora_lagna(engine)
    ghati = calculate_ghati_lagna(engine)
    
    effects = {
        'hora_lagna': hora,
        'ghati_lagna': ghati,
        'wealth_indicator': f'Hora Lagna in {hora["rashi_name"]} (H{hora["house"]}) — lord {hora["lord"]} indicates wealth source',
        'power_indicator': f'Ghati Lagna in {ghati["rashi_name"]} (H{ghati["house"]}) — lord {ghati["lord"]} indicates power source',
    }
    
    return effects
