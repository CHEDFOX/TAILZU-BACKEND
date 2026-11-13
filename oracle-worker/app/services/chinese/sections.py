"""CHINESE SECTION BUILDERS — raw data for each Chinese section."""

from app.services.oracle.section_errors import note_section_failure, vet_section
from datetime import datetime


def _get_bazi(engine):
    from .bazi import BaZiChart
    return BaZiChart(engine.birth_local)


def build_base_chart(engine) -> str:
    from .chart_builder import build_chinese_chart
    return build_chinese_chart(engine)


def build_four_pillars(engine) -> str:
    bc = _get_bazi(engine)
    pillars = bc.get_four_pillars()
    lines = []
    for p in ['year', 'month', 'day', 'hour']:
        pi = pillars[p]
        s = pi['stem']
        b = pi['branch']
        lines.append(f"{p.capitalize():6s}: {s['full']:12s} / {b['animal']:8s} ({b['full']})")
        if pi.get('hidden_stems'):
            lines.append(f"        Hidden: {', '.join(pi['hidden_stems'])}")
    return "\n".join(lines)


def build_day_master(engine) -> str:
    bc = _get_bazi(engine)
    dm = bc.get_day_master()
    return f"{dm['full_name']} ({dm['chinese']})\n{dm['description']}"


def build_elements(engine) -> str:
    bc = _get_bazi(engine)
    e = bc.get_element_balance()
    c = e['counts']
    lines = [
        f"Wood={c['Wood']} Fire={c['Fire']} Earth={c['Earth']} Metal={c['Metal']} Water={c['Water']}",
        f"Day Master: {e['day_master_element']} ({e['day_master_strength']})",
        f"Dominant: {e['dominant_element']} | Weakest: {e['weakest_element']}",
        f"Favorable: {e['favorable_element']} | Lucky color: {e['lucky_color']} | Direction: {e['lucky_direction']}",
    ]
    return "\n".join(lines)


def build_ten_gods(engine) -> str:
    bc = _get_bazi(engine)
    tg = bc.get_ten_gods()
    lines = []
    for p in ['year', 'month', 'day', 'hour']:
        lines.append(f"{p.capitalize():6s}: {tg.get(p, '')}")
    return "\n".join(lines)


def build_branch_interactions(engine) -> str:
    bc = _get_bazi(engine)
    from .interactions import BranchInteractions
    bi = BranchInteractions(bc).analyze_all()
    lines = []
    for clash in bi.get('clashes', []):
        lines.append(f"CLASH: {clash['branches']} ({clash['pillars'][0]}-{clash['pillars'][1]}) — {clash['meaning']}")
    for harm in bi.get('harmonies', []):
        lines.append(f"HARMONY: {harm['branches']} → {harm['transforms_to']} — {harm['meaning']}")
    for th in bi.get('three_harmonies', []):
        lines.append(f"THREE HARMONY: {th['branches']} → {th['element']} ({th['completeness']})")
    for pun in bi.get('punishments', []):
        lines.append(f"PUNISHMENT: {pun['branches']} — {pun['punishment']}: {pun['meaning']}")
    for h in bi.get('harms', []):
        lines.append(f"HARM: {h['branches']} — {h['meaning']}")
    if not lines:
        lines.append("No major branch interactions")
    summary = bi.get('summary', {}).get('overall', '')
    if summary:
        lines.append(f"Overall: {summary}")
    return "\n".join(lines)


def build_stem_interactions(engine) -> str:
    bc = _get_bazi(engine)
    from .interactions import StemInteractions
    si = StemInteractions(bc).analyze_all_stems()
    lines = []
    for sc in si.get('stem_clashes', []):
        lines.append(f"STEM CLASH: {sc['stems']} ({sc['pillars'][0]}-{sc['pillars'][1]}) — {sc['meaning']}")
    for combo in si.get('stem_combinations', []):
        lines.append(f"STEM COMBO: {combo['stems']} → {combo['transforms_to']} — {combo['meaning']}")
    eb = si.get('empty_branches', {})
    if eb.get('has_void'):
        for a in eb.get('affected_pillars', []):
            lines.append(f"VOID: {a['pillar']} pillar ({a['animal']}) — {a['meaning']}")
    if not lines:
        lines.append("No stem clashes or combinations")
    return "\n".join(lines)


def build_symbolic_stars(engine) -> str:
    bc = _get_bazi(engine)
    from .stars import SymbolicStars
    ss = SymbolicStars(bc).analyze_all_stars()
    lines = []
    for name, data in ss.items():
        if data.get('present'):
            locs = ", ".join(l.get('pillar', '') for l in data.get('locations', []))
            lines.append(f"★ {data.get('star', name)}: {locs} — {data.get('interpretation', '')[:80]}")
    absent = [data.get('star', name) for name, data in ss.items() if not data.get('present')]
    if absent:
        lines.append(f"Not present: {', '.join(absent)}")
    return "\n".join(lines)


def build_luck_periods(engine, extras: dict = None) -> str:
    bc = _get_bazi(engine)
    gender = (extras or {}).get('gender', 'male')
    periods = bc.get_luck_periods(8, gender)
    lines = [f"Direction: {'forward' if gender else 'forward'} ({gender})"]
    for p in periods:
        lines.append(f"Age {p['start_age']:2d}-{p['end_age']:2d}: {p['element']:14s} {p['animal']:8s} ({p['pillar']})")
    return "\n".join(lines)


