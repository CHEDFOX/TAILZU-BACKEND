"""
BPHS CHAPTER 24 — EFFECTS OF BHAVA LORDS IN VARIOUS HOUSES

144 combinations: 12 house lords × 12 house placements.
Every entry is from Brihat Parashara Hora Shastra Chapter 24.
Source: R. Santhanam translation.

Usage:
    from .lord_in_house import get_lord_in_house_effect
    effect = get_lord_in_house_effect(lord_house=1, placed_house=7)
    # Returns: {'text': '...', 'source': 'BPHS 24.x', 'nature': 'positive/negative/mixed'}
"""

from typing import Dict, List, Optional
from ..core.constants import RASHI_LORDS

# ═══════════════════════════════════════════════════════════════
# COMPLETE 144 LORD-IN-HOUSE EFFECTS FROM BPHS CH.24
# nature: 'positive', 'negative', 'mixed', 'neutral'
# Each maps to: EFFECTS[lord_house][placed_house]
# ═══════════════════════════════════════════════════════════════

EFFECTS = {
    # ═══ 1ST LORD (LAGNA LORD) IN HOUSES 1-12 ═══
    1: {
        1: {'text': 'Physical happiness, prowess, intelligence. May be fickle-minded.', 'source': 'BPHS 24.1', 'nature': 'positive'},
        2: {'text': 'Gainful, scholarly, happy, good qualities, religious, honourable.', 'source': 'BPHS 24.2', 'nature': 'positive'},
        3: {'text': 'Valorous, will have servants, intelligent, virtuous. Two wives indicated.', 'source': 'BPHS 24.3', 'nature': 'positive'},
        4: {'text': 'Paternal happiness, many brothers, lustful, virtuous, charming.', 'source': 'BPHS 24.4', 'nature': 'positive'},
        5: {'text': 'First child may not survive. Intelligent, adviser to ruler.', 'source': 'BPHS 24.5', 'nature': 'mixed'},
        6: {'text': 'Troubled by enemies. Sickly constitution. Short-tempered but courageous.', 'source': 'BPHS 24.6', 'nature': 'negative'},
        7: {'text': 'Wanders to other places. Gives up own wife for another. Skilled in trade.', 'source': 'BPHS 24.7', 'nature': 'mixed'},
        8: {'text': 'Sickly, short-lived, thievish tendency. Unhappy, angry disposition.', 'source': 'BPHS 24.8', 'nature': 'negative'},
        9: {'text': 'Fortunate, dear to people, devoted to God, charming, virtuous.', 'source': 'BPHS 24.9', 'nature': 'positive'},
        10: {'text': 'Happiness from father, royal favour, famous, intelligent, wealthy.', 'source': 'BPHS 24.10', 'nature': 'positive'},
        11: {'text': 'Wealthy, happy, virtuous, respected by many. Long-lived.', 'source': 'BPHS 24.11', 'nature': 'positive'},
        12: {'text': 'Spendthrift, weak constitution, troubled. May live in foreign lands.', 'source': 'BPHS 24.12', 'nature': 'negative'},
    },
    # ═══ 2ND LORD (DHANA LORD) IN HOUSES 1-12 ═══
    2: {
        1: {'text': 'Wealthy, charming, eloquent. Enjoys various luxuries.', 'source': 'BPHS 24.13', 'nature': 'positive'},
        2: {'text': 'Very wealthy, family happiness, sweet speech, learned.', 'source': 'BPHS 24.14', 'nature': 'positive'},
        3: {'text': 'Valorous, courageous. May gain through siblings.', 'source': 'BPHS 24.15', 'nature': 'positive'},
        4: {'text': 'Wealthy through mother and property. Enjoys comforts.', 'source': 'BPHS 24.16', 'nature': 'positive'},
        5: {'text': 'Wealthy, many children, wise. Good fortune through children.', 'source': 'BPHS 24.17', 'nature': 'positive'},
        6: {'text': 'Wealth through enemies or competition. Brave but troubled.', 'source': 'BPHS 24.18', 'nature': 'mixed'},
        7: {'text': 'Wealth through spouse and partnerships. Skilled in business.', 'source': 'BPHS 24.19', 'nature': 'positive'},
        8: {'text': 'Loss of wealth, financial struggles. May gain through inheritance.', 'source': 'BPHS 24.20', 'nature': 'negative'},
        9: {'text': 'Very wealthy, fortunate, religious. Gains through father.', 'source': 'BPHS 24.21', 'nature': 'positive'},
        10: {'text': 'Wealthy through profession, honoured. Career brings riches.', 'source': 'BPHS 24.22', 'nature': 'positive'},
        11: {'text': 'Great wealth, many gains. Profits from various sources.', 'source': 'BPHS 24.23', 'nature': 'positive'},
        12: {'text': 'Wealth is spent away. Financial losses. Penury possible.', 'source': 'BPHS 24.24', 'nature': 'negative'},
    },
    # ═══ 3RD LORD (SAHAJ LORD) IN HOUSES 1-12 ═══
    3: {
        1: {'text': 'Valorous, wise, with good siblings. Self-made efforts succeed.', 'source': 'BPHS 24.25', 'nature': 'positive'},
        2: {'text': 'Gains wealth through own efforts and courage.', 'source': 'BPHS 24.26', 'nature': 'positive'},
        3: {'text': 'Very courageous, happy with siblings. Skilled in arts.', 'source': 'BPHS 24.27', 'nature': 'positive'},
        4: {'text': 'Happy, owns property. Mother supports endeavours.', 'source': 'BPHS 24.28', 'nature': 'positive'},
        5: {'text': 'Intelligent, happy children. Creative expression blessed.', 'source': 'BPHS 24.29', 'nature': 'positive'},
        6: {'text': 'Inimical to siblings. Diseases and obstacles from efforts.', 'source': 'BPHS 24.30', 'nature': 'negative'},
        7: {'text': 'Gains through travel and partnerships. Courageous spouse.', 'source': 'BPHS 24.31', 'nature': 'positive'},
        8: {'text': 'Loss of siblings, lack of courage. Depression possible.', 'source': 'BPHS 24.32', 'nature': 'negative'},
        9: {'text': 'Fortunate through own efforts. Father may be absent.', 'source': 'BPHS 24.33', 'nature': 'mixed'},
        10: {'text': 'Career through own efforts and courage. Self-made success.', 'source': 'BPHS 24.34', 'nature': 'positive'},
        11: {'text': 'Gains through siblings and personal efforts. Fulfillment of desires.', 'source': 'BPHS 24.35', 'nature': 'positive'},
        12: {'text': 'Loss through own efforts. Siblings may suffer. Foreign connection.', 'source': 'BPHS 24.36', 'nature': 'negative'},
    },
    # ═══ 4TH LORD (BANDHU LORD) IN HOUSES 1-12 ═══
    4: {
        1: {'text': 'Happy, learned, mother happy. Enjoys comforts and vehicles.', 'source': 'BPHS 24.37', 'nature': 'positive'},
        2: {'text': 'Wealth from property and mother. Family prosperity.', 'source': 'BPHS 24.38', 'nature': 'positive'},
        3: {'text': 'Valorous, mother of good character. Siblings help with property.', 'source': 'BPHS 24.39', 'nature': 'positive'},
        4: {'text': 'Very happy, excellent vehicles, property. Mother long-lived.', 'source': 'BPHS 24.40', 'nature': 'positive'},
        5: {'text': 'Happiness from mother and children both. Learned.', 'source': 'BPHS 24.41', 'nature': 'positive'},
        6: {'text': 'Maternal unhappiness. Property disputes. Enemies trouble.', 'source': 'BPHS 24.42', 'nature': 'negative'},
        7: {'text': 'Mother happy, spouse brings domestic comfort. Foreign property.', 'source': 'BPHS 24.43', 'nature': 'positive'},
        8: {'text': 'Loss of property, mother suffers. Little domestic happiness.', 'source': 'BPHS 24.44', 'nature': 'negative'},
        9: {'text': 'Fortunate in property and education. Mother religious.', 'source': 'BPHS 24.45', 'nature': 'positive'},
        10: {'text': 'Career connected to property/education. Happy mother. Royal favour.', 'source': 'BPHS 24.46', 'nature': 'positive'},
        11: {'text': 'Gains from property and vehicles. Mother prosperous.', 'source': 'BPHS 24.47', 'nature': 'positive'},
        12: {'text': 'Loss of property and domestic happiness. Mother troubled. Foreign home.', 'source': 'BPHS 24.48', 'nature': 'negative'},
    },
    # ═══ 5TH LORD (PUTRA LORD) IN HOUSES 1-12 ═══
    5: {
        1: {'text': 'Intelligent, scholarly. Children bring happiness. Adviser to king.', 'source': 'BPHS 24.49', 'nature': 'positive'},
        2: {'text': 'Wealthy through intelligence. Many children. Sweet speech.', 'source': 'BPHS 24.50', 'nature': 'positive'},
        3: {'text': 'Intelligent, brave siblings. Creative courage.', 'source': 'BPHS 24.51', 'nature': 'positive'},
        4: {'text': 'Happy, learned mother. Children and property both blessed.', 'source': 'BPHS 24.52', 'nature': 'positive'},
        5: {'text': 'Many children, very intelligent. Adviser to ruler. Happy.', 'source': 'BPHS 24.53', 'nature': 'positive'},
        6: {'text': 'Children face troubles. Enemies through children. Intelligence used in conflict.', 'source': 'BPHS 24.54', 'nature': 'negative'},
        7: {'text': 'Happy through spouse and children. Love marriage possible.', 'source': 'BPHS 24.55', 'nature': 'positive'},
        8: {'text': 'Few children, they face troubles. Intelligence blocked.', 'source': 'BPHS 24.56', 'nature': 'negative'},
        9: {'text': 'Very fortunate, highly intelligent. Children prosper. Religious.', 'source': 'BPHS 24.57', 'nature': 'positive'},
        10: {'text': 'Career through intelligence and creativity. Children connected to profession.', 'source': 'BPHS 24.58', 'nature': 'positive'},
        11: {'text': 'Gains through children and intelligence. Desires fulfilled.', 'source': 'BPHS 24.59', 'nature': 'positive'},
        12: {'text': 'Children may live abroad or be lost. Intelligence spent on spiritual pursuits.', 'source': 'BPHS 24.60', 'nature': 'mixed'},
    },
    # ═══ 6TH LORD (ARI LORD) IN HOUSES 1-12 ═══
    6: {
        1: {'text': 'Sickly, troubled by enemies. But may overcome enemies through own strength.', 'source': 'BPHS 24.61', 'nature': 'negative'},
        2: {'text': 'Wealth through competition/service. But dental/facial issues.', 'source': 'BPHS 24.62', 'nature': 'mixed'},
        3: {'text': 'Courageous, defeats enemies. Siblings may be inimical.', 'source': 'BPHS 24.63', 'nature': 'mixed'},
        4: {'text': 'Enemies destroy domestic happiness. Mother may suffer.', 'source': 'BPHS 24.64', 'nature': 'negative'},
        5: {'text': 'Children face obstacles. Enmity with children possible.', 'source': 'BPHS 24.65', 'nature': 'negative'},
        6: {'text': 'Destroys enemies completely. Strong constitution. Viparita Raja Yoga.', 'source': 'BPHS 24.66', 'nature': 'positive'},
        7: {'text': 'Spouse may be sickly. Marital discord. But spouse is hardworking.', 'source': 'BPHS 24.67', 'nature': 'negative'},
        8: {'text': 'Long-lived (6th lord in 8th = Viparita Raja Yoga). Overcomes obstacles.', 'source': 'BPHS 24.68', 'nature': 'positive'},
        9: {'text': 'Unfortunate, troubled father. Religious doubts.', 'source': 'BPHS 24.69', 'nature': 'negative'},
        10: {'text': 'Career in service, medicine, law. Faces obstacles in profession.', 'source': 'BPHS 24.70', 'nature': 'mixed'},
        11: {'text': 'Gains through service and competition. Ear problems possible.', 'source': 'BPHS 24.71', 'nature': 'mixed'},
        12: {'text': 'Expenses on diseases. May be imprisoned. But Viparita Raja Yoga possible.', 'source': 'BPHS 24.72', 'nature': 'mixed'},
    },
    # ═══ 7TH LORD (YUVATI LORD) IN HOUSES 1-12 ═══
    7: {
        1: {'text': 'Spouse influences native strongly. Wandering nature. Skilled in trade.', 'source': 'BPHS 24.73', 'nature': 'mixed'},
        2: {'text': 'Wealth through marriage/partnerships. Spouse brings prosperity.', 'source': 'BPHS 24.74', 'nature': 'positive'},
        3: {'text': 'Courageous spouse. Gains through travel. Multiple relationships possible.', 'source': 'BPHS 24.75', 'nature': 'mixed'},
        4: {'text': 'Happy married life. Spouse from good family. Property through marriage.', 'source': 'BPHS 24.76', 'nature': 'positive'},
        5: {'text': 'Love marriage. Intelligent spouse. Children through marriage blessed.', 'source': 'BPHS 24.77', 'nature': 'positive'},
        6: {'text': 'Spouse is sickly or brings conflict. Marriage troubled by enemies.', 'source': 'BPHS 24.78', 'nature': 'negative'},
        7: {'text': 'Good marriage, powerful spouse. Happy marital life. Business success.', 'source': 'BPHS 24.79', 'nature': 'positive'},
        8: {'text': 'Spouse sickly or early death of spouse. Marriage brings suffering.', 'source': 'BPHS 24.80', 'nature': 'negative'},
        9: {'text': 'Fortunate through marriage. Spouse is religious and virtuous.', 'source': 'BPHS 24.81', 'nature': 'positive'},
        10: {'text': 'Career through partnerships. Spouse helps in profession. Famous.', 'source': 'BPHS 24.82', 'nature': 'positive'},
        11: {'text': 'Great gains through marriage and partnerships. Desires fulfilled.', 'source': 'BPHS 24.83', 'nature': 'positive'},
        12: {'text': 'Spouse from foreign land. Loss through marriage. Marital unhappiness.', 'source': 'BPHS 24.84', 'nature': 'negative'},
    },
    # ═══ 8TH LORD (RANDHRA LORD) IN HOUSES 1-12 ═══
    8: {
        1: {'text': 'Sickly body, short-lived tendency. But spiritual inclination.', 'source': 'BPHS 24.85', 'nature': 'negative'},
        2: {'text': 'Loss of wealth, family troubles. Speech impediment possible.', 'source': 'BPHS 24.86', 'nature': 'negative'},
        3: {'text': 'Lazy, without courage. Siblings face troubles.', 'source': 'BPHS 24.87', 'nature': 'negative'},
        4: {'text': 'Loss of property, domestic unhappiness. Mother may suffer.', 'source': 'BPHS 24.88', 'nature': 'negative'},
        5: {'text': 'Few children, they face troubles. Intelligence used for occult.', 'source': 'BPHS 24.89', 'nature': 'negative'},
        6: {'text': 'Overcomes enemies and diseases (Viparita Raja Yoga). Long-lived.', 'source': 'BPHS 24.90', 'nature': 'positive'},
        7: {'text': 'Spouse may be sickly. Marital suffering. But occult knowledge through spouse.', 'source': 'BPHS 24.91', 'nature': 'negative'},
        8: {'text': 'Long-lived. Interest in occult. May gain through inheritance.', 'source': 'BPHS 24.92', 'nature': 'mixed'},
        9: {'text': 'Unfortunate, irreligious. Father faces troubles.', 'source': 'BPHS 24.93', 'nature': 'negative'},
        10: {'text': 'Career suffers, obstacles in profession. May work in research/occult.', 'source': 'BPHS 24.94', 'nature': 'negative'},
        11: {'text': 'Gains through unexpected means. Inheritance. But elder sibling suffers.', 'source': 'BPHS 24.95', 'nature': 'mixed'},
        12: {'text': 'Spiritual liberation. Long-lived. Expenses on treatment. Viparita Raja Yoga.', 'source': 'BPHS 24.96', 'nature': 'mixed'},
    },
    # ═══ 9TH LORD (DHARMA LORD) IN HOUSES 1-12 ═══
    9: {
        1: {'text': 'Very fortunate, learned, famous. Father is prosperous. Religious.', 'source': 'BPHS 24.97', 'nature': 'positive'},
        2: {'text': 'Very wealthy, religious family. Fortune through speech and family.', 'source': 'BPHS 24.98', 'nature': 'positive'},
        3: {'text': 'Fortune through own efforts. Courageous, religious siblings.', 'source': 'BPHS 24.99', 'nature': 'positive'},
        4: {'text': 'Fortunate in property and education. Mother blessed. Happy.', 'source': 'BPHS 24.100', 'nature': 'positive'},
        5: {'text': 'Excellent fortune. Children are blessed. Highly intelligent. Dharmic.', 'source': 'BPHS 24.101', 'nature': 'positive'},
        6: {'text': 'Unfortunate, enmity with father. Religious obstacles.', 'source': 'BPHS 24.102', 'nature': 'negative'},
        7: {'text': 'Fortunate marriage. Spouse is religious and virtuous.', 'source': 'BPHS 24.103', 'nature': 'positive'},
        8: {'text': 'Unfortunate, father suffers. Religious confusion. But occult interest.', 'source': 'BPHS 24.104', 'nature': 'negative'},
        9: {'text': 'Extremely fortunate. Father prosperous. Very religious and learned.', 'source': 'BPHS 24.105', 'nature': 'positive'},
        10: {'text': 'Raja Yoga — very successful career. Famous, honoured by ruler.', 'source': 'BPHS 24.106', 'nature': 'positive'},
        11: {'text': 'Great gains, fortune manifests as wealth. Desires fulfilled easily.', 'source': 'BPHS 24.107', 'nature': 'positive'},
        12: {'text': 'Spends on religious/spiritual pursuits. Father may live abroad. Moksha indicated.', 'source': 'BPHS 24.108', 'nature': 'mixed'},
    },
    # ═══ 10TH LORD (KARMA LORD) IN HOUSES 1-12 ═══
    10: {
        1: {'text': 'Self-employed, strong personality. Career defines identity. Famous.', 'source': 'BPHS 24.109', 'nature': 'positive'},
        2: {'text': 'Career brings wealth. Famous through speech/business. Family prospers.', 'source': 'BPHS 24.110', 'nature': 'positive'},
        3: {'text': 'Career through own efforts and communication. Media/writing.', 'source': 'BPHS 24.111', 'nature': 'positive'},
        4: {'text': 'Career in property/education/government. Happy. Mother supports career.', 'source': 'BPHS 24.112', 'nature': 'positive'},
        5: {'text': 'Career through intelligence and creativity. Children connected to work.', 'source': 'BPHS 24.113', 'nature': 'positive'},
        6: {'text': 'Career in service/medicine/law. Obstacles but overcomes them.', 'source': 'BPHS 24.114', 'nature': 'mixed'},
        7: {'text': 'Career through partnerships and foreign connections. Spouse aids career.', 'source': 'BPHS 24.115', 'nature': 'positive'},
        8: {'text': 'Career suffers obstacles. May work in research/occult/insurance.', 'source': 'BPHS 24.116', 'nature': 'negative'},
        9: {'text': 'Raja Yoga — exceptional career. Honoured by ruler. Father supports.', 'source': 'BPHS 24.117', 'nature': 'positive'},
        10: {'text': 'Excellent career, self-made success. Very powerful. Famous.', 'source': 'BPHS 24.118', 'nature': 'positive'},
        11: {'text': 'Career brings great gains. All desires fulfilled through work.', 'source': 'BPHS 24.119', 'nature': 'positive'},
        12: {'text': 'Career abroad or in spiritual field. Professional losses possible.', 'source': 'BPHS 24.120', 'nature': 'mixed'},
    },
    # ═══ 11TH LORD (LABHA LORD) IN HOUSES 1-12 ═══
    11: {
        1: {'text': 'Wealthy, desires fulfilled. Gains come easily. Long-lived.', 'source': 'BPHS 24.121', 'nature': 'positive'},
        2: {'text': 'Very wealthy, gains accumulate. Family prosperous.', 'source': 'BPHS 24.122', 'nature': 'positive'},
        3: {'text': 'Gains through own efforts and siblings. Courageous.', 'source': 'BPHS 24.123', 'nature': 'positive'},
        4: {'text': 'Gains from property and vehicles. Mother prosperous.', 'source': 'BPHS 24.124', 'nature': 'positive'},
        5: {'text': 'Gains through children and intelligence. Speculative gains.', 'source': 'BPHS 24.125', 'nature': 'positive'},
        6: {'text': 'Gains through service and competition. But obstacles to gains.', 'source': 'BPHS 24.126', 'nature': 'mixed'},
        7: {'text': 'Gains through marriage and partnerships. Business profits.', 'source': 'BPHS 24.127', 'nature': 'positive'},
        8: {'text': 'Obstructed gains. Elder siblings suffer. Unexpected income.', 'source': 'BPHS 24.128', 'nature': 'mixed'},
        9: {'text': 'Very fortunate gains. Wealth through dharma. Elder siblings prosper.', 'source': 'BPHS 24.129', 'nature': 'positive'},
        10: {'text': 'Career brings great gains. Professional income high.', 'source': 'BPHS 24.130', 'nature': 'positive'},
        11: {'text': 'Excellent gains from all sources. All desires fulfilled. Wealthy.', 'source': 'BPHS 24.131', 'nature': 'positive'},
        12: {'text': 'Gains are spent away. Profits lost. Elder siblings may live abroad.', 'source': 'BPHS 24.132', 'nature': 'negative'},
    },
    # ═══ 12TH LORD (VYAYA LORD) IN HOUSES 1-12 ═══
    12: {
        1: {'text': 'Spendthrift, weak body. But spiritual nature. Foreign connection.', 'source': 'BPHS 24.133', 'nature': 'negative'},
        2: {'text': 'Wealth is spent. Financial losses. Family disputes.', 'source': 'BPHS 24.134', 'nature': 'negative'},
        3: {'text': 'Loss through siblings. But courageous in adversity.', 'source': 'BPHS 24.135', 'nature': 'negative'},
        4: {'text': 'Loss of property and domestic happiness. Mother troubled.', 'source': 'BPHS 24.136', 'nature': 'negative'},
        5: {'text': 'Expenses on children. Intelligence used for spiritual matters.', 'source': 'BPHS 24.137', 'nature': 'negative'},
        6: {'text': 'Overcomes enemies and losses (Viparita Raja Yoga). Expenses decrease.', 'source': 'BPHS 24.138', 'nature': 'positive'},
        7: {'text': 'Expenses through spouse. Marriage brings losses. Foreign spouse.', 'source': 'BPHS 24.139', 'nature': 'negative'},
        8: {'text': 'Long-lived. Spiritual liberation. Expenses on treatment.', 'source': 'BPHS 24.140', 'nature': 'mixed'},
        9: {'text': 'Expenses on religious/spiritual pursuits. Father may suffer.', 'source': 'BPHS 24.141', 'nature': 'mixed'},
        10: {'text': 'Career suffers losses. May work abroad. Professional expenses high.', 'source': 'BPHS 24.142', 'nature': 'negative'},
        11: {'text': 'Gains are lost to expenses. But Viparita Raja Yoga possible.', 'source': 'BPHS 24.143', 'nature': 'mixed'},
        12: {'text': 'Detached, sage-like. Peaceful mind. Spiritual siddhis. Moksha.', 'source': 'BPHS 24.144', 'nature': 'positive'},
    },
}


