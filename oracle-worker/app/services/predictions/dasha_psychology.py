"""
DASHA PSYCHOLOGY — What the user is FEELING based on their current dasha.

Each planet creates a specific psychological state when it runs.
The Oracle reads this and calibrates its tone, empathy level, and advice style.

5 levels = 5 layers of psychological state:
  Mahadasha = life theme (years)
  Antardasha = current chapter (months)
  Pratyantar = current mood (weeks)
  Sookshma = today's energy (days)
  Prana = this moment's state (hours)

Source: BPHS dasha effects + Phaladeepika + classical descriptions of planetary nature.
"""

from typing import Dict


# What each planet makes a person FEEL when its dasha runs
PLANET_PSYCHOLOGY = {
    'Sun': {
        'state': 'authoritative',
        'feeling': 'Seeking recognition, authority, clarity. Ego is active. Wants respect.',
        'likely_mood': 'confident but possibly arrogant or frustrated if not getting recognition',
        'needs': 'To feel seen and respected. Validate their authority.',
        'tone': 'Address with respect. Be direct, not patronizing. Treat them as capable.',
        'risk': 'Ego clashes, father issues, authority conflicts, health of heart/eyes',
        'positive': 'Leadership, clarity, spiritual illumination, government favor',
    },
    'Moon': {
        'state': 'emotional',
        'feeling': 'Sensitive, emotional, changeable. Mind is active. Needs comfort.',
        'likely_mood': 'fluctuating emotions, nostalgia, attachment to mother/home, may feel vulnerable',
        'needs': 'Emotional safety. Gentle, nurturing response. Reassurance.',
        'tone': 'Be warm, motherly. Lead with empathy. Never be harsh or blunt.',
        'risk': 'Anxiety, depression, overthinking, sleep issues, mother health',
        'positive': 'Intuition strong, public popularity, emotional intelligence peaks',
    },
    'Mars': {
        'state': 'aggressive',
        'feeling': 'Driven, impatient, wants action NOW. High energy. Competitive.',
        'likely_mood': 'restless, angry, frustrated with delays, wants to fight or build something',
        'needs': 'To channel energy productively. Give them action steps, not philosophy.',
        'tone': 'Be bold, direct, action-oriented. Give specific steps. No vague advice.',
        'risk': 'Accidents, fights, blood pressure, surgery, property disputes',
        'positive': 'Courage peaks, physical strength, leadership, property gains',
    },
    'Mercury': {
        'state': 'analytical',
        'feeling': 'Thinking too much, analyzing everything. Wants information and logic.',
        'likely_mood': 'curious, nervous, scattered, communication-focused, detail-oriented',
        'needs': 'Clear, logical explanations. They want to UNDERSTAND, not just believe.',
        'tone': 'Be intelligent, detailed when asked. They appreciate wit and precision.',
        'risk': 'Nervous disorders, skin issues, speech problems, business miscalculation',
        'positive': 'Learning, communication, trade, writing, intellectual breakthroughs',
    },
    'Jupiter': {
        'state': 'expansive',
        'feeling': 'Optimistic, philosophical, seeking meaning. Generous but may overcommit.',
        'likely_mood': 'hopeful, spiritual, generous, sometimes overconfident or preachy',
        'needs': 'Wisdom, not just facts. They want big-picture meaning.',
        'tone': 'Be philosophical, wise. Share deeper meaning. They can handle truth.',
        'risk': 'Over-expansion, liver issues, false gurus, broken promises',
        'positive': 'Wealth, children, wisdom, dharma, teaching, spiritual growth',
    },
    'Venus': {
        'state': 'pleasure-seeking',
        'feeling': 'Wants beauty, love, comfort, pleasure. Romantic energy high.',
        'likely_mood': 'romantic, creative, indulgent, seeking beauty and harmony in life',
        'needs': 'To feel that life is beautiful. Appreciate their aesthetic side.',
        'tone': 'Be warm, elegant. Speak beautifully. They notice HOW you say things.',
        'risk': 'Overindulgence, relationship drama, urinary/reproductive issues, luxury spending',
        'positive': 'Love, marriage, art, music, wealth, vehicles, luxury',
    },
    'Saturn': {
        'state': 'heavy',
        'feeling': 'Burdened, restricted, patient under pressure. Life feels slow and hard.',
        'likely_mood': 'heavy, serious, pessimistic, feeling stuck or punished, working very hard',
        'needs': 'Validation that their hard work WILL pay off. Hope with specific timing.',
        'tone': 'LEAD WITH EMPATHY. Acknowledge the weight. Then give hope with timing. Be the light in their darkness.',
        'risk': 'Depression, chronic disease, delays in everything, loneliness, career blocks',
        'positive': 'Discipline, lasting achievement, spiritual depth, karmic clearing',
    },
    'Rahu': {
        'state': 'obsessive',
        'feeling': 'Anxious, obsessive, craving something they cannot name. Confused.',
        'likely_mood': 'restless, obsessed with one thing, confused about direction, fear of unknown',
        'needs': 'GROUNDING. They feel unmoored. Give them clarity and direction.',
        'tone': 'Be calm, grounding, specific. Cut through their confusion with clear guidance.',
        'risk': 'Addiction, poisoning, foreign troubles, cheating, illusions, phobias',
        'positive': 'Foreign success, unconventional gains, technology, mass fame',
    },
    'Ketu': {
        'state': 'detached',
        'feeling': 'Disconnected, spiritual, lost. May feel nothing matters.',
        'likely_mood': 'detached, spiritual but directionless, letting go of things, feeling empty',
        'needs': 'DIRECTION. They are dissolving but need a spiritual anchor.',
        'tone': 'Be spiritual but practical. Acknowledge their inner journey. Give grounding advice.',
        'risk': 'Accidents, surgery, mysterious illness, loss, spiritual crisis',
        'positive': 'Moksha, liberation, deep meditation, past-life wisdom, mystical experiences',
    },
}