def build_annual_luck(engine, year: int = None) -> str:
    bc = _get_bazi(engine)
    from .stars import AnnualLuck
    al = AnnualLuck(bc)
    if year:
        r = al.analyze_year(year)
        lines = [f"{year}: {r['element']} {r['animal']} — {r['outlook']} (score {r['score']})"]
        lines.append(f"Relation: {r['element_relation']}")
        if r.get('clashes'):
            lines.append(f"Clashes: {', '.join(r['clashes'])}")
        if r.get('harmonies'):
            lines.append(f"Harmonies: {', '.join(r['harmonies'])}")
        return "\n".join(lines)
    else:
        forecast = al.forecast_years(5)
        lines = []
        for r in forecast:
            lines.append(f"{r['year']}: {r['element']:5s} {r['animal']:8s} — {r['outlook']:12s} (score {r['score']})")
        return "\n".join(lines)


def build_compatibility(engine) -> str:
    return "Compatibility requires partner data"


def build_empty_branches(engine) -> str:
    bc = _get_bazi(engine)
    from .interactions import StemInteractions
    si = StemInteractions(bc)
    eb = si.check_empty_branches()
    lines = [f"Empty branches: {', '.join(eb.get('empty_branches', []))}"]
    for a in eb.get('affected_pillars', []):
        lines.append(f"  {a['pillar']}: {a['meaning']}")
    lines.append(eb.get('interpretation', ''))
    return "\n".join(lines)


SECTION_MAP = {
    'four_pillars': ('FOUR PILLARS', build_four_pillars),
    'day_master': ('DAY MASTER', build_day_master),
    'elements': ('FIVE ELEMENTS', build_elements),
    'ten_gods': ('TEN GODS', build_ten_gods),
    'branch_interactions': ('BRANCH INTERACTIONS', build_branch_interactions),
    'stem_interactions': ('STEM INTERACTIONS', build_stem_interactions),
    'symbolic_stars': ('SYMBOLIC STARS', build_symbolic_stars),
    'luck_periods': ('LUCK PERIODS (DA YUN)', build_luck_periods),
    'annual_luck': ('ANNUAL LUCK', build_annual_luck),
    'compatibility': ('COMPATIBILITY', build_compatibility),
    'empty_branches': ('EMPTY BRANCHES', build_empty_branches),
    'na_yin': ('NA YIN (纳音)', lambda e: _build_na_yin(e)),
    'life_stages': ('12 LIFE STAGES (长生)', lambda e: _build_life_stages(e)),
    'yong_shen': ('YONG SHEN (用神)', lambda e: _build_yong_shen(e)),
    'extended_stars': ('EXTENDED STARS (30+)', lambda e: _build_ext_stars(e)),
    'fan_fu_yin': ('FAN YIN / FU YIN', lambda e: _build_fan_fu(e)),
}


def _build_na_yin(engine) -> str:
    result = engine.get_chinese_na_yin()
    lines = []
    for p in ['year', 'month', 'day', 'hour']:
        d = result.get(p, {})
        lines.append(f"  {p.capitalize()}: {d.get('na_yin', '')} ({d.get('element', '')})")
    return "\n".join(lines)

def _build_life_stages(engine) -> str:
    result = engine.get_chinese_life_stages()
    lines = [f"Day Stem: {result.get('day_stem', '')} ({result.get('direction', '')})"]
    for name, data in list(result.get('stages', {}).items())[:12]:
        lines.append(f"  {data.get('stage', '')}: {data.get('branch', '')} — {data.get('meaning', '')[:60]}")
    return "\n".join(lines)

def _build_yong_shen(engine) -> str:
    result = engine.get_chinese_yong_shen()
    lines = [
        f"Yong Shen (用神): {result.get('yong_shen', '')} — {result.get('yong_meaning', '')}",
        f"Xi Shen (喜神): {result.get('xi_shen', '')} — {result.get('xi_meaning', '')}",
        f"Ji Shen (忌神): {result.get('ji_shen', '')} — {result.get('ji_meaning', '')}",
    ]
    return "\n".join(lines)

def _build_ext_stars(engine) -> str:
    result = engine.get_chinese_extended_stars()
    stars = result.get('stars', {})
    lines = []
    for name, data in stars.items():
        if data.get('present'):
            lines.append(f"  ★ {data.get('name', '')}: {data.get('meaning', '')[:60]}")
    absent = [data.get('name', '') for data in stars.values() if not data.get('present')]
    if absent:
        lines.append(f"  Not present: {', '.join(absent[:5])}")
    return "\n".join(lines)

def _build_fan_fu(engine) -> str:
    result = engine.get_chinese_fan_fu_yin()
    lines = []
    for fy in result.get('fan_yin', []):
        lines.append(f"  Fan Yin: {fy.get('pillars', [])} — {fy.get('meaning', '')}")
    for fu in result.get('fu_yin', []):
        lines.append(f"  Fu Yin: {fu.get('pillars', [])} — {fu.get('meaning', '')}")
    return "\n".join(lines) if lines else "No Fan Yin or Fu Yin patterns"


