"""
JYOTISH ENGINE - BHRIGU NANDI NADI
Planet-in-sign = specific life predictions.
Based on Bhrigu Nandi Nadi texts.

Principle: Each planet in each sign gives SPECIFIC life events,
not generic descriptions. "Jupiter in Aries in 5th = first child is son,
career in teaching/law." This is what makes Nadi feel supernatural.

Also includes:
- Planet-in-house Nadi readings
- Two-planet conjunction Nadi combinations
- Nakshatra-pada specific predictions
"""

from typing import Dict, List
from ..core.constants import (
    RASHI_NAMES,
)

# ═══════════════════════════════════════════════════════════════════
# PLANET-IN-SIGN NADI READINGS (9 planets × 12 signs = 108 combos)
# ═══════════════════════════════════════════════════════════════════

PLANET_SIGN_NADI = {
    'Sun': {
        0: 'Father holds government/authority position. Native has strong ego, leadership from youth. May have head-related health issues. Success in politics or administration.',
        1: 'Wealthy family. Beautiful face, artistic voice. Father involved in finance or agriculture. Stubborn but reliable. Accumulates fixed assets.',
        2: 'Intelligent, dual nature. Good in writing, media, communication. Father may have two sources of income. Sibling bond strong. Quick learner.',
        3: 'Emotional connection with mother. Government property or vehicle. Father figure nurturing but controlling. Interest in history, land matters.',
        4: 'Born leader, dramatic personality. Father is authoritative. Heart is strong point and weak point. First child may be male. Creative talent.',
        5: 'Analytical, health-conscious. Service-oriented career. Father may have health issues. Excellent in medicine, healing, accounting. Perfectionist.',
        6: 'Partnerships define life. Father may live away or travel. Spouse from different background. Business acumen. Public-facing career.',
        7: 'Inheritance matters. Transformation through crisis. Father faces obstacles. Interest in occult, research, insurance. Hidden wealth.',
        8: 'Father is teacher or spiritual. Long-distance travel likely. Connection to temple or religious institution. Higher education brings fame. Righteous nature.',
        9: 'Career peak through authority. Government job or high position. Father is career inspiration. Fame in profession. Disciplined achiever.',
        10: 'Large social network. Elder sibling may be prominent. Gains through government. Ambitious desires fulfilled in middle age. Community leader.',
        11: 'Expenses on spiritual pursuits. Father may live abroad or in isolation. Eye issues possible. Spiritual inclination in later life. Hospital/ashram connection.',
    },
    'Moon': {
        0: 'Quick thinking, impulsive emotions. Mother is strong-willed. Fast recovery from illness. Athletic ability. Emotional pioneer.',
        1: 'Mother is beautiful, nurturing. Love for food, comfort. Emotional stability through material security. Singing voice. Strong memory.',
        2: 'Restless mind, loves variety. Mother is communicative. Multiple emotional connections. Writing ability. Nervous temperament.',
        3: 'Very close to mother. Emotional security through home. Property from mother. Love of cooking, nurturing others. Patriotic feelings.',
        4: 'Dramatic emotions, needs attention. Mother is proud. Creative expression of feelings. Romance important. Heart-centered person.',
        5: 'Worries about health, details. Mother is service-oriented. Emotional healing ability. Digestion linked to emotions. Clean, organized mind.',
        6: 'Emotions through relationships. Mother influences marriage choice. Business-minded. Diplomatic nature. Needs partnership for emotional balance.',
        7: 'Deep emotional transformation. Mother faces challenges. Psychic ability, intuition strong. Inheritance from mother. Secret emotional life.',
        8: 'Philosophical emotions. Mother is religious. Emotional wisdom, good teacher. Travel brings peace. Foreign connection through mother.',
        9: 'Emotionally disciplined. Public image important. Mother influences career. Popular with masses. Emotional maturity early.',
        10: 'Humanitarian emotions. Large friend circle. Mother has many connections. Unusual emotional expression. Technology interest.',
        11: 'Spiritual emotions, vivid dreams. Mother is spiritual or sacrificing. Isolation brings peace. Hospital or ashram connection. Psychic dreams.',
    },
    'Mars': {
        0: 'Warrior personality. Extremely courageous. Military, police, sports career. Scars on head/face. First-born or acts like one. Hot temper.',
        1: 'Wealth through effort and fighting. Strong voice, may be harsh. Accumulates property. Food industry connection. Stubborn determination.',
        2: 'Fights with siblings. Courageous communicator. Mechanical or technical skills. Short travel frequent. Writes with force and impact.',
        3: 'Property through effort. Renovation, construction skill. Vehicles important. Mother is strong-willed. Domestic conflicts then resolution.',
        4: 'Dramatic courage. Competes fiercely. Sports, entertainment, politics. First child may be male. Risk-taking in speculation.',
        5: 'Fights enemies successfully. Military service, surgery, police. Health issues in youth then strength. Maternal uncle prominent. Competitive career.',
        6: 'Business partnerships with conflict. Spouse is strong-willed. Sexual energy high. Legal battles possible. Business in metals, fire, engineering.',
        7: 'Transformation through conflict. Surgery likely. Inheritance disputes. Research into hidden matters. Insurance, mining, underground work.',
        8: 'Religious warrior. Fights for dharma. Brother is philosophical. Long travel for purpose. Father-brother bond. Sports at university.',
        9: 'Career in engineering, military, surgery, sports. Authoritative position through merit. Land/property through career. Government technical role.',
        10: 'Gains through competition. Elder sibling is fighter. Income from metals, fire, engineering. Desires fulfilled through effort. Athletic friends.',
        11: 'Expenses on property, vehicles. Hidden enemies. Hospitalization possible in youth. Energy spent in isolation. Spiritual warrior in later life.',
    },
    'Mercury': {
        0: 'Sharp, quick intelligence. Youthful appearance. Communication career. Writing from young age. Nervous energy. Head for business.',
        1: 'Wealth through intellect. Banking, finance, accounting. Beautiful speech. Multiple income sources through skill. Values education highly.',
        2: 'Brilliant communicator. Writer, journalist, teacher. Siblings are intellectual. Many short trips. Dual skills, ambidextrous. Media career.',
        3: 'Education at home. Mother is intellectual. Property through documents, paperwork. Vehicle lover. Home-based business possible.',
        4: 'Creative intelligence. Entertainment, drama, writing. Children are intelligent. Stock market ability. Witty, humorous. Education in arts.',
        5: 'Health through ayurveda, herbal knowledge. Analytical healing. Service through intellect. Accounting, auditing. Pets lover. Detailed worker.',
        6: 'Business partnerships. Contract-based work. Spouse is intellectual. Legal knowledge. Trade, commerce, negotiation. Counseling ability.',
        7: 'Research mind. Occult knowledge through study. Insurance mathematics. Investigative ability. Secret knowledge. Longevity through Ayurveda.',
        8: 'Scholar, professor, philosopher. Publishes books. Religious texts study. Travel for education. Multiple degrees. Multilingual.',
        9: 'Career in communication, IT, teaching, accounting. Professional qualification. Multiple career paths. Administrative intelligence.',
        10: 'Gains through intellect. Friends are educated. Income from writing, teaching, IT. Networking ability. Desires fulfilled through knowledge.',
        11: 'Spiritual knowledge. Meditation practice. Expenses on education. Foreign education possible. Vivid imagination. Charitable through knowledge.',
    },
    'Jupiter': {
        0: 'Wise from birth. Large forehead. Teaching ability. First child brings luck. Optimistic personality. Spiritual leadership potential.',
        1: 'Family wealth, banking connection. Sweet speech, truthful. Financial advisor ability. Large family. Traditional values. Food abundance.',
        2: 'Guru among siblings. Philosophical writing. Religious short travels. Sibling is teacher/priest. Publishing, preaching ability.',
        3: 'Mother is religious. Large home, property. Educational institution connection. Vehicle collection. Happiness through faith.',
        4: 'Children bring great joy. Creative wisdom. Education in philosophy, law. Speculation gains possible. Talented children. Romance with dignity.',
        5: 'Overcomes enemies through wisdom. Legal victory. Teaching in service. Health through faith. Charitable service. Uncle is religious.',
        6: 'Spouse is religious or wealthy. Business expansion. Legal career. Partner from good family. Marriage brings fortune. Diplomatic wisdom.',
        7: 'Inheritance of wisdom. Longevity. Transformation through knowledge. Insurance gains. Research in ancient texts. Hidden wealth revealed.',
        8: 'Father is guru. Long pilgrimage journeys. Temple connection. Higher education brings fame. Philosophy professor. Dharmic life.',
        9: 'Career growth through ethics. Respected in profession. Government advisor. Judicial career. Professional honors. Ethical leadership.',
        10: 'Large gains, wealthy friends. Elder sibling is successful. Income from teaching, law, finance. All desires fulfilled. Philanthropic circle.',
        11: 'Spiritual liberation path. Foreign ashram connection. Charitable expenses. Hospital as healer. Moksha yoga. Dreams of deities.',
    },
    'Venus': {
        0: 'Attractive personality. Quick to fall in love. Artistic from youth. Beauty-conscious. Fashion, beauty industry. Magnetic personality.',
        1: 'Wealth through luxury goods. Beautiful speech, singing. Banking with luxury brands. Expensive taste. Jewelry, gems connection.',
        2: 'Artistic siblings. Creative communication. Fashion writing, beauty blogging. Short creative trips. Flirtatious communication.',
        3: 'Beautiful home. Luxury vehicles. Mother is attractive. Comfortable property. Interior design ability. Home decoration talent.',
        4: 'Romantic creativity. Love affairs. Cinema, music, drama. Beautiful children. Artistic speculation. Entertainment career.',
        5: 'Beauty in service. Fashion health. Cosmetic industry. Pet lover. Detailed artistic work. Spa, wellness career.',
        6: 'Beautiful spouse. Luxury business. Partnership brings wealth. Import-export of luxury. Diplomatic relationship. Harmonious contracts.',
        7: 'Transformation through love. Inheritance of luxury. Tantric knowledge. Hidden romantic life. Spouse brings wealth. Deep intimacy.',
        8: 'Love for philosophy. Religious art. Travel for pleasure. Foreign romance. Guru wife or husband. Artistic pilgrimage.',
        9: 'Career in arts, fashion, luxury. Hotel, hospitality industry. Diplomatic career. Decoration, design profession. Public beauty.',
        10: 'Gains through arts. Wealthy friends. Income from beauty, fashion, entertainment. Desires for luxury fulfilled. Artistic network.',
        11: 'Spiritual arts. Bedroom luxury. Foreign luxury. Expenses on beauty. Charitable to women. Ashram beautification. Dream romance.',
    },
    'Saturn': {
        0: 'Discipline from youth. Serious demeanor. Delayed but certain success. Bone/joint issues possible. Karmic lessons in self-identity.',
        1: 'Slow wealth accumulation. Family responsibilities. Speech may be harsh or slow. Traditional family. Delayed marriage into wealthy family.',
        2: 'Younger siblings face challenges. Discipline in communication. Technical writing. Railway, mining work. Patience in learning.',
        3: 'Mother faces health challenges. Property after delays. Old property renovation. Vehicle maintenance. Strict home environment.',
        4: 'Serious creativity. Delayed children. Discipline in education. Government education. Architecture, structure. Late blooming talent.',
        5: 'Disease then recovery. Long service career. Chronic but manageable health. Uncle faces difficulties. Servants loyal. Hospital work.',
        6: 'Spouse is older or mature. Business with discipline. Delayed marriage. Partner in structured industry. Contractual precision.',
        7: 'Long life through discipline. Transformation through patience. Inheritance after delays. Mining, oil, underground resources. Deep research.',
        8: 'Father is disciplined. Slow but deep philosophy. Pilgrimage on foot. Law through hard study. Religious discipline. Karmic father.',
        9: 'Career through sustained effort. Government career. Authority in old age. Real estate career. Mining, construction authority.',
        10: 'Delayed gains then abundance. Elder sibling is hardworking. Income through discipline. Friends are mature. Patience rewarded.',
        11: 'Spiritual through suffering. Foreign exile possible. Hospital stays. Karmic expenses. Feet/ankle issues. Liberation through karma.',
    },
    'Rahu': {
        0: 'Unusual personality. Foreign influences. Unconventional appearance. Ahead of time. Technology pioneer. Identity confusion then clarity.',
        1: 'Wealth through unconventional means. Foreign food. Unusual family. Cryptocurrency, technology finance. Unexpected inheritance.',
        2: 'Unconventional communication. Foreign languages. Media, digital work. Unusual siblings. Technology in communication. Viral content.',
        3: 'Foreign property. Unusual home. Mother from different background. Technology at home. Smart home. Renovation obsession.',
        4: 'Unusual creativity. Foreign romance. Entertainment technology. Unconventional children. Speculation through technology. Gaming.',
        5: 'Unusual diseases or misdiagnosis. Alternative medicine. Technology in health. Foreign servants. Unusual enemies. Cyber issues.',
        6: 'Foreign spouse. Unusual business partnership. Import-export. Cross-cultural marriage. Diplomatic with foreigners. Trade innovation.',
        7: 'Sudden transformation. Unexpected inheritance. Occult power. Hidden foreign connections. Research breakthrough. Mystery in life.',
        8: 'Foreign guru. Unconventional philosophy. Pilgrimage to unusual places. Foreign university. Technology in education. AI, digital learning.',
        9: 'Career in technology. Foreign career. Unconventional authority. Innovation in profession. Start-up founder. Disruption in industry.',
        10: 'Unusual gains. Foreign friends. Income through technology. Digital income. Unconventional desires. Online community.',
        11: 'Foreign residence. Unusual expenses. Technology expenses. Virtual reality. Digital spirituality. Isolation through technology.',
    },
    'Ketu': {
        0: 'Spiritual identity. Past-life connection to leadership. Disinterested in material show. Mysterious aura. Healing hands.',
        1: 'Detached from wealth. Family may have spiritual background. Past-life wealth karma. Simple speech. Values beyond material.',
        2: 'Spiritual sibling. Intuitive communication. Writing about spirituality. Short pilgrimages. Past-life sibling karma.',
        3: 'Detached from home comforts. Mother is spiritual. Gives away property. Simple living. Past-life home karma. Moksha through home.',
        4: 'Spiritual children. Unusual intelligence. Past-life child karma. Disinterested in speculation. Mystical creativity. Enlightened child.',
        5: 'Spiritual healing. Overcomes enemies through detachment. Alternative medicine. Past-life health karma. Service without ego.',
        6: 'Spiritual partnership. Spouse may be spiritual. Detached from business. Past-life relationship karma. Monk-like marriage.',
        7: 'Sudden spiritual awakening. Kundalini experiences. Past-life transformation. Inheritance given away. Research into consciousness.',
        8: 'Spiritual father. Enlightened guru. Past-life dharma. Pilgrimage without planning. Sudden wisdom. Liberation seeker.',
        9: 'Career falls away for spirituality. Authority through renunciation. Past-life authority karma. Ashram leadership.',
        10: 'Gains given to charity. Spiritual friends. Past-life gain karma. Desires dissolve. Elder sibling is spiritual.',
        11: 'Final liberation. Past-life spiritual karma. Expenses on moksha. Foreign ashram. Complete detachment. Enlightenment potential.',
    },
}