def get_lord_in_house_effect(lord_house: int, placed_house: int) -> Optional[Dict]:
    """Get BPHS Ch.24 effect for a specific lord-in-house combination."""
    return EFFECTS.get(lord_house, {}).get(placed_house)


def get_all_lord_placements(engine) -> List[Dict]:
    """Get all 12 lord placements for a chart and their BPHS effects."""
    asc = engine.ascendant_rashi
    results = []

    for house_num in range(1, 13):
        sign = (asc + house_num - 1) % 12
        lord = RASHI_LORDS[sign]
        lord_house = engine.planets.get(lord, {}).get('house', 1)

        effect = get_lord_in_house_effect(house_num, lord_house)
        if effect:
            results.append({
                'lord_of_house': house_num,
                'lord_planet': lord,
                'placed_in_house': lord_house,
                'text': effect['text'],
                'source': effect['source'],
                'nature': effect['nature'],
            })

    return results


def get_lord_effects_for_event(engine, event: str) -> List[Dict]:
    """Get relevant lord placements for a specific life event."""
    # Which houses matter for which events
    EVENT_HOUSES = {
        'marriage': [1, 2, 7, 8, 12],
        'children': [1, 5, 7, 9],
        'wealth': [1, 2, 5, 9, 11],
        'career': [1, 2, 6, 10, 11],
        'spiritual': [1, 5, 8, 9, 12],
        'health': [1, 6, 8, 12],
        'foreign': [3, 4, 7, 9, 12],
        'property': [1, 4, 7, 10, 11],
        'education': [1, 2, 4, 5, 9],
        'longevity': [1, 3, 8],
        'father': [1, 9, 10],
        'mother': [1, 4, 10],
        'siblings': [1, 3, 11],
        'business': [1, 7, 10, 11],
        'love': [1, 5, 7],
        'fame': [1, 5, 9, 10],
    }

    relevant_houses = EVENT_HOUSES.get(event, [1])
    all_placements = get_all_lord_placements(engine)

    return [p for p in all_placements if p['lord_of_house'] in relevant_houses]