def build_sections(engine, section_names: list, topic: str = None, extras: dict = None) -> str:
    extras = extras or {}
    parts = []
    for name in section_names:
        entry = SECTION_MAP.get(name)
        if not entry:
            continue
        label, builder = entry
        try:
            if name == 'luck_periods':
                text = builder(engine, extras)
            elif name == 'annual_luck':
                text = builder(engine)
            else:
                text = builder(engine)
            text = vet_section('chinese', name, text)
            if text and text.strip():
                parts.append(f"{label}:\n{text}")
        except Exception as _e:
            # Do not swallow this. A dropped section leaves the responder
            # believing it has data it was never given, and it writes anyway.
            note_section_failure('chinese', name, _e)
            continue
    return "\n\n".join(parts)

# ═══ NEW CHINESE SECTIONS ═══
def _build_dayun_onset(engine) -> str:
    r = engine.get_chinese_dayun_onset()
    return f"Da Yun onset: age {r.get('onset_age','')} ({r.get('onset_years','')} years {r.get('onset_months','')} months) | Direction: {r.get('direction','')}" if isinstance(r, dict) else ""

def _build_xiao_yun(engine) -> str:
    r = engine.get_chinese_xiao_yun()
    return "\n".join(f"  Age {p.get('age','')}: {p.get('animal','')} ({p.get('element','')})" for p in (r if isinstance(r, list) else []))

def _build_pillar_overlay(engine) -> str:
    r = engine.get_chinese_pillar_overlay()
    if isinstance(r, dict):
        lines = [f"Month: {r.get('current_month','')} — {r.get('month_outlook','')}",
                 f"Day: {r.get('current_day','')} — {r.get('day_outlook','')}"]
        if r.get('month_clashes'): lines.append(f"Month clashes: {', '.join(r['month_clashes'])}")
        if r.get('day_harmonies'): lines.append(f"Day harmonies: {', '.join(r['day_harmonies'])}")
        return "\n".join(lines)
    return ""

def _build_hidden_strength(engine) -> str:
    r = engine.get_chinese_hidden_strength()
    lines = []
    for p, stems in (r if isinstance(r, dict) else {}).items():
        if isinstance(stems, list):
            parts = [f"{s.get('stem','')}({s.get('strength_pct','')}%)" for s in stems]
            lines.append(f"  {p.capitalize()}: {', '.join(parts)}")
    return "\n".join(lines)

def _build_gods_matrix(engine) -> str:
    r = engine.get_chinese_gods_matrix()
    return "\n".join(f"  {i.get('god1','')} ↔ {i.get('god2','')}: {i.get('interaction','')}" for i in (r if isinstance(r, list) else []))

def _build_date_selection(engine) -> str:
    r = engine.get_chinese_date_selection()
    lines = []
    for d in (r if isinstance(r, list) else [])[:5]:
        if isinstance(d, dict):
            lines.append(f"  {d.get('date','')} ({d.get('day','')}) {d.get('animal','')} {d.get('element','')}: score {d.get('score','')}")
    return "\n".join(lines) if lines else "No dates analyzed"

def _build_feng_shui(engine) -> str:
    r = engine.get_chinese_feng_shui()
    if isinstance(r, dict):
        return f"Group: {r.get('group','')} | Best sleep: {r.get('best_sleeping','')} | Best work: {r.get('best_working','')} | Avoid: {r.get('avoid','')}"
    return ""

def _build_chinese_medical(engine) -> str:
    r = engine.get_chinese_medical()
    lines = []
    if isinstance(r, dict):
        for v in r.get('vulnerabilities', []):
            if isinstance(v, dict):
                lines.append(f"  {v.get('risk','')} | Remedy: {v.get('remedy','')[:60]}")
        if r.get('dietary_advice'):
            lines.append(f"Diet: {r['dietary_advice']}")
    return "\n".join(lines)

def _zw(engine):
    from .ziwei import ZiWeiChart
    return ZiWeiChart(engine.birth_local, getattr(engine, 'gender', None) or 'male')


def _build_zi_wei(engine) -> str:
    """The whole chart, not a summary. Zi Wei is read palace by palace — an answer built
    from four of the twelve is guessing about the other eight."""
    c = _zw(engine)
    r = c.generate_report()
    ld, bu = r['lunar_date'], r['bureau']
    lines = [
        f"{ld['label']} · year {ld['year_pillar']} ({ld['animal']})",
        f"Bureau: {bu['chinese']} ({bu['element']} {bu['number']}) — {bu['meaning']}",
        f"Body palace: {r['body_palace']} | limits run "
        f"{'forward' if r['decades_forward'] else 'backward'}",
        "",
        "PALACES (star brightness in brackets — 廟 best, 陷 fallen):",
    ]
    lines.extend("  " + p.summary() for p in
                 sorted(c.palaces, key=lambda x: (x.index - c.life_index) % 12))
    lines.append("")
    lines.append("FOUR TRANSFORMATIONS:")
    for name, d in r['transformations'].items():
        lines.append(f"  {name}: {d['star']} in {d['palace']} — {d['meaning']}")
    lines.append("")
    lines.append(f"School: {r['school']}")
    return "\n".join(lines)