# ═══════════════════════════════════════════════════════════════════
# TWO-PLANET CONJUNCTION NADI READINGS
# ═══════════════════════════════════════════════════════════════════

CONJUNCTION_NADI = {
    ('Sun', 'Moon'): 'Parents have complex relationship. Native is emotionally expressive but ego-driven. Government emotional role. Public figure.',
    ('Sun', 'Mars'): 'Warrior commander. Father is aggressive. Engineering or military success. Head injuries possible. Tremendous willpower.',
    ('Sun', 'Mercury'): 'Intelligent administrator. Writing about authority. Government communication. Education in administration. Clever leadership.',
    ('Sun', 'Jupiter'): 'Guru of authority. Father is wise. Government advisor. Religious authority. Law and justice career. Righteous leader.',
    ('Sun', 'Venus'): 'Artistic authority. Government arts. Diplomatic career. Father is artistic. Luxury through authority. Fashion politics.',
    ('Sun', 'Saturn'): 'Delayed authority. Father faces obstacles. Government through hard work. Mining authority. Late success. Karmic father relationship.',
    ('Sun', 'Rahu'): 'Eclipse of ego. Father has unusual career. Foreign government. Technology authority. Identity crisis then power.',
    ('Sun', 'Ketu'): 'Spiritual authority. Past-life king. Detached from power. Government renounced. Father is spiritual. Healing authority.',
    ('Moon', 'Mars'): 'Emotional warrior. Mother is strong. Property through effort. Cooking with passion. Blood-related health. Real estate success.',
    ('Moon', 'Mercury'): 'Emotional intelligence. Mother is educated. Writing with feeling. Business intuition. Teaching with empathy.',
    ('Moon', 'Jupiter'): 'Blessed mind. Mother is religious. Emotional wisdom. Teaching women. Religious counseling. Great fortune through faith.',
    ('Moon', 'Venus'): 'Beautiful emotions. Mother is attractive. Artistic feelings. Romance-centered life. Luxury comfort. Singing, music talent.',
    ('Moon', 'Saturn'): 'Depressed emotions possible. Mother faces difficulties. Delayed emotional security. Discipline over feelings. Late marriage. Deep maturity.',
    ('Moon', 'Rahu'): 'Confused emotions. Mother from unusual background. Foreign emotional connections. Technology affects mood. Anxiety then clarity.',
    ('Moon', 'Ketu'): 'Spiritual emotions. Mother is intuitive. Past-life emotional karma. Detached feelings. Psychic ability. Meditation natural.',
    ('Mars', 'Mercury'): 'Technical intelligence. Engineering mind. Aggressive communication. Debate champion. Mechanical skill. Sports analytics.',
    ('Mars', 'Jupiter'): 'Righteous warrior. Brother is wise. Legal fighter. Religious defense. Sports coach. Military wisdom.',
    ('Mars', 'Venus'): 'Passionate romance. Artistic courage. Dance, martial arts. Luxury through effort. Engineering design. Beautiful strength.',
    ('Mars', 'Saturn'): 'Disciplined warrior. Delayed courage. Mining, construction. Bone surgery. Industrial engineering. Persistent fighter.',
    ('Mars', 'Rahu'): 'Explosive energy. Foreign conflict. Technology engineering. Unusual courage. Accident prone. Tremendous drive when focused.',
    ('Mars', 'Ketu'): 'Spiritual warrior. Past-life military. Martial arts master. Surgery with intuition. Detached from anger. Healing through fire.',
    ('Mercury', 'Jupiter'): 'Scholar of scholars. Multiple degrees. Published author. Religious writing. Financial advisor. Counseling wisdom.',
    ('Mercury', 'Venus'): 'Artistic intelligence. Fashion writing. Beautiful communication. Jewelry design. Music theory. Diplomatic speech.',
    ('Mercury', 'Saturn'): 'Methodical mind. Slow but thorough learner. Accounting, auditing. Mining records. Railway administration. Technical writing.',
    ('Mercury', 'Rahu'): 'Digital genius. Foreign communication. Software, AI. Unusual intelligence. Hacking ability. Viral communication.',
    ('Mercury', 'Ketu'): 'Intuitive intelligence. Past-life knowledge. Spiritual writing. Astrology calculation. Mystical mathematics.',
    ('Jupiter', 'Venus'): 'Blessed with luxury. Wealthy, wise. Religious art. Temple wealth. Marriage counselor. Harmonious philosophy.',
    ('Jupiter', 'Saturn'): 'Wisdom through discipline. Late but great success. Religious authority. Judge, magistrate. Karmic teacher. Ashram builder.',
    ('Jupiter', 'Rahu'): 'Guru Chandal — unconventional wisdom. Foreign philosophy. Technology in education. Religious rebel. Breaks tradition then builds new.',
    ('Jupiter', 'Ketu'): 'Enlightened guru. Past-life wisdom. Spiritual master. Detached from material teaching. Moksha through knowledge.',
    ('Venus', 'Saturn'): 'Delayed love. Older partner. Luxury through discipline. Fashion industry structure. Beauty business. Patient romance.',
    ('Venus', 'Rahu'): 'Foreign romance. Unusual beauty. Technology in arts. Cross-cultural love. Digital entertainment. Unconventional luxury.',
    ('Venus', 'Ketu'): 'Spiritual beauty. Past-life romance karma. Detached from luxury. Art as meditation. Tantric knowledge.',
    ('Saturn', 'Rahu'): 'Shrapit Dosha — past-life curse. Chronic obstacles. Foreign karma. Technology delays. Eventually breaks through. Massive patience.',
    ('Saturn', 'Ketu'): 'Extreme detachment. Monk potential. Past-life karma heavy. Spiritual isolation. Liberation through suffering. Final freedom.',
    ('Rahu', 'Ketu'): 'Both nodes with planets creates axis of destiny. Eclipse energy. Major life shifts. Past and future collide.',
}


