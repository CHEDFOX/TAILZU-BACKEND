"""
BPHS — EFFECTS OF PLANETS IN HOUSES (108 combinations)

9 planets × 12 houses = 108 effects.
Sources: BPHS Ch.12-23 (house effects), Phaladeepika, Saravali.

Each planet in each house gives specific effects described in the texts.
"""

from typing import Dict, List, Optional

# ═══════════════════════════════════════════════════════════════
# 108 PLANET-IN-HOUSE EFFECTS
# EFFECTS[planet][house] = {'text': ..., 'source': ..., 'nature': ...}
# ═══════════════════════════════════════════════════════════════

EFFECTS = {
    'Sun': {
        1: {'text': 'Lazy, hot-tempered but courageous. Defective eyesight. Cruel disposition but strong body.', 'source': 'BPHS 12/Phaladeepika', 'nature': 'mixed'},
        2: {'text': 'Without learning, modesty. Stammering speech. Wealth from government.', 'source': 'BPHS 13', 'nature': 'mixed'},
        3: {'text': 'Valorous, strong, wealthy. Defeats enemies. Good siblings.', 'source': 'BPHS 14', 'nature': 'positive'},
        4: {'text': 'Unhappy, without friends, property, home comfort. Troubled heart.', 'source': 'BPHS 15', 'nature': 'negative'},
        5: {'text': 'Short-lived children, unstable mind. But intelligent and learned.', 'source': 'BPHS 16', 'nature': 'mixed'},
        6: {'text': 'Destroys enemies. Famous, powerful. Good digestion. Kingly status.', 'source': 'BPHS 17', 'nature': 'positive'},
        7: {'text': 'Late marriage, troubled spouse. Wanders. But known publicly.', 'source': 'BPHS 18', 'nature': 'negative'},
        8: {'text': 'Few friends, defective eyesight. Short life unless benefic aspect.', 'source': 'BPHS 19', 'nature': 'negative'},
        9: {'text': 'Blessed with sons and wealth. Devoted to God. Charitable and virtuous.', 'source': 'BPHS 20', 'nature': 'positive'},
        10: {'text': 'Very successful career. Authority and power. Government connection. Famous.', 'source': 'BPHS 21/Phaladeepika', 'nature': 'positive'},
        11: {'text': 'Wealthy, long-lived, happy. Vehicles and comforts. Commands respect.', 'source': 'BPHS 22', 'nature': 'positive'},
        12: {'text': 'Defective eyesight, enmity with father. Fallen from position. Foreign lands.', 'source': 'BPHS 23', 'nature': 'negative'},
    },
    'Moon': {
        1: {'text': 'Beautiful, charming, soft-spoken. Popular with women. Fickle but attractive.', 'source': 'BPHS 12', 'nature': 'positive'},
        2: {'text': 'Wealthy family, sweet speech, beautiful face. Many relatives support.', 'source': 'BPHS 13', 'nature': 'positive'},
        3: {'text': 'Miserly, cruel brothers. But courageous and hardworking.', 'source': 'BPHS 14', 'nature': 'mixed'},
        4: {'text': 'Happy, comfortable home, vehicles. Good mother. Peaceful mind.', 'source': 'BPHS 15', 'nature': 'positive'},
        5: {'text': 'Intelligent, good minister or adviser. Many children. Virtuous.', 'source': 'BPHS 16', 'nature': 'positive'},
        6: {'text': 'Sickly, short-lived enemies. Stomach troubles. Lazy disposition.', 'source': 'BPHS 17', 'nature': 'negative'},
        7: {'text': 'Beautiful spouse, happy marriage. Jealous nature. Popular.', 'source': 'BPHS 18', 'nature': 'positive'},
        8: {'text': 'Short-lived, mental troubles. Sickly disposition. Occult interest.', 'source': 'BPHS 19', 'nature': 'negative'},
        9: {'text': 'Virtuous, wealthy, devoted to mother. Religious and charitable.', 'source': 'BPHS 20', 'nature': 'positive'},
        10: {'text': 'Public career, known to masses. Successful, charitable. Famous.', 'source': 'BPHS 21', 'nature': 'positive'},
        11: {'text': 'Many friends, wealthy, long-lived. Happy with children. Vehicles.', 'source': 'BPHS 22', 'nature': 'positive'},
        12: {'text': 'Lazy, humiliated. Defective eyesight. Few comforts. Spendthrift.', 'source': 'BPHS 23', 'nature': 'negative'},
    },
    'Mars': {
        1: {'text': 'Courageous, short-tempered, scars on body. Cruel but strong. Short life of spouse.', 'source': 'BPHS 12/Phaladeepika', 'nature': 'mixed'},
        2: {'text': 'Harsh speech, quarrelsome family. Eats unwholesome food. Ugly face.', 'source': 'BPHS 13', 'nature': 'negative'},
        3: {'text': 'Extremely valorous, defeats all enemies. Wealthy. No younger siblings.', 'source': 'BPHS 14', 'nature': 'positive'},
        4: {'text': 'No friends, no property, mother troubled. Unhappy at home.', 'source': 'BPHS 15', 'nature': 'negative'},
        5: {'text': 'Few children, fickle mind. Sharp intellect but unstable.', 'source': 'BPHS 16', 'nature': 'mixed'},
        6: {'text': 'Destroys enemies completely. Wealthy, famous. Strong constitution.', 'source': 'BPHS 17', 'nature': 'positive'},
        7: {'text': 'Manglik dosha — troubled marriage, quarrelsome spouse. But passionate.', 'source': 'BPHS 18/Phaladeepika', 'nature': 'negative'},
        8: {'text': 'Short-lived, sickly. Piles, wounds. Troubled. But research mind.', 'source': 'BPHS 19', 'nature': 'negative'},
        9: {'text': 'Harms father, quarrelsome. But courageous and active in dharma.', 'source': 'BPHS 20', 'nature': 'mixed'},
        10: {'text': 'Powerful career, leadership. Brave actions. Government connection.', 'source': 'BPHS 21/Phaladeepika', 'nature': 'positive'},
        11: {'text': 'Very wealthy, happy, long-lived. Gains from property and land.', 'source': 'BPHS 22', 'nature': 'positive'},
        12: {'text': 'Expenses through enemies, defective eyesight. Falls from position.', 'source': 'BPHS 23', 'nature': 'negative'},
    },
    'Mercury': {
        1: {'text': 'Learned, eloquent, long-lived. Skilled in trade and crafts. Good looks.', 'source': 'BPHS 12/Phaladeepika', 'nature': 'positive'},
        2: {'text': 'Very wealthy, eloquent, learned. Sweet and effective speech.', 'source': 'BPHS 13', 'nature': 'positive'},
        3: {'text': 'Courageous, good siblings. Clever and witty. Communication skills.', 'source': 'BPHS 14', 'nature': 'positive'},
        4: {'text': 'Learned, happy mother. Property and vehicles. Good education.', 'source': 'BPHS 15', 'nature': 'positive'},
        5: {'text': 'Very intelligent, learned in shastras. Good children. Adviser.', 'source': 'BPHS 16/Phaladeepika', 'nature': 'positive'},
        6: {'text': 'Lazy, quarrelsome. Harsh speech. Defeats enemies through intellect.', 'source': 'BPHS 17', 'nature': 'mixed'},
        7: {'text': 'Beautiful, educated spouse. Good marriage. Trade and business success.', 'source': 'BPHS 18', 'nature': 'positive'},
        8: {'text': 'Long-lived, famous. But troubles through servants. Research mind.', 'source': 'BPHS 19', 'nature': 'mixed'},
        9: {'text': 'Virtuous, religious, learned. Good fortune through intellect.', 'source': 'BPHS 20', 'nature': 'positive'},
        10: {'text': 'Successful career in intellect-based field. Happy, truthful, learned.', 'source': 'BPHS 21', 'nature': 'positive'},
        11: {'text': 'Very wealthy, long-lived, truthful. Gains through trade and intellect.', 'source': 'BPHS 22', 'nature': 'positive'},
        12: {'text': 'Lazy, without learning, humiliated. Spends on bad pursuits.', 'source': 'BPHS 23', 'nature': 'negative'},
    },
    'Jupiter': {
        1: {'text': 'Beautiful body, learned, long-lived. Happy, virtuous, wise.', 'source': 'BPHS 12/Phaladeepika', 'nature': 'positive'},
        2: {'text': 'Very wealthy, eloquent, large family. Generous and learned.', 'source': 'BPHS 13', 'nature': 'positive'},
        3: {'text': 'Miserly, despised by siblings. But determined and successful.', 'source': 'BPHS 14', 'nature': 'mixed'},
        4: {'text': 'Very happy, mother prosperous. Property and vehicles. Learned.', 'source': 'BPHS 15/Phaladeepika', 'nature': 'positive'},
        5: {'text': 'Intelligent, minister or adviser. Many sons. Very learned. Dharmic.', 'source': 'BPHS 16', 'nature': 'positive'},
        6: {'text': 'Destroys enemies, lazy. But stomach troubles. Humiliated by relatives.', 'source': 'BPHS 17', 'nature': 'mixed'},
        7: {'text': 'Beautiful wise spouse. Happy marriage. Spouse better than self.', 'source': 'BPHS 18/Phaladeepika', 'nature': 'positive'},
        8: {'text': 'Long-lived, unhappy. Servile work. But interest in occult and research.', 'source': 'BPHS 19', 'nature': 'mixed'},
        9: {'text': 'Extremely fortunate, religious, wealthy. Father prospers. Dharma strong.', 'source': 'BPHS 20/Phaladeepika', 'nature': 'positive'},
        10: {'text': 'Very successful career, honoured. Virtuous actions. Royal favour. Famous.', 'source': 'BPHS 21', 'nature': 'positive'},
        11: {'text': 'Very wealthy, long-lived, happy. Vehicles, servants. All desires fulfilled.', 'source': 'BPHS 22', 'nature': 'positive'},
        12: {'text': 'Fallen, without wealth. Lazy. But spiritual inclination. Moksha possible.', 'source': 'BPHS 23', 'nature': 'mixed'},
    },
    'Venus': {
        1: {'text': 'Happy, beautiful body, long-lived. Charming, lusty, comfortable.', 'source': 'BPHS 12', 'nature': 'positive'},
        2: {'text': 'Very wealthy, poet, eloquent. Sweet speech. Family happiness.', 'source': 'BPHS 13', 'nature': 'positive'},
        3: {'text': 'Miserly, unhappy. But gains through art and communication.', 'source': 'BPHS 14', 'nature': 'mixed'},
        4: {'text': 'Vehicles, property, happy mother. Comfortable life. Beautiful home.', 'source': 'BPHS 15/Phaladeepika', 'nature': 'positive'},
        5: {'text': 'Wealthy, adviser to ruler. Happy children. Romance blessed.', 'source': 'BPHS 16', 'nature': 'positive'},
        6: {'text': 'Without enemies but lazy. Humiliated. Urinary troubles.', 'source': 'BPHS 17', 'nature': 'negative'},
        7: {'text': 'Beautiful spouse, excessive desires. Happy marriage. But lustful.', 'source': 'BPHS 18', 'nature': 'positive'},
        8: {'text': 'Long-lived, wealthy through spouse. But troubled marriage.', 'source': 'BPHS 19', 'nature': 'mixed'},
        9: {'text': 'Fortunate, religious, devoted spouse. Wealthy, virtuous.', 'source': 'BPHS 20', 'nature': 'positive'},
        10: {'text': 'Career in arts, luxury, beauty. Happy, virtuous actions. Famous.', 'source': 'BPHS 21', 'nature': 'positive'},
        11: {'text': 'Very wealthy, vehicles, comforts. All desires fulfilled. Happy.', 'source': 'BPHS 22', 'nature': 'positive'},
        12: {'text': 'Enjoys pleasures, wealthy. But spendthrift. Foreign connections.', 'source': 'BPHS 23', 'nature': 'mixed'},
    },
    'Saturn': {
        1: {'text': 'Sickly in childhood, lean body. Lazy, wandering. But long-lived.', 'source': 'BPHS 12/Phaladeepika', 'nature': 'negative'},
        2: {'text': 'Ugly face, without wealth in youth. Harsh speech. Family troubles.', 'source': 'BPHS 13', 'nature': 'negative'},
        3: {'text': 'Very courageous, intelligent, wealthy. But loss of siblings.', 'source': 'BPHS 14', 'nature': 'mixed'},
        4: {'text': 'Without happiness, mother troubled. No vehicles or property.', 'source': 'BPHS 15', 'nature': 'negative'},
        5: {'text': 'Without children or they face troubles. Wicked intellect. Wandering.', 'source': 'BPHS 16', 'nature': 'negative'},
        6: {'text': 'Destroys enemies. Wealthy, proud. Glutton. Strong constitution.', 'source': 'BPHS 17', 'nature': 'positive'},
        7: {'text': 'Spouse is older, sickly or of low family. Delayed marriage. Wandering.', 'source': 'BPHS 18/Phaladeepika', 'nature': 'negative'},
        8: {'text': 'Sickly, unclean, short-tempered. Financial losses. But longevity.', 'source': 'BPHS 19', 'nature': 'negative'},
        9: {'text': 'Without fortune or dharma. Father troubled. Harsh actions.', 'source': 'BPHS 20', 'nature': 'negative'},
        10: {'text': 'Career through hard work and discipline. Slow rise but lasting. Government service.', 'source': 'BPHS 21/Saravali', 'nature': 'mixed'},
        11: {'text': 'Wealthy, long-lived, happy. Gains through patience and persistence.', 'source': 'BPHS 22', 'nature': 'positive'},
        12: {'text': 'Defective limb, fallen, enmity. Expenses. But moksha possible.', 'source': 'BPHS 23', 'nature': 'negative'},
    },
    'Rahu': {
        1: {'text': 'Short-lived, wealthy but through questionable means. Trouble to body.', 'source': 'BPHS/Phaladeepika', 'nature': 'mixed'},
        2: {'text': 'Harsh speech, family discord. Wealth through unconventional means.', 'source': 'BPHS', 'nature': 'mixed'},
        3: {'text': 'Wealthy, courageous, few siblings. Gains through effort and travel.', 'source': 'BPHS', 'nature': 'positive'},
        4: {'text': 'Loss of mother or domestic peace. But property through unusual means.', 'source': 'BPHS', 'nature': 'negative'},
        5: {'text': 'Few children, stomach troubles. But sharp intellect.', 'source': 'BPHS', 'nature': 'negative'},
        6: {'text': 'Destroys enemies completely. Wealthy. Strong constitution.', 'source': 'BPHS', 'nature': 'positive'},
        7: {'text': 'Unconventional marriage, foreign spouse. Multiple relationships possible.', 'source': 'BPHS/Phaladeepika', 'nature': 'mixed'},
        8: {'text': 'Short-lived, sickly. But research mind, occult knowledge.', 'source': 'BPHS', 'nature': 'negative'},
        9: {'text': 'Irreligious, troubles father. But gains from foreign connections.', 'source': 'BPHS', 'nature': 'mixed'},
        10: {'text': 'Powerful career through unconventional means. Fame. Mass appeal.', 'source': 'BPHS/Saravali', 'nature': 'positive'},
        11: {'text': 'Great wealth, many friends. Gains from foreign and technology.', 'source': 'BPHS', 'nature': 'positive'},
        12: {'text': 'Expenses, fallen. But foreign residence. Spiritual confusion.', 'source': 'BPHS', 'nature': 'negative'},
    },
    'Ketu': {
        1: {'text': 'Sickly, ungrateful. But spiritual inclination. Scars on body.', 'source': 'BPHS/Phaladeepika', 'nature': 'mixed'},
        2: {'text': 'Harsh speech, family discord. Face troubles. But detached.', 'source': 'BPHS', 'nature': 'negative'},
        3: {'text': 'Courageous, wealthy, few siblings. Self-made success.', 'source': 'BPHS', 'nature': 'positive'},
        4: {'text': 'Loss of home happiness. Lives away from birthplace. Mother troubled.', 'source': 'BPHS', 'nature': 'negative'},
        5: {'text': 'Few children, stomach troubles. But sharp mystical intellect.', 'source': 'BPHS', 'nature': 'negative'},
        6: {'text': 'Destroys enemies. Good health. Gains through competition.', 'source': 'BPHS', 'nature': 'positive'},
        7: {'text': 'Spouse is spiritual or detached. Marriage issues. But spiritual partner.', 'source': 'BPHS', 'nature': 'mixed'},
        8: {'text': 'Short-lived or chronically sick. But deep occult and mystical knowledge.', 'source': 'BPHS', 'nature': 'mixed'},
        9: {'text': 'Father troubled, religious confusion. But past-life spiritual merit.', 'source': 'BPHS', 'nature': 'mixed'},
        10: {'text': 'Career obstacles, unconventional work. But spiritual vocation possible.', 'source': 'BPHS', 'nature': 'mixed'},
        11: {'text': 'Wealth, gains from spiritual pursuits. Few friends but loyal ones.', 'source': 'BPHS', 'nature': 'positive'},
        12: {'text': 'Moksha karaka in moksha house. Deep spiritual liberation. Detachment.', 'source': 'BPHS/Phaladeepika', 'nature': 'positive'},
    },
}