def _build_zi_wei_timing(engine) -> str:
    """大限 and 流年 — the ten-year limits and the current annual palace."""
    import datetime
    c = _zw(engine)
    c._build()
    born = engine.birth_local.year
    now = datetime.datetime.now().year
    age = now - born
    lines = ["TEN-YEAR LIMITS (大限):"]
    for p in sorted(c.palaces, key=lambda x: x.decade['order']):
        d = p.decade
        mark = "  <-- current" if d['from_age'] <= age <= d['to_age'] else ""
        stars = ', '.join(s['name'] for s in p.major) or 'empty (read its opposite)'
        lines.append(f"  {d['from_age']:>3}-{d['to_age']:<3} {p.name:9s} [{p.stem}{p.branch}] {stars}{mark}")
    cur = c.decade_at(age)
    if cur:
        opp = c.opposite(cur)
        lines.append("")
        lines.append(f"Current limit: {cur.name} — {cur.meaning}")
        if cur.empty:
            lines.append(f"  Empty, so it is read through {opp.name}: "
                         f"{', '.join(s['name'] for s in opp.major) or 'also empty'}")
    ann = c.annual_palace(now)
    lines.append("")
    lines.append(f"Annual palace {now} (流年): {ann.name} [{ann.stem}{ann.branch}] "
                 f"{', '.join(s['name'] for s in ann.major) or 'empty'}")
    return "\n".join(lines)


SECTION_MAP['dayun_onset'] = ('DA YUN ONSET AGE', _build_dayun_onset)
SECTION_MAP['xiao_yun'] = ('XIAO YUN (SMALL LUCK)', _build_xiao_yun)
SECTION_MAP['pillar_overlay'] = ('CURRENT PILLAR OVERLAY', _build_pillar_overlay)
SECTION_MAP['hidden_strength'] = ('HIDDEN STEMS (STRENGTH %)', _build_hidden_strength)
SECTION_MAP['gods_matrix'] = ('10 GODS INTERACTION', _build_gods_matrix)
SECTION_MAP['date_selection'] = ('DATE SELECTION', _build_date_selection)
SECTION_MAP['feng_shui'] = ('FENG SHUI DIRECTIONS', _build_feng_shui)
SECTION_MAP['chinese_medical'] = ('CHINESE MEDICAL (TCM)', _build_chinese_medical)
SECTION_MAP['zi_wei'] = ('ZI WEI DOU SHU', _build_zi_wei)
SECTION_MAP['zi_wei_timing'] = ('ZI WEI LIMITS (大限/流年)', _build_zi_wei_timing)

# ═══════════════════════════════════════════════════════
# NEW SECTIONS: Stems/Branches, Loshu, Bagua, Yin-Yang, Lunar Calendar
# Append this entire block to the end of sections.py
# ═══════════════════════════════════════════════════════

STEM_DATA = {
    '甲': {'name': 'Jia', 'element': 'Wood', 'yin_yang': 'Yang', 'meaning': 'Tall tree, pioneer, leader. Growth, ambition, benevolence.', 'body': 'Head, liver, gallbladder', 'color': 'Green'},
    '乙': {'name': 'Yi', 'element': 'Wood', 'yin_yang': 'Yin', 'meaning': 'Grass, vine, flexible. Gentle, artistic, adaptive.', 'body': 'Neck, liver', 'color': 'Light green'},
    '丙': {'name': 'Bing', 'element': 'Fire', 'yin_yang': 'Yang', 'meaning': 'Sun, radiance. Passionate, generous, impatient.', 'body': 'Shoulders, heart, small intestine', 'color': 'Red'},
    '丁': {'name': 'Ding', 'element': 'Fire', 'yin_yang': 'Yin', 'meaning': 'Candle, starlight. Warm, perceptive, detail-oriented.', 'body': 'Heart, eyes', 'color': 'Pink'},
    '戊': {'name': 'Wu', 'element': 'Earth', 'yin_yang': 'Yang', 'meaning': 'Mountain, fortress. Stable, reliable, stubborn.', 'body': 'Nose, stomach, spleen', 'color': 'Brown'},
    '己': {'name': 'Ji', 'element': 'Earth', 'yin_yang': 'Yin', 'meaning': 'Garden soil, farmland. Nurturing, meticulous, worrying.', 'body': 'Skin, stomach', 'color': 'Yellow'},
    '庚': {'name': 'Geng', 'element': 'Metal', 'yin_yang': 'Yang', 'meaning': 'Sword, axe. Decisive, righteous, confrontational.', 'body': 'Chest, lungs, large intestine', 'color': 'White'},
    '辛': {'name': 'Xin', 'element': 'Metal', 'yin_yang': 'Yin', 'meaning': 'Jewelry, needle. Refined, sensitive, perfectionist.', 'body': 'Lungs, teeth', 'color': 'Silver'},
    '壬': {'name': 'Ren', 'element': 'Water', 'yin_yang': 'Yang', 'meaning': 'Ocean, river. Resourceful, restless, philosophical.', 'body': 'Legs, kidneys, bladder', 'color': 'Black'},
    '癸': {'name': 'Gui', 'element': 'Water', 'yin_yang': 'Yin', 'meaning': 'Rain, dew. Intuitive, imaginative, secretive.', 'body': 'Feet, kidneys', 'color': 'Dark blue'},
}