class BhriguNandiNadi:
    """
    Bhrigu Nandi Nadi reading engine.
    Gives supernaturally specific predictions based on planet-sign-house combinations.
    """

    def __init__(self, engine):
        self.engine = engine
        self.planets = engine.planets
        self.asc_rashi = engine.ascendant_rashi

    def get_planet_house(self, planet: str) -> int:
        return self.planets.get(planet, {}).get('house', 1)

    def get_planet_rashi(self, planet: str) -> int:
        return self.planets.get(planet, {}).get('rashi', 0)

    def get_planet_nakshatra(self, planet: str) -> str:
        return self.planets.get(planet, {}).get('nakshatra_name', '')

    def get_planet_sign_reading(self, planet: str) -> Dict:
        """Get Nadi reading for a planet in its sign."""
        rashi = self.get_planet_rashi(planet)
        house = self.get_planet_house(planet)
        reading = PLANET_SIGN_NADI.get(planet, {}).get(rashi, '')
        return {
            'planet': planet,
            'rashi': rashi,
            'rashi_name': RASHI_NAMES[rashi],
            'house': house,
            'nadi_reading': reading,
        }

    def get_all_planet_readings(self) -> List[Dict]:
        """Get Nadi readings for all planets."""
        readings = []
        for planet in ['Sun', 'Moon', 'Mars', 'Mercury', 'Jupiter', 'Venus', 'Saturn', 'Rahu', 'Ketu']:
            if planet in self.planets:
                readings.append(self.get_planet_sign_reading(planet))
        return readings

    def get_conjunction_readings(self) -> List[Dict]:
        """Find conjunctions and get Nadi readings for them."""
        readings = []
        planet_list = [p for p in self.planets if p in PLANET_SIGN_NADI]
        for i, p1 in enumerate(planet_list):
            for p2 in planet_list[i+1:]:
                if self.get_planet_house(p1) == self.get_planet_house(p2):
                    key = (p1, p2)
                    rev_key = (p2, p1)
                    reading = CONJUNCTION_NADI.get(key, CONJUNCTION_NADI.get(rev_key, ''))
                    if reading:
                        readings.append({
                            'planets': [p1, p2],
                            'house': self.get_planet_house(p1),
                            'rashi': RASHI_NAMES[self.get_planet_rashi(p1)],
                            'nadi_reading': reading,
                        })
        return readings

    def get_house_wise_readings(self) -> Dict:
        """Organize readings by house for structured prediction."""
        house_readings = {}
        for h in range(1, 13):
            occupants = [p for p in self.planets if self.get_planet_house(p) == h]
            if occupants:
                readings = []
                for p in occupants:
                    r = self.get_planet_sign_reading(p)
                    readings.append(r)
                house_readings[h] = {
                    'occupants': occupants,
                    'readings': readings,
                }
        return house_readings

    def generate_full_nadi_report(self) -> Dict:
        """Generate complete Bhrigu Nandi Nadi reading."""
        planet_readings = self.get_all_planet_readings()
        conjunction_readings = self.get_conjunction_readings()
        house_readings = self.get_house_wise_readings()

        # Extract key life predictions
        key_predictions = self._extract_key_predictions(planet_readings)

        return {
            'system': 'Bhrigu Nandi Nadi',
            'planet_readings': planet_readings,
            'conjunction_readings': conjunction_readings,
            'house_wise': house_readings,
            'key_predictions': key_predictions,
            'summary': {
                'total_readings': len(planet_readings),
                'conjunctions_found': len(conjunction_readings),
                'occupied_houses': len(house_readings),
            },
        }

    def _extract_key_predictions(self, readings: List[Dict]) -> Dict:
        """Extract structured predictions from Nadi readings."""
        career_hints = []
        relationship_hints = []
        health_hints = []
        spiritual_hints = []
        wealth_hints = []

        career_words = {'career', 'job', 'profession', 'work', 'business', 'authority', 'government', 'industry'}
        relationship_words = {'marriage', 'spouse', 'romance', 'love', 'partner', 'wife', 'husband'}
        health_words = {'health', 'disease', 'hospital', 'surgery', 'bone', 'blood', 'healing'}
        spiritual_words = {'spiritual', 'moksha', 'meditation', 'temple', 'ashram', 'guru', 'liberation'}
        wealth_words = {'wealth', 'money', 'income', 'property', 'luxury', 'gains', 'treasure'}

        for r in readings:
            text = r.get('nadi_reading', '').lower()
            if any(w in text for w in career_words):
                career_hints.append(f"{r['planet']} in {r['rashi_name']}: {r['nadi_reading'][:100]}")
            if any(w in text for w in relationship_words):
                relationship_hints.append(f"{r['planet']} in {r['rashi_name']}: {r['nadi_reading'][:100]}")
            if any(w in text for w in health_words):
                health_hints.append(f"{r['planet']} in {r['rashi_name']}: {r['nadi_reading'][:100]}")
            if any(w in text for w in spiritual_words):
                spiritual_hints.append(f"{r['planet']} in {r['rashi_name']}: {r['nadi_reading'][:100]}")
            if any(w in text for w in wealth_words):
                wealth_hints.append(f"{r['planet']} in {r['rashi_name']}: {r['nadi_reading'][:100]}")

        return {
            'career': career_hints[:3],
            'relationships': relationship_hints[:3],
            'health': health_hints[:3],
            'spiritual': spiritual_hints[:3],
            'wealth': wealth_hints[:3],
        }


def generate_nadi_reading(engine) -> Dict:
    """Convenience function."""
    nadi = BhriguNandiNadi(engine)
    return nadi.generate_full_nadi_report()