def get_planet_in_house_effect(planet: str, house: int) -> Optional[Dict]:
    """Get BPHS effect for a planet in a specific house."""
    return EFFECTS.get(planet, {}).get(house)


def get_all_planet_placements(engine) -> List[Dict]:
    """Get all planet-in-house effects for a chart."""
    results = []
    for planet in ['Sun', 'Moon', 'Mars', 'Mercury', 'Jupiter', 'Venus', 'Saturn', 'Rahu', 'Ketu']:
        house = engine.planets.get(planet, {}).get('house', 1)
        effect = get_planet_in_house_effect(planet, house)
        if effect:
            results.append({
                'planet': planet,
                'house': house,
                'text': effect['text'],
                'source': effect['source'],
                'nature': effect['nature'],
            })
    return results


def get_planet_effects_for_event(engine, event: str) -> List[Dict]:
    """Get relevant planet-in-house effects for a specific life event."""
    # Which houses matter for which events
    EVENT_HOUSES = {
        'marriage': [1, 2, 7, 8, 12],
        'children': [1, 5, 7, 9],
        'wealth': [1, 2, 5, 9, 10, 11],
        'career': [1, 2, 6, 10, 11],
        'spiritual': [1, 5, 8, 9, 12],
        'health': [1, 6, 8],
        'foreign': [3, 4, 7, 9, 12],
        'property': [1, 4, 10, 11],
        'education': [1, 2, 4, 5, 9],
        'longevity': [1, 3, 8],
        'father': [1, 9, 10],
        'mother': [1, 4],
        'siblings': [1, 3, 11],
        'business': [1, 7, 10, 11],
        'love': [1, 5, 7],
        'fame': [1, 5, 9, 10],
    }

    relevant_houses = EVENT_HOUSES.get(event, [1])
    all_placements = get_all_planet_placements(engine)
    return [p for p in all_placements if p['house'] in relevant_houses]