BRANCH_DATA = {
    '子': {'name': 'Zi', 'animal': 'Rat', 'element': 'Water', 'yin_yang': 'Yang', 'hours': '23:00-01:00', 'month': 'December', 'direction': 'North', 'season': 'Mid-Winter', 'meaning': 'Clever, resourceful, ambitious. The initiator.'},
    '丑': {'name': 'Chou', 'animal': 'Ox', 'element': 'Earth', 'yin_yang': 'Yin', 'hours': '01:00-03:00', 'month': 'January', 'direction': 'NNE', 'season': 'Late Winter', 'meaning': 'Patient, dependable, methodical. The builder.'},
    '寅': {'name': 'Yin', 'animal': 'Tiger', 'element': 'Wood', 'yin_yang': 'Yang', 'hours': '03:00-05:00', 'month': 'February', 'direction': 'ENE', 'season': 'Early Spring', 'meaning': 'Bold, competitive, restless. The warrior.'},
    '卯': {'name': 'Mao', 'animal': 'Rabbit', 'element': 'Wood', 'yin_yang': 'Yin', 'hours': '05:00-07:00', 'month': 'March', 'direction': 'East', 'season': 'Mid-Spring', 'meaning': 'Gentle, diplomatic, artistic. The peacemaker.'},
    '辰': {'name': 'Chen', 'animal': 'Dragon', 'element': 'Earth', 'yin_yang': 'Yang', 'hours': '07:00-09:00', 'month': 'April', 'direction': 'ESE', 'season': 'Late Spring', 'meaning': 'Charismatic, powerful, unpredictable. The transformer.'},
    '巳': {'name': 'Si', 'animal': 'Snake', 'element': 'Fire', 'yin_yang': 'Yin', 'hours': '09:00-11:00', 'month': 'May', 'direction': 'SSE', 'season': 'Early Summer', 'meaning': 'Wise, intuitive, secretive. The strategist.'},
    '午': {'name': 'Wu', 'animal': 'Horse', 'element': 'Fire', 'yin_yang': 'Yang', 'hours': '11:00-13:00', 'month': 'June', 'direction': 'South', 'season': 'Mid-Summer', 'meaning': 'Free-spirited, passionate, impatient. The adventurer.'},
    '未': {'name': 'Wei', 'animal': 'Goat', 'element': 'Earth', 'yin_yang': 'Yin', 'hours': '13:00-15:00', 'month': 'July', 'direction': 'SSW', 'season': 'Late Summer', 'meaning': 'Creative, compassionate, indecisive. The artist.'},
    '申': {'name': 'Shen', 'animal': 'Monkey', 'element': 'Metal', 'yin_yang': 'Yang', 'hours': '15:00-17:00', 'month': 'August', 'direction': 'WSW', 'season': 'Early Autumn', 'meaning': 'Quick-witted, versatile, mischievous. The inventor.'},
    '酉': {'name': 'You', 'animal': 'Rooster', 'element': 'Metal', 'yin_yang': 'Yin', 'hours': '17:00-19:00', 'month': 'September', 'direction': 'West', 'season': 'Mid-Autumn', 'meaning': 'Precise, proud, observant. The perfectionist.'},
    '戌': {'name': 'Xu', 'animal': 'Dog', 'element': 'Earth', 'yin_yang': 'Yang', 'hours': '19:00-21:00', 'month': 'October', 'direction': 'WNW', 'season': 'Late Autumn', 'meaning': 'Loyal, honest, protective. The guardian.'},
    '亥': {'name': 'Hai', 'animal': 'Pig', 'element': 'Water', 'yin_yang': 'Yin', 'hours': '21:00-23:00', 'month': 'November', 'direction': 'NNW', 'season': 'Early Winter', 'meaning': 'Generous, sincere, indulgent. The optimist.'},
}

LOSHU_MEANINGS = {
    1: {'name': 'Career', 'element': 'Water', 'direction': 'North', 'trait': 'Communication, independence, drive'},
    2: {'name': 'Relationships', 'element': 'Earth', 'direction': 'Southwest', 'trait': 'Sensitivity, cooperation, intuition'},
    3: {'name': 'Family', 'element': 'Wood', 'direction': 'East', 'trait': 'Creativity, expression, optimism'},
    4: {'name': 'Wealth', 'element': 'Wood', 'direction': 'Southeast', 'trait': 'Order, stability, hard work'},
    5: {'name': 'Center', 'element': 'Earth', 'direction': 'Center', 'trait': 'Balance, freedom, adaptability'},
    6: {'name': 'Mentors', 'element': 'Metal', 'direction': 'Northwest', 'trait': 'Responsibility, domestic, love'},
    7: {'name': 'Children', 'element': 'Metal', 'direction': 'West', 'trait': 'Spirituality, analysis, wisdom'},
    8: {'name': 'Knowledge', 'element': 'Earth', 'direction': 'Northeast', 'trait': 'Material success, power, ambition'},
    9: {'name': 'Fame', 'element': 'Fire', 'direction': 'South', 'trait': 'Idealism, ambition, humanitarianism'},
}

LOSHU_POSITIONS = {4: (0,0), 9: (0,1), 2: (0,2), 3: (1,0), 5: (1,1), 7: (1,2), 8: (2,0), 1: (2,1), 6: (2,2)}