def get_psychological_state(engine) -> Dict:
    """
    Read the user's current psychological state from their 5-level dasha.
    Returns a complete psychological profile for the Oracle.
    """
    try:
        dasha = engine.get_vimshottari_dasha()
    except Exception:
        return {'error': 'Could not calculate dasha'}

    maha_lord = dasha.get('mahadasha', {}).get('lord', '')
    antar_lord = dasha.get('antardasha', {}).get('lord', '')
    prat_lord = dasha.get('pratyantardasha', {}).get('lord', '')
    sookshma_lord = dasha.get('sookshmadasha', {}).get('lord', '') if 'sookshmadasha' in dasha else ''
    prana_lord = dasha.get('pranadasha', {}).get('lord', '') if 'pranadasha' in dasha else ''

    maha_psych = PLANET_PSYCHOLOGY.get(maha_lord, {})
    antar_psych = PLANET_PSYCHOLOGY.get(antar_lord, {})
    prat_psych = PLANET_PSYCHOLOGY.get(prat_lord, {})
    sookshma_psych = PLANET_PSYCHOLOGY.get(sookshma_lord, {})
    prana_psych = PLANET_PSYCHOLOGY.get(prana_lord, {})

    # Build psychological briefing for the Oracle
    # Priority: Antardasha mood + Sookshma energy (most felt right now)
    # Mahadasha = background theme
    
    # Determine if user is likely in distress
    difficult_planets = {'Saturn', 'Rahu', 'Ketu'}
    distress_level = 0
    if maha_lord in difficult_planets: distress_level += 2
    if antar_lord in difficult_planets: distress_level += 3
    if prat_lord in difficult_planets: distress_level += 1
    
    # Determine overall energy
    if distress_level >= 4:
        overall_state = 'DIFFICULT — user is likely feeling heavy, stuck, or confused. LEAD WITH EMPATHY.'
    elif distress_level >= 2:
        overall_state = 'MIXED — some pressure but manageable. Be supportive but direct.'
    else:
        overall_state = 'POSITIVE — user is likely feeling capable and optimistic. Be encouraging and bold.'

    return {
        'dasha_string': dasha.get('dasha_string', ''),
        'overall_state': overall_state,
        'distress_level': distress_level,
        'life_theme': f"{maha_lord} Mahadasha: {maha_psych.get('feeling', '')}",
        'current_chapter': f"{antar_lord} Antardasha: {antar_psych.get('feeling', '')}",
        'current_mood': f"{prat_lord} Pratyantar: {prat_psych.get('likely_mood', '')}",
        'today_energy': f"{sookshma_lord} Sookshma: {sookshma_psych.get('likely_mood', '')}" if sookshma_lord else '',
        'this_moment': f"{prana_lord} Prana: {prana_psych.get('state', '')}" if prana_lord else '',
        'oracle_tone': antar_psych.get('tone', 'Be warm and clear.'),
        'user_needs': antar_psych.get('needs', ''),
        'current_risks': antar_psych.get('risk', ''),
        'current_positives': antar_psych.get('positive', ''),
    }