TRIGRAMS = {
    'qian':  {'chinese': '乾', 'name': 'Qian (Heaven)', 'element': 'Metal', 'direction': 'NW', 'family': 'Father', 'body': 'Head', 'trait': 'Creative, strong, leading', 'season': 'Late Autumn', 'number': 6, 'lines': '☰'},
    'kun':   {'chinese': '坤', 'name': 'Kun (Earth)', 'element': 'Earth', 'direction': 'SW', 'family': 'Mother', 'body': 'Abdomen', 'trait': 'Receptive, nurturing, devoted', 'season': 'Late Summer', 'number': 2, 'lines': '☷'},
    'zhen':  {'chinese': '震', 'name': 'Zhen (Thunder)', 'element': 'Wood', 'direction': 'E', 'family': 'Eldest Son', 'body': 'Feet', 'trait': 'Arousing, initiative, decisive', 'season': 'Spring', 'number': 3, 'lines': '☳'},
    'xun':   {'chinese': '巽', 'name': 'Xun (Wind)', 'element': 'Wood', 'direction': 'SE', 'family': 'Eldest Daughter', 'body': 'Thighs', 'trait': 'Gentle, penetrating, persistent', 'season': 'Late Spring', 'number': 4, 'lines': '☴'},
    'kan':   {'chinese': '坎', 'name': 'Kan (Water)', 'element': 'Water', 'direction': 'N', 'family': 'Middle Son', 'body': 'Ears', 'trait': 'Abysmal, deep, dangerous, wise', 'season': 'Winter', 'number': 1, 'lines': '☵'},
    'li':    {'chinese': '離', 'name': 'Li (Fire)', 'element': 'Fire', 'direction': 'S', 'family': 'Middle Daughter', 'body': 'Eyes', 'trait': 'Clinging, bright, illuminating', 'season': 'Summer', 'number': 9, 'lines': '☲'},
    'gen':   {'chinese': '艮', 'name': 'Gen (Mountain)', 'element': 'Earth', 'direction': 'NE', 'family': 'Youngest Son', 'body': 'Hands', 'trait': 'Still, meditative, stubborn', 'season': 'Late Winter', 'number': 8, 'lines': '☶'},
    'dui':   {'chinese': '兌', 'name': 'Dui (Lake)', 'element': 'Metal', 'direction': 'W', 'family': 'Youngest Daughter', 'body': 'Mouth', 'trait': 'Joyous, open, expressive', 'season': 'Autumn', 'number': 7, 'lines': '☱'},
}

ELEMENT_TO_TRIGRAM = {
    'Wood': ['zhen', 'xun'], 'Fire': ['li'], 'Earth': ['kun', 'gen'], 'Metal': ['qian', 'dui'], 'Water': ['kan'],
}

BAGUA_LIFE_AREAS = {
    'kan': 'Career & Life Path', 'kun': 'Love & Relationships', 'zhen': 'Family & Health',
    'xun': 'Wealth & Abundance', 'li': 'Fame & Reputation', 'qian': 'Mentors & Travel',
    'dui': 'Children & Creativity', 'gen': 'Knowledge & Wisdom',
}

HEAVENLY_STEMS_CYCLE = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸']
EARTHLY_BRANCHES_CYCLE = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥']
ANIMALS_CYCLE = ['Rat', 'Ox', 'Tiger', 'Rabbit', 'Dragon', 'Snake', 'Horse', 'Goat', 'Monkey', 'Rooster', 'Dog', 'Pig']


def _build_stems_branches(engine) -> str:
    bc = _get_bazi(engine)
    pillars = bc.get_four_pillars()
    lines = ["YOUR HEAVENLY STEMS:"]
    for p in ['year', 'month', 'day', 'hour']:
        pi = pillars[p]
        ch = pi['stem'].get('chinese', pi['stem'].get('full', ''))
        sd = STEM_DATA.get(ch, {})
        if sd:
            lines.append(f"  {p.capitalize()} Stem: {ch} ({sd['name']}) | {sd['element']} {sd['yin_yang']}")
            lines.append(f"    Nature: {sd['meaning']}")
            lines.append(f"    Body: {sd['body']} | Color: {sd['color']}")
        else:
            lines.append(f"  {p.capitalize()} Stem: {pi['stem'].get('full', ch)}")
    lines.append("")
    lines.append("YOUR EARTHLY BRANCHES:")
    for p in ['year', 'month', 'day', 'hour']:
        pi = pillars[p]
        ch = pi['branch'].get('chinese', pi['branch'].get('full', ''))
        bd = BRANCH_DATA.get(ch, {})
        if bd:
            lines.append(f"  {p.capitalize()} Branch: {ch} ({bd['name']}) | {bd['animal']} / {bd['element']} {bd['yin_yang']}")
            lines.append(f"    Hours: {bd['hours']} | Month: {bd['month']} | Direction: {bd['direction']}")
            lines.append(f"    Nature: {bd['meaning']}")
        else:
            lines.append(f"  {p.capitalize()} Branch: {pi['branch'].get('full', ch)} ({pi['branch'].get('animal', '')})")
        if pi.get('hidden_stems'):
            lines.append(f"    Hidden stems: {', '.join(pi['hidden_stems'])}")
    dm = bc.get_day_master()
    lines.append("")
    lines.append(f"Day Master: {dm.get('full_name', '')} ({dm.get('chinese', '')})")
    lines.append(f"  {dm.get('description', '')}")
    return "\n".join(lines)


def _build_loshu(engine) -> str:
    dt = engine.birth_local
    digits = []
    for ch in str(dt.day) + str(dt.month) + str(dt.year):
        if ch.isdigit() and int(ch) > 0:
            digits.append(int(ch))
    counts = {i: 0 for i in range(1, 10)}
    for d in digits:
        counts[d] += 1

    lines = ["BIRTH DATE DIGITS: " + ", ".join(str(d) for d in digits)]
    lines.append("")
    grid = [[' ', ' ', ' '], [' ', ' ', ' '], [' ', ' ', ' ']]
    for num, (r, c) in LOSHU_POSITIONS.items():
        grid[r][c] = str(num) * counts[num] if counts[num] > 0 else '.'

    lines.append("LO SHU GRID:")
    for row in grid:
        lines.append(f"  | {row[0]:^3s} | {row[1]:^3s} | {row[2]:^3s} |")
    lines.append("")

    lines.append("PRESENT NUMBERS:")
    for n in range(1, 10):
        if counts[n] > 0:
            m = LOSHU_MEANINGS[n]
            lines.append(f"  {n} ({m['name']}, {m['element']}, {m['direction']}): {m['trait']} [count={counts[n]}]")

    absent = [n for n in range(1, 10) if counts[n] == 0]
    if absent:
        lines.append("")
        lines.append("MISSING NUMBERS (karmic lessons):")
        for n in absent:
            m = LOSHU_MEANINGS[n]
            lines.append(f"  {n} ({m['name']}, {m['element']}): {m['trait']} — needs conscious development")

    arrows = []
    if all(counts[n] > 0 for n in [4, 9, 2]): arrows.append("Intellectual Arrow (4-9-2): strong mind")
    if all(counts[n] > 0 for n in [3, 5, 7]): arrows.append("Spiritual Arrow (3-5-7): inner strength")
    if all(counts[n] > 0 for n in [8, 1, 6]): arrows.append("Practical Arrow (8-1-6): action oriented")
    if all(counts[n] > 0 for n in [4, 3, 8]): arrows.append("Planning Arrow (4-3-8): organized")
    if all(counts[n] > 0 for n in [9, 5, 1]): arrows.append("Will Arrow (9-5-1): determination")
    if all(counts[n] > 0 for n in [2, 7, 6]): arrows.append("Action Arrow (2-7-6): manifesting")
    if all(counts[n] > 0 for n in [4, 5, 6]): arrows.append("Compassion Arrow (4-5-6): empathy")
    if all(counts[n] > 0 for n in [2, 5, 8]): arrows.append("Determination Arrow (2-5-8): persistence")
    if arrows:
        lines.append("")
        lines.append("ARROWS OF STRENGTH:")
        for a in arrows: lines.append(f"  -> {a}")

    missing_arrows = []
    if all(counts[n] == 0 for n in [4, 9, 2]): missing_arrows.append("Arrow of Confusion (no 4-9-2)")
    if all(counts[n] == 0 for n in [3, 5, 7]): missing_arrows.append("Arrow of Disappointment (no 3-5-7)")
    if all(counts[n] == 0 for n in [8, 1, 6]): missing_arrows.append("Arrow of Frustration (no 8-1-6)")
    if missing_arrows:
        lines.append("")
        lines.append("ARROWS OF WEAKNESS:")
        for a in missing_arrows: lines.append(f"  !! {a}")

    return "\n".join(lines)


def _build_bagua(engine) -> str:
    bc = _get_bazi(engine)
    el = bc.get_element_balance()
    dm_element = el.get('day_master_element', '')
    dominant = el.get('dominant_element', '')
    weakest = el.get('weakest_element', '')
    favorable = el.get('favorable_element', '')

    lines = ["THE EIGHT TRIGRAMS:"]
    lines.append("")
    for key, t in TRIGRAMS.items():
        lines.append(f"  {t['lines']} {t['chinese']} {t['name']} | {t['element']} | {t['direction']} | {t['family']}")
        lines.append(f"     Life area: {BAGUA_LIFE_AREAS.get(key, '')} | Body: {t['body']}")
        lines.append(f"     Quality: {t['trait']}")
    lines.append("")

    lines.append("YOUR BAGUA PROFILE:")
    for label, elem in [('Day Master', dm_element), ('Dominant', dominant), ('Weakest', weakest), ('Favorable', favorable)]:
        trigs = ELEMENT_TO_TRIGRAM.get(elem, [])
        if trigs:
            t = TRIGRAMS[trigs[0]]
            area = BAGUA_LIFE_AREAS.get(trigs[0], '')
            lines.append(f"  {label} ({elem}): {t['lines']} {t['name']} — {area}")
    return "\n".join(lines)


def _build_yin_yang(engine) -> str:
    bc = _get_bazi(engine)
    pillars = bc.get_four_pillars()
    yin_count = 0
    yang_count = 0
    yin_items = []
    yang_items = []

    for p in ['year', 'month', 'day', 'hour']:
        pi = pillars[p]
        stem_ch = pi['stem'].get('chinese', '')
        branch_ch = pi['branch'].get('chinese', '')
        sd = STEM_DATA.get(stem_ch, {})
        bd = BRANCH_DATA.get(branch_ch, {})
        if sd.get('yin_yang') == 'Yin':
            yin_count += 1; yin_items.append(f"{p} stem ({stem_ch})")
        elif sd.get('yin_yang') == 'Yang':
            yang_count += 1; yang_items.append(f"{p} stem ({stem_ch})")
        if bd.get('yin_yang') == 'Yin':
            yin_count += 1; yin_items.append(f"{p} branch ({branch_ch})")
        elif bd.get('yin_yang') == 'Yang':
            yang_count += 1; yang_items.append(f"{p} branch ({branch_ch})")

    total = yin_count + yang_count
    yin_pct = round(yin_count / total * 100) if total else 50
    yang_pct = 100 - yin_pct

    lines = [f"Yang: {yang_count}/{total} ({yang_pct}%) | Yin: {yin_count}/{total} ({yin_pct}%)"]
    lines.append("")

    if yang_pct > 65:
        lines.append("Balance: STRONGLY YANG — Active, outward, assertive energy dominates. Risk: burnout, aggression.")
    elif yang_pct > 55:
        lines.append("Balance: SLIGHTLY YANG — Active energy leads with enough receptivity.")
    elif yin_pct > 65:
        lines.append("Balance: STRONGLY YIN — Receptive, reflective energy dominates. Risk: passivity, overthinking.")
    elif yin_pct > 55:
        lines.append("Balance: SLIGHTLY YIN — Receptive energy leads with enough drive.")
    else:
        lines.append("Balance: BALANCED — Rare equilibrium between action and reflection.")

    lines.append("")
    lines.append("YANG: " + ", ".join(yang_items))
    lines.append("YIN: " + ", ".join(yin_items))

    dm = bc.get_day_master()
    dm_ch = dm.get('chinese', '')
    dm_sd = STEM_DATA.get(dm_ch, {})
    if dm_sd:
        lines.append("")
        pol = dm_sd['yin_yang']
        lines.append(f"Day Master polarity: {pol}")
        if pol == 'Yang':
            lines.append("  Core self is active and outward-moving. You express, lead, and project.")
        else:
            lines.append("  Core self is receptive and inward-moving. You absorb, adapt, and refine.")
    return "\n".join(lines)


def _year_stem_branch(year):
    si = (year - 4) % 10
    bi = (year - 4) % 12
    return HEAVENLY_STEMS_CYCLE[si], EARTHLY_BRANCHES_CYCLE[bi], ANIMALS_CYCLE[bi]

def _build_lunar_calendar(engine) -> str:
    dt = engine.birth_local
    now = datetime.now()
    stem_elements = {'甲': 'Wood', '乙': 'Wood', '丙': 'Fire', '丁': 'Fire', '戊': 'Earth', '己': 'Earth', '庚': 'Metal', '辛': 'Metal', '壬': 'Water', '癸': 'Water'}

    bs, bb, ba = _year_stem_branch(dt.year)
    ns, nb, na = _year_stem_branch(now.year)
    be = stem_elements.get(bs, '')
    ne = stem_elements.get(ns, '')
    bc_pos = ((dt.year - 4) % 60) + 1
    nc_pos = ((now.year - 4) % 60) + 1

    lines = [f"BIRTH YEAR: {dt.year} — {bs}{bb} ({STEM_DATA.get(bs,{}).get('name','')}-{BRANCH_DATA.get(bb,{}).get('name','')}) {be} {ba}"]
    lines.append(f"  Sexagenary cycle: {bc_pos}/60")
    lines.append("")
    lines.append(f"CURRENT YEAR: {now.year} — {ns}{nb} ({STEM_DATA.get(ns,{}).get('name','')}-{BRANCH_DATA.get(nb,{}).get('name','')}) {ne} {na}")
    lines.append(f"  Sexagenary cycle: {nc_pos}/60")
    lines.append("")

    bbi = EARTHLY_BRANCHES_CYCLE.index(bb)
    nbi = EARTHLY_BRANCHES_CYCLE.index(nb)
    diff = abs(bbi - nbi)
    if diff == 6:
        lines.append(f"CLASH: {ba} clashes with {na}. Year of challenges and forced change.")
    elif diff in [4, 8]:
        lines.append(f"HARMONY: {ba} harmonizes with {na}. Supportive year for growth.")
    elif diff == 0:
        lines.append(f"SAME ANIMAL: Your zodiac year (Ben Ming Nian). Year of tests. Wear red.")
    else:
        lines.append(f"{ba} to {na}: Neutral relationship.")

    lines.append("")
    lines.append("UPCOMING KEY YEARS:")
    for offset in [4, 6, 8, 12]:
        fy = now.year + ((bbi - nbi + offset) % 12)
        if fy <= now.year: fy += 12
        fs, fb, fa = _year_stem_branch(fy)
        fe = stem_elements.get(fs, '')
        rel = "Harmony" if offset in [4, 8] else "Clash" if offset == 6 else "Same animal"
        lines.append(f"  {fy}: {fe} {fa} ({rel})")
    return "\n".join(lines)


# Register all 5 new sections
SECTION_MAP['stems_branches'] = ('HEAVENLY STEMS & EARTHLY BRANCHES', _build_stems_branches)
SECTION_MAP['loshu_grid'] = ('LOSHU GRID', _build_loshu)
SECTION_MAP['bagua'] = ('BAGUA — EIGHT TRIGRAMS', _build_bagua)
SECTION_MAP['yin_yang'] = ('YIN-YANG BALANCE', _build_yin_yang)
SECTION_MAP['lunar_calendar'] = ('CHINESE LUNAR CALENDAR', _build_lunar_calendar)


def _build_daily_guidance(engine) -> str:
    try:
        from app.services.lifestyle import chinese as chinese_life
        return chinese_life.briefing(engine)
    except Exception:
        return ""

SECTION_MAP['daily_guidance'] = ('TODAY — DAILY GUIDANCE (lucky colour / direction / element)', _build_daily_guidance)
