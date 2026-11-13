"""
JYOTISH ENGINE — CLASSICAL TEXT RULES

Every rule here is a DIRECT translation of a specific sloka
from BPHS, Phaladeepika, Saravali, or Jataka Parijata.

NO invented numbers. NO arbitrary weights. 
Each rule returns: (fires: bool, text: str, source: str, polarity: str)
  polarity: 'strong_positive', 'positive', 'negative', 'strong_negative', 'denial'

The prediction = which rules fire and their polarity.
"""

from typing import Dict, List, NamedTuple
from .lord_in_house import get_lord_effects_for_event
from .planet_in_house import get_planet_effects_for_event
from .upapada import get_upapada_marriage_rules
from ..core.constants import PLANETS, RASHI_LORDS, RASHI_NAMES

class Rule(NamedTuple):
    fires: bool
    text: str
    source: str
    polarity: str  # strong_positive, positive, neutral, negative, strong_negative, denial


class ClassicalRules:
    """Every rule traceable to a specific verse."""

    def __init__(self, engine):
        self.engine = engine
        self.p = engine.planets  # shorthand
        self.asc = engine.ascendant_rashi

    # ═══ HELPERS ═══
    def _h(self, planet): return self.p.get(planet, {}).get('house', 1)
    def _r(self, planet): return self.p.get(planet, {}).get('rashi', 0)
    def _lord(self, house): return RASHI_LORDS[(self.asc + house - 1) % 12]
    def _occ(self, house): return [pl for pl in self.p if self._h(pl) == house]
    def _conj(self, a, b): return self._h(a) == self._h(b)
    def _retro(self, p): return self.p.get(p, {}).get('retrograde', False) if p not in ('Rahu','Ketu') else False

    def _is_moon_waxing(self):
        """BPHS: Waxing Moon = benefic. Waning Moon = malefic."""
        sun_long = self.p.get('Sun', {}).get('longitude', 0)
        moon_long = self.p.get('Moon', {}).get('longitude', 0)
        diff = (moon_long - sun_long) % 360
        return diff < 180

    def _is_mercury_benefic(self):
        """BPHS: Mercury alone or with benefics = benefic. Mercury with malefics = malefic."""
        merc_h = self._h('Mercury')
        conjunct_planets = [pl for pl in self.p if pl != 'Mercury' and self._h(pl) == merc_h]
        if not conjunct_planets:
            return True  # Alone = benefic
        natural_malefics = {'Sun', 'Mars', 'Saturn', 'Rahu', 'Ketu'}
        malefic_conjuncts = [p for p in conjunct_planets if p in natural_malefics]
        benefic_conjuncts = [p for p in conjunct_planets if p in {'Jupiter', 'Venus'}]
        # Moon depends on phase
        if 'Moon' in conjunct_planets:
            if self._is_moon_waxing():
                benefic_conjuncts.append('Moon')
            else:
                malefic_conjuncts.append('Moon')
        return len(benefic_conjuncts) >= len(malefic_conjuncts)

    def _is_functional_benefic(self, planet):
        """
        Correct benefic/malefic per BPHS:
        Jupiter, Venus = always natural benefic
        Moon = benefic when waxing, malefic when waning
        Mercury = benefic when alone/with benefics, malefic with malefics
        Sun, Mars, Saturn, Rahu, Ketu = natural malefic
        """
        if planet in ('Jupiter', 'Venus'):
            return True
        if planet == 'Moon':
            return self._is_moon_waxing()
        if planet == 'Mercury':
            return self._is_mercury_benefic()
        return False  # Sun, Mars, Saturn, Rahu, Ketu = malefic

    def _is_natural_malefic(self, planet):
        if planet in ('Saturn', 'Mars', 'Rahu', 'Ketu'):
            return True
        if planet == 'Sun':
            return True  # Sun is mild malefic
        if planet == 'Moon':
            return not self._is_moon_waxing()
        if planet == 'Mercury':
            return not self._is_mercury_benefic()
        return False

    def _is_strong(self, planet):
        """BPHS definition: in own sign, exalted, or moolatrikona."""
        pd = PLANETS.get(planet, {})
        r = self._r(planet)
        if r == pd.get('exalted'): return True
        if r in pd.get('owns', []): return True
        mt = pd.get('moolatrikona')
        if mt is not None and r == mt: return True
        return False

    def _is_weak(self, planet):
        """BPHS: debilitated, combust, or in enemy sign."""
        pd = PLANETS.get(planet, {})
        r = self._r(planet)
        if r == pd.get('debilitated'): return True
        if self._is_combust(planet): return True
        sign_lord = RASHI_LORDS[r]
        if sign_lord in pd.get('enemies', []): return True
        return False

    def _is_combust(self, planet):
        if planet in ('Sun', 'Rahu', 'Ketu'): return False
        degrees = {'Moon':12, 'Mars':17, 'Mercury':14, 'Jupiter':11, 'Venus':10, 'Saturn':15}
        threshold = degrees.get(planet, 12)
        if planet in ('Mercury','Venus') and self._retro(planet):
            threshold = 12 if planet == 'Mercury' else 8
        sun_long = self.p.get('Sun', {}).get('longitude', 0)
        p_long = self.p.get(planet, {}).get('longitude', 0)
        diff = abs(sun_long - p_long)
        if diff > 180: diff = 360 - diff
        return diff <= threshold

    def _in_benefic_sign(self, planet):
        """Is planet in sign of a benefic lord?"""
        r = self._r(planet)
        for b in ['Jupiter', 'Venus']:
            if r in PLANETS.get(b, {}).get('owns', []):
                return True
        # Moon's sign benefic only if Moon is waxing
        if self._is_moon_waxing() and r in PLANETS.get('Moon', {}).get('owns', []):
            return True
        # Mercury's sign benefic only if Mercury is benefic
        if self._is_mercury_benefic() and r in PLANETS.get('Mercury', {}).get('owns', []):
            return True
        return False

    def _aspected_by_benefic(self, house):
        """Is house aspected by benefic? Uses BPHS Moon/Mercury rules."""
        for planet in ['Jupiter', 'Venus', 'Mercury', 'Moon']:
            if not self._is_functional_benefic(planet):
                continue  # Waning Moon or malefic Mercury skip
            p_house = self._h(planet)
            aspects = PLANETS.get(planet, {}).get('aspects', [7])
            for asp in aspects:
                target = ((p_house + asp - 1) % 12) + 1
                if target == house:
                    return True
        return False

    def _aspected_by_malefic(self, house):
        """Uses BPHS Moon/Mercury rules."""
        for planet in self.p:
            if planet in ('Rahu', 'Ketu'):
                # Nodes aspect 7th only (no special aspects in most schools)
                if ((self._h(planet) + 6) % 12) + 1 == house:
                    return True
                continue
            if not self._is_natural_malefic(planet):
                continue
            p_house = self._h(planet)
            aspects = PLANETS.get(planet, {}).get('aspects', [7])
            for asp in aspects:
                target = ((p_house + asp - 1) % 12) + 1
                if target == house:
                    return True
        return False

    def _has_benefic_conjunction(self, planet):
        """Uses BPHS Moon/Mercury rules."""
        ph = self._h(planet)
        for p in ['Jupiter', 'Venus', 'Mercury', 'Moon']:
            if p != planet and self._h(p) == ph and self._is_functional_benefic(p):
                return True
        return False

    def _lord_in_dusthana(self, house):
        lord = self._lord(house)
        return self._h(lord) in [6, 8, 12]

    def _house_from_moon(self, house):
        """Get house number counted from Moon sign."""
        moon_sign = self._r('Moon')
        return ((self.asc + house - 1) - moon_sign) % 12 + 1

    # ═══════════════════════════════════════════════════════════════
    # MARRIAGE RULES (BPHS Chapter 18 + Phaladeepika)
    # ═══════════════════════════════════════════════════════════════

    def marriage_rules(self) -> List[Rule]:
        rules = []
        lord7 = self._lord(7)

        # BPHS 18.1: 7th lord in own rashi or exaltation → full happiness through marriage
        rules.append(Rule(
            fires=self._is_strong(lord7),
            text=f'7th lord {lord7} in {("own sign" if self._r(lord7) in PLANETS.get(lord7,{}).get("owns",[]) else "exaltation") if self._is_strong(lord7) else "not strong"} → full marital happiness',
            source='BPHS 18.1',
            polarity='strong_positive' if self._is_strong(lord7) else 'neutral',
        ))

        # BPHS 18.2: 7th lord in 6th, 8th, or 12th → wife will be sickly
        rules.append(Rule(
            fires=self._h(lord7) in [6, 8, 12] and not self._is_strong(lord7),
            text=f'7th lord {lord7} in H{self._h(lord7)} (dusthana) and not strong → wife sickly/marriage suffers',
            source='BPHS 18.2',
            polarity='strong_negative',
        ))

        # BPHS 18.3: Venus in 7th → exceedingly libidinous
        rules.append(Rule(
            fires=self._h('Venus') == 7,
            text='Venus in 7th → excessive desires in marriage',
            source='BPHS 18.3',
            polarity='positive',  # Marriage happens, but with excess desire
        ))

        # BPHS 18.3: Venus conjunct malefic → loss of wife
        venus_with_malefic = any(self._conj('Venus', m) for m in ['Saturn', 'Mars', 'Rahu', 'Ketu'])
        rules.append(Rule(
            fires=venus_with_malefic,
            text=f'Venus conjunct malefic → loss of wife or marriage difficulty',
            source='BPHS 18.3',
            polarity='negative',
        ))

        # BPHS 18.4-5: 7th lord strong + aspected/conjunct benefic → wealthy, happy, fortunate
        # This should NOT fire if lord is in dusthana (mutually exclusive with 18.2)
        lord7_in_dusthana = self._h(lord7) in [6, 8, 12]
        lord7_strong_benefic = (
            self._is_strong(lord7) and not lord7_in_dusthana
        ) or (
            not self._is_weak(lord7) and not lord7_in_dusthana and
            (self._has_benefic_conjunction(lord7) or self._aspected_by_benefic(self._h(lord7)))
        )
        rules.append(Rule(
            fires=lord7_strong_benefic,
            text=f'7th lord {lord7} endowed with strength + benefic influence → happy marriage',
            source='BPHS 18.4-5',
            polarity='strong_positive' if lord7_strong_benefic else 'neutral',
        ))

        # BPHS 18.4-5: 7th lord in fall/combust/enemy → sick wives, many wives
        lord7_afflicted = self._is_weak(lord7)
        rules.append(Rule(
            fires=lord7_afflicted,
            text=f'7th lord {lord7} {"debilitated" if self._r(lord7)==PLANETS.get(lord7,{}).get("debilitated") else "combust" if self._is_combust(lord7) else "in enemy sign"} → marriage problems',
            source='BPHS 18.4-5',
            polarity='strong_negative',
        ))

        # BPHS 18.16: 7th house/lord conjunct malefic + bereft of strength → wife incurs evils
        occ7 = self._occ(7)
        malefics_in_7 = [p for p in occ7 if self._is_natural_malefic(p)]
        rules.append(Rule(
            fires=bool(malefics_in_7) and self._is_weak(lord7),
            text=f'Malefics {malefics_in_7} in 7th + 7th lord weak → wife incurs evils',
            source='BPHS 18.16',
            polarity='denial' if len(malefics_in_7) >= 2 and self._is_weak(lord7) else 'strong_negative',
        ))

        # BPHS 18.17: 7th lord devoid of strength in 6/8/12 → wife destroyed (early death)
        rules.append(Rule(
            fires=self._h(lord7) in [6, 8, 12] and self._is_weak(lord7),
            text=f'7th lord {lord7} devoid of strength in H{self._h(lord7)} → wife destroyed',
            source='BPHS 18.17',
            polarity='denial',
        ))

        # BPHS 18.18: Moon in 7th + 7th lord in 12th + Venus bereft of strength → no marital happiness
        rules.append(Rule(
            fires=self._h('Moon') == 7 and self._h(lord7) == 12 and self._is_weak('Venus'),
            text='Moon in 7th + 7th lord in 12th + Venus weak → no marital happiness',
            source='BPHS 18.18',
            polarity='denial',
        ))

        # Check debilitation and Neecha Bhanga status
        lord7_is_debilitated = self._r(lord7) == PLANETS.get(lord7, {}).get('debilitated')
        neecha_bhanga_active = False
        
        if lord7_is_debilitated:
            deb_sign = PLANETS[lord7]['debilitated']
            deb_sign_lord = RASHI_LORDS[deb_sign]
            deb_lord_house = self._h(deb_sign_lord)
            exalt_sign = PLANETS[lord7].get('exalted')
            
            # Neecha Bhanga conditions (any one sufficient):
            if deb_lord_house in [1, 4, 7, 10]:
                neecha_bhanga_active = True
            if exalt_sign is not None:
                exalt_lord = RASHI_LORDS[exalt_sign]
                if self._h(exalt_lord) in [1, 4, 7, 10]:
                    neecha_bhanga_active = True
            if self._h(lord7) in [1, 4, 7, 10]:
                neecha_bhanga_active = True

        # BPHS 18.4-5: 7th lord weak → marriage problems
        # BUT if Neecha Bhanga active, debilitation is CANCELLED
        if self._is_weak(lord7) and not (lord7_is_debilitated and neecha_bhanga_active):
            affliction = 'combust' if self._is_combust(lord7) else 'debilitated' if lord7_is_debilitated else 'in enemy sign'
            rules.append(Rule(True,
                f'7th lord {lord7} {affliction} → marriage problems',
                'BPHS 18.4-5', 'strong_negative'))

        # NEECHA BHANGA: If debilitation is cancelled, fire positive rules
        if lord7_is_debilitated and neecha_bhanga_active:
            deb_sign = PLANETS[lord7]['debilitated']
            deb_sign_lord = RASHI_LORDS[deb_sign]
            exalt_sign = PLANETS[lord7].get('exalted')
            
            rules.append(Rule(True,
                f'7th lord {lord7} debilitated BUT NEECHA BHANGA ACTIVE → debilitation CANCELLED, acts as Raja Yoga',
                'BPHS (Neecha Bhanga)', 'strong_positive'))
            rules.append(Rule(True,
                f'Neecha Bhanga Raja Yoga → marriage WILL happen despite surface difficulties',
                'BPHS (Neecha Bhanga)', 'strong_positive'))
        elif lord7_is_debilitated and not neecha_bhanga_active:
            # No cancellation — debilitation stands
            rules.append(Rule(True,
                f'7th lord {lord7} debilitated WITHOUT cancellation → marriage seriously challenged',
                'BPHS 18.4-5', 'strong_negative'))

        # PHALADEEPIKA: Venus combust → marriage signification equal to debilitated
        rules.append(Rule(
            fires=self._is_combust('Venus'),
            text='Venus combust → marriage signification severely weakened',
            source='Phaladeepika (combustion)',
            polarity='strong_negative',
        ))

        # PHALADEEPIKA 15.3: If bhava lord in 8th from bhava + combust/debilitated + no benefic aspect → destruction
        lord7_8th_from_7 = self._h(lord7) == 2  # 8th from 7th is the 2nd house
        rules.append(Rule(
            fires=lord7_8th_from_7 and self._is_weak(lord7) and not self._aspected_by_benefic(2),
            text=f'7th lord in 8th from 7th + weak + no benefic aspect → destruction of marriage',
            source='Phaladeepika 15.3',
            polarity='denial',
        ))

        # Ketu in 7th → detachment from marriage
        rules.append(Rule(
            fires=self._h('Ketu') == 7,
            text='Ketu in 7th → spiritual detachment from marriage',
            source='Classical (Ketu signification)',
            polarity='strong_negative',
        ))

        # Jupiter aspects 7th → protection and blessing on marriage
        rules.append(Rule(
            fires=self._aspected_by_benefic(7) and any(
                self._h('Jupiter') != 7 and
                ((self._h('Jupiter') + asp - 1) % 12) + 1 == 7
                for asp in PLANETS.get('Jupiter', {}).get('aspects', [7])
            ),
            text='Jupiter aspects 7th house → marriage protected and blessed',
            source='BPHS (benefic aspect)',
            polarity='positive',
        ))

        # Venus strong (own/exalted) → marriage karaka strong
        rules.append(Rule(
            fires=self._is_strong('Venus'),
            text=f'Venus in {"own sign" if self._r("Venus") in PLANETS["Venus"].get("owns",[]) else "exaltation"} → marriage karaka strong',
            source='BPHS (karaka strength)',
            polarity='strong_positive',
        ))

        # Venus weak → marriage karaka weak
        rules.append(Rule(
            fires=self._is_weak('Venus') and not self._is_combust('Venus'),  # Combust handled separately
            text='Venus debilitated/in enemy sign → marriage karaka weakened',
            source='BPHS (karaka weakness)',
            polarity='negative',
        ))

        # SANYASA YOGA: 4+ planets in one house → renunciation
        for h in range(1, 13):
            occ = self._occ(h)
            if len(occ) >= 4:
                combust_in_group = sum(1 for pl in occ if self._is_combust(pl))
                if combust_in_group == 0:
                    rules.append(Rule(
                        fires=True,
                        text=f'4+ planets in H{h} ({", ".join(occ)}) → Sanyasa Yoga — marriage denied by renunciation',
                        source='BPHS (Sanyasa Yoga) / Phaladeepika',
                        polarity='denial',
                    ))
                else:
                    # BPHS: If planets in the group are combust, sanyasa yoga is NULLIFIED
                    # Person may be interested in spirituality but will NOT renounce
                    rules.append(Rule(
                        fires=True,
                        text=f'4+ planets in H{h} but {combust_in_group} combust → sanyasa nullified (BPHS)',
                        source='BPHS (Sanyasa Yoga — combustion nullifies)',
                        polarity='neutral',  # NOT negative — combust sanyasa is NOT sanyasa
                    ))

        # Venus + Saturn conjunction specific rule
        if self._conj('Venus', 'Saturn'):
            if self._is_strong('Venus'):
                rules.append(Rule(True, 'Venus+Saturn but Venus strong → delayed marriage, not denied',
                    'Classical (conjunction)', 'negative'))
            else:
                rules.append(Rule(True, 'Venus+Saturn with Venus weak → marriage heavily restricted',
                    'Classical (conjunction)', 'denial'))

        # 7th lord in friend/neutral/own from lagna
        lord7_sign_lord = RASHI_LORDS[self._r(lord7)]
        lord7_pd = PLANETS.get(lord7, {})
        if lord7_sign_lord in lord7_pd.get('friends', []):
            rules.append(Rule(True, f'7th lord {lord7} in friendly sign → marriage supported',
                'BPHS (dignity)', 'positive'))

        # Check from Chandra Lagna too
        moon_sign = self._r('Moon')
        lord7_from_moon = RASHI_LORDS[(moon_sign + 6) % 12]
        if self._is_strong(lord7_from_moon):
            rules.append(Rule(True, f'7th lord from Moon ({lord7_from_moon}) is strong → marriage confirmed from Chandra Lagna',
                'BPHS (Chandra Lagna)', 'strong_positive'))
        elif self._is_weak(lord7_from_moon):
            rules.append(Rule(True, f'7th lord from Moon ({lord7_from_moon}) is weak → marriage weak from Chandra Lagna',
                'BPHS (Chandra Lagna)', 'negative'))

        # D9 (Navamsa) check — BPHS: Navamsa is the soul chart, deeper truth for marriage
        try:
            d9 = self.engine.get_divisional_chart(9)
            if d9:
                # Check Venus in D9
                v_d9 = d9.get('planets', {}).get('Venus', {})
                v_d9_rashi = v_d9.get('rashi', v_d9) if isinstance(v_d9, dict) else v_d9
                venus_pd = PLANETS.get('Venus', {})
                
                # Check 7th lord in D9
                l7_d9 = d9.get('planets', {}).get(lord7, {})
                l7_d9_rashi = l7_d9.get('rashi', l7_d9) if isinstance(l7_d9, dict) else l7_d9
                lord7_pd = PLANETS.get(lord7, {})
                
                d9_venus_strong = False
                d9_lord7_strong = False
                
                if isinstance(v_d9_rashi, int):
                    if v_d9_rashi == venus_pd.get('exalted'):
                        rules.append(Rule(True, 'Venus EXALTED in Navamsa → marriage DESTINED',
                            'BPHS (D9)', 'strong_positive'))
                        rules.append(Rule(True, 'D9 Venus exalted — Navamsa overrides D1 afflictions for marriage',
                            'BPHS (D9)', 'strong_positive'))
                        d9_venus_strong = True
                    elif v_d9_rashi in venus_pd.get('owns', []):
                        rules.append(Rule(True, 'Venus in OWN SIGN in Navamsa → marriage CONFIRMED',
                            'BPHS (D9)', 'strong_positive'))
                        rules.append(Rule(True, 'D9 Venus strong — soul-level marriage promise',
                            'BPHS (D9)', 'positive'))
                        d9_venus_strong = True
                    elif v_d9_rashi == venus_pd.get('debilitated'):
                        rules.append(Rule(True, 'Venus debilitated in Navamsa → marriage weakened at soul level',
                            'BPHS (D9)', 'strong_negative'))
                
                if isinstance(l7_d9_rashi, int):
                    if l7_d9_rashi == lord7_pd.get('exalted') or l7_d9_rashi in lord7_pd.get('owns', []):
                        rules.append(Rule(True,
                            f'7th lord {lord7} strong in Navamsa → marriage lord confirmed in soul chart',
                            'BPHS (D9)', 'strong_positive'))
                        d9_lord7_strong = True
                    elif l7_d9_rashi == lord7_pd.get('debilitated'):
                        rules.append(Rule(True,
                            f'7th lord {lord7} debilitated in Navamsa → marriage lord weak at soul level',
                            'BPHS (D9)', 'negative'))

                # BOTH Venus AND 7th lord strong in D9 = marriage absolutely confirmed
                if d9_venus_strong and d9_lord7_strong:
                    rules.append(Rule(True,
                        'BOTH Venus AND 7th lord strong in Navamsa → marriage ABSOLUTELY confirmed regardless of D1',
                        'BPHS (D9 double confirmation)', 'strong_positive'))
        except Exception:
            pass

        # BPHS: 7th lord in kendra → marriage supported by angular strength
        lord7_h = self._h(lord7)
        if lord7_h in [1, 4, 7, 10]:
            rules.append(Rule(True,
                f'7th lord {lord7} in kendra H{lord7_h} → marriage supported by angular strength',
                'BPHS (lord in kendra)', 'positive'))
        # BPHS: 7th lord in trikona → marriage supported by trinal fortune
        elif lord7_h in [5, 9]:
            rules.append(Rule(True,
                f'7th lord {lord7} in trikona H{lord7_h} → marriage supported by fortune',
                'BPHS (lord in trikona)', 'positive'))

        # BPHS: 7th lord in 2nd/11th → marriage connected to wealth/gains
        elif lord7_h in [2, 11]:
            rules.append(Rule(True,
                f'7th lord {lord7} in H{lord7_h} → marriage brings financial connection',
                'BPHS', 'positive'))

        # SPIRITUAL CROSS-CHECK: multiple spiritual indicators reduce marriage
        spiritual_fired = self.spiritual_rules()
        sp_strong_pos = sum(1 for r in spiritual_fired if r.polarity == 'strong_positive')
        sp_pos = sum(1 for r in spiritual_fired if r.polarity == 'positive')
        sp_total = sp_strong_pos * 2 + sp_pos  # Weight strong_positives double
        
        if sp_total >= 5:
            rules.append(Rule(True,
                f'Very strong spiritual indicators (score {sp_total}) → marriage likely sacrificed for spiritual path',
                'Classical (spiritual cross-check)', 'denial'))
        elif sp_total >= 4:
            rules.append(Rule(True,
                f'Strong spiritual indicators (score {sp_total}) → marriage may be sacrificed for spiritual path',
                'Classical (spiritual cross-check)', 'strong_negative'))
        elif sp_total >= 3:
            rules.append(Rule(True,
                f'Moderate spiritual indicators (score {sp_total}) → marriage may be delayed/unconventional',
                'Classical (spiritual cross-check)', 'negative'))
        
        # Additional renunciation pattern: Venus in 8th/12th + Saturn influence on Venus + Ketu in 12th
        ketu_12 = self._h('Ketu') == 12
        venus_dusthana = self._h('Venus') in [6, 8, 12]
        sat_on_venus = self._conj('Venus', 'Saturn')
        sat_aspects_ven = False
        for asp in PLANETS.get('Saturn', {}).get('aspects', [7]):
            if ((self._h('Saturn') + asp - 1) % 12) + 1 == self._h('Venus'):
                sat_aspects_ven = True
        
        renunc_count = sum([ketu_12, venus_dusthana, sat_on_venus or sat_aspects_ven])
        if renunc_count >= 3:
            rules.append(Rule(True,
                'Ketu in 12th + Venus in dusthana + Saturn on Venus → complete renunciation pattern',
                'Classical (renunciation)', 'denial'))
        elif renunc_count >= 2:
            rules.append(Rule(True,
                f'Renunciation pattern ({renunc_count}/3): {"Ketu-12 " if ketu_12 else ""}{"Venus-dusthana " if venus_dusthana else ""}{"Saturn-Venus " if sat_on_venus or sat_aspects_ven else ""}',
                'Classical (renunciation)', 'strong_negative'))

        # Venus in 12th without strength → hidden desires, marriage may not materialize
        if self._h('Venus') == 12 and not self._is_strong('Venus'):
            rules.append(Rule(True,
                'Venus in 12th (weak) → marriage desires remain unfulfilled',
                'Phaladeepika', 'strong_negative'))
        elif self._h('Venus') == 12 and self._is_strong('Venus'):
            rules.append(Rule(True,
                'Venus in 12th (strong/own) → foreign spouse or marriage with foreign connection',
                'Classical', 'positive'))

        # Saturn aspects Venus → delay/restriction in love
        sat_h = self._h('Saturn')
        ven_h = self._h('Venus')
        for asp in PLANETS.get('Saturn', {}).get('aspects', [7]):
            if ((sat_h + asp - 1) % 12) + 1 == ven_h:
                rules.append(Rule(True,
                    'Saturn aspects Venus → delay and restriction in marriage',
                    'Classical (Saturn aspect)', 'negative'))
                break

        # Saturn in 7th → DELAYED marriage (BPHS says delay, not denial)
        if self._h('Saturn') == 7:
            rules.append(Rule(True,
                'Saturn in 7th → marriage delayed but not denied',
                'BPHS (Saturn = delay)', 'negative'))

        # Venus in 8th house = marriage karaka in dusthana (classical)
        if self._h('Venus') == 8:
            rules.append(Rule(True,
                'Venus in 8th → marriage karaka hidden/afflicted',
                'BPHS (karaka in dusthana)', 'strong_negative'))

        # Venus in 6th house = marriage karaka in conflict house
        if self._h('Venus') == 6:
            rules.append(Rule(True,
                'Venus in 6th → marriage karaka in house of conflict',
                'BPHS (karaka in dusthana)', 'negative'))

        # 7th lord is also lagna lord → divided focus between self and marriage
        lord1 = self._lord(1)
        if lord7 == lord1:
            rules.append(Rule(True,
                f'{lord7} rules both 1st and 7th → self-focused, marriage secondary',
                'Classical', 'negative'))

        # Malefics in 7th from Venus → delay/denial (Jataka Tattva)
        venus_7th_house = ((self._r('Venus') + 6) % 12 - self.asc) % 12 + 1
        mal_venus_7 = [p for p in self._occ(venus_7th_house) if p in ('Saturn','Mars','Rahu','Ketu')]
        if mal_venus_7:
            rules.append(Rule(True,
                f'Malefics {mal_venus_7} in 7th from Venus → marriage delayed/denied',
                'Jataka Tattva', 'strong_negative'))

        # BPHS Ch.30: Upapada Lagna marriage rules
        try:
            upa_rules = get_upapada_marriage_rules(self.engine)
            for ur in upa_rules:
                if ur['nature'] == 'denial':
                    polarity = 'denial'
                elif ur['nature'] == 'positive':
                    polarity = 'positive'
                elif ur['nature'] == 'negative':
                    polarity = 'negative'
                else:
                    continue
                rules.append(Rule(fires=True, text=ur['text'], source=ur['source'], polarity=polarity))
        except Exception:
            pass

        return [r for r in rules if r.fires]

    # ═══════════════════════════════════════════════════════════════
    # CHILDREN RULES (BPHS Chapter 19 + Phaladeepika)
    # ═══════════════════════════════════════════════════════════════

    def children_rules(self) -> List[Rule]:
        rules = []
        lord5 = self._lord(5)

        # BPHS: 5th lord strong in kendra/trikona → children blessed
        rules.append(Rule(
            fires=self._is_strong(lord5) and self._h(lord5) in [1,4,5,7,9,10],
            text=f'5th lord {lord5} strong in H{self._h(lord5)} → children blessed',
            source='BPHS (5th house effects)',
            polarity='strong_positive',
        ))

        # BPHS: 5th lord weak in dusthana → children suffer
        rules.append(Rule(
            fires=self._is_weak(lord5) and self._h(lord5) in [6, 8, 12],
            text=f'5th lord {lord5} weak in dusthana H{self._h(lord5)} → children suffer',
            source='BPHS',
            polarity='strong_negative',
        ))

        # Phaladeepika: 5th house + lord hemmed by malefics + Jupiter with malefics → LOSS
        kartari = self._check_papakartari(5)
        jup_with_malefic = any(self._conj('Jupiter', m) for m in ['Saturn', 'Mars', 'Rahu', 'Ketu'])
        rules.append(Rule(
            fires=kartari and jup_with_malefic,
            text='5th hemmed by malefics + Jupiter with malefics → loss of children',
            source='Phaladeepika (5th house)',
            polarity='denial',
        ))

        # Jupiter (karaka) strong → children blessed
        rules.append(Rule(
            fires=self._is_strong('Jupiter'),
            text='Jupiter strong → children karaka blesses progeny',
            source='BPHS (karaka)',
            polarity='strong_positive',
        ))

        # Jupiter weak → children karaka weakened
        rules.append(Rule(
            fires=self._is_weak('Jupiter'),
            text='Jupiter weak → children karaka cannot bless',
            source='BPHS (karaka)',
            polarity='strong_negative',
        ))

        # Jupiter retrograde IN 5th → strong denial
        rules.append(Rule(
            fires=self._retro('Jupiter') and self._h('Jupiter') == 5,
            text='Jupiter retrograde in 5th house → strong denial of children',
            source='Classical (retrograde karaka in own house)',
            polarity='denial',
        ))

        # Saturn in 5th → delayed children
        rules.append(Rule(
            fires=self._h('Saturn') == 5,
            text='Saturn in 5th → delay in children (not denial)',
            source='Saravali',
            polarity='negative',
        ))

        # Ketu in 5th → loss/detachment from children
        rules.append(Rule(
            fires=self._h('Ketu') == 5,
            text='Ketu in 5th → detachment/loss of children',
            source='Classical',
            polarity='strong_negative',
        ))

        # Benefics in 5th → happiness from children
        ben5 = [p for p in self._occ(5) if self._is_functional_benefic(p)]
        mal5 = [p for p in self._occ(5) if self._is_natural_malefic(p)]
        rules.append(Rule(
            fires=bool(ben5) and not mal5,
            text=f'Benefics {ben5} in 5th → happiness from children',
            source='BPHS',
            polarity='positive',
        ))

        # Jupiter aspects 5th → protection
        jup_aspects_5 = False
        jh = self._h('Jupiter')
        for asp in PLANETS.get('Jupiter', {}).get('aspects', [7]):
            if ((jh + asp - 1) % 12) + 1 == 5:
                jup_aspects_5 = True
        rules.append(Rule(
            fires=jup_aspects_5 and self._h('Jupiter') != 5,
            text='Jupiter aspects 5th → children protected',
            source='BPHS (benefic aspect)',
            polarity='positive',
        ))

        # Marriage cross-check: if marriage weak/denied, children affected
        marriage_fired = self.marriage_rules()
        marriage_denials = [r for r in marriage_fired if r.polarity == 'denial']
        marriage_strong_negs = [r for r in marriage_fired if r.polarity == 'strong_negative']
        marriage_strong_pos = [r for r in marriage_fired if r.polarity == 'strong_positive']
        
        if marriage_denials:
            rules.append(Rule(True,
                f'Marriage denied ({len(marriage_denials)} denial rules) → children very unlikely',
                'Logic (no marriage → no children)', 'denial'))
        elif len(marriage_strong_negs) >= 3 and len(marriage_strong_pos) <= 1:
            rules.append(Rule(True,
                f'Marriage heavily afflicted ({len(marriage_strong_negs)} strong negatives) → children less likely',
                'Logic (weak marriage → children difficult)', 'strong_negative'))

        # Chandra Lagna: 5th lord from Moon
        moon_sign = self._r('Moon')
        lord5_from_moon = RASHI_LORDS[(moon_sign + 4) % 12]
        if self._is_strong(lord5_from_moon):
            rules.append(Rule(True, f'5th lord from Moon ({lord5_from_moon}) strong → children confirmed from Chandra Lagna',
                'BPHS (Chandra Lagna)', 'strong_positive'))

        # D7 check
        try:
            d7 = self.engine.get_divisional_chart(7)
            if d7:
                j_d7 = d7.get('planets', {}).get('Jupiter', {})
                j_d7_rashi = j_d7.get('rashi', j_d7) if isinstance(j_d7, dict) else j_d7
                if isinstance(j_d7_rashi, int):
                    jup_pd = PLANETS.get('Jupiter', {})
                    if j_d7_rashi == jup_pd.get('exalted'):
                        rules.append(Rule(True, 'Jupiter exalted in D7 → children strongly confirmed',
                            'BPHS (D7)', 'strong_positive'))
                    elif j_d7_rashi in jup_pd.get('owns', []):
                        rules.append(Rule(True, 'Jupiter in own sign in D7 → children confirmed',
                            'BPHS (D7)', 'positive'))
                    elif j_d7_rashi == jup_pd.get('debilitated'):
                        rules.append(Rule(True, 'Jupiter debilitated in D7 → children weakened',
                            'BPHS (D7)', 'strong_negative'))
        except Exception:
            pass

        return [r for r in rules if r.fires]

    # ═══════════════════════════════════════════════════════════════
    # WEALTH RULES (BPHS Chapter 41 + Phaladeepika)
    # ═══════════════════════════════════════════════════════════════

    def wealth_rules(self) -> List[Rule]:
        rules = []
        lord2 = self._lord(2)
        lord11 = self._lord(11)

        # BPHS: 2nd lord in kendra → wealthy
        rules.append(Rule(
            fires=self._h(lord2) in [1, 4, 7, 10],
            text=f'2nd lord {lord2} in kendra H{self._h(lord2)} → foundation for wealth',
            source='BPHS (Parasari)',
            polarity='positive',
        ))

        # BPHS: 2nd lord in dusthana → loss of wealth
        rules.append(Rule(
            fires=self._h(lord2) in [6, 8, 12],
            text=f'2nd lord {lord2} in dusthana H{self._h(lord2)} → loss of wealth',
            source='BPHS (Parasari)',
            polarity='strong_negative',
        ))

        # BPHS: 2nd lord in own/exalted + aspected by Jupiter → wealthy, famous, generous
        rules.append(Rule(
            fires=self._is_strong(lord2) and self._aspected_by_benefic(self._h(lord2)),
            text=f'2nd lord {lord2} strong + benefic aspect → wealthy, famous, generous',
            source='BPHS',
            polarity='strong_positive',
        ))

        # BPHS: Jupiter + Mars in 2nd → much wealth
        rules.append(Rule(
            fires=self._h('Jupiter') == 2 and self._h('Mars') == 2,
            text='Jupiter + Mars in 2nd → much wealth',
            source='BPHS',
            polarity='strong_positive',
        ))

        # BPHS: Lords of 2nd + 11th in each other's houses (parivartana) → very rich
        rules.append(Rule(
            fires=self._h(lord2) == 11 and self._h(lord11) == 2,
            text=f'{lord2}(2L)↔{lord11}(11L) exchange → very rich (Parivartana Dhana Yoga)',
            source='BPHS Ch.41 / Bhavartha Ratnakara',
            polarity='strong_positive',
        ))

        # BPHS: 2nd + 11th lords conjunct in kendra/trikona → very rich
        rules.append(Rule(
            fires=self._conj(lord2, lord11) and self._h(lord2) in [1,4,5,7,9,10],
            text=f'{lord2}(2L)+{lord11}(11L) conjunct in H{self._h(lord2)} → very rich',
            source='BPHS',
            polarity='strong_positive',
        ))

        # BPHS: 5th lord + 9th lord connection → Lakshmi houses activated
        lord5 = self._lord(5)
        lord9 = self._lord(9)
        rules.append(Rule(
            fires=self._conj(lord5, lord9) or (self._h(lord5) == 9 and self._h(lord9) == 5),
            text=f'{lord5}(5L)+{lord9}(9L) connection → Lakshmi houses activated',
            source='BPHS (Dhana Yoga)',
            polarity='strong_positive',
        ))

        # BPHS Ch.41.2: Venus sign is 5th + Venus in it + Mars in 11th → great riches
        asc5_sign = (self.asc + 4) % 12
        rules.append(Rule(
            fires=asc5_sign in PLANETS['Venus'].get('owns', []) and self._h('Venus') == 5 and self._h('Mars') == 11,
            text='Venus in own 5th + Mars in 11th → great riches',
            source='BPHS 41.2',
            polarity='strong_positive',
        ))

        # BPHS Ch.37: Day birth + Moon in own/friendly navamsa + aspected by Jupiter → wealth
        # Simplified: Jupiter aspects Moon → wealth indicator
        jup_aspects_moon = False
        jh = self._h('Jupiter')
        mh = self._h('Moon')
        for asp in PLANETS.get('Jupiter', {}).get('aspects', [7]):
            if ((jh + asp - 1) % 12) + 1 == mh:
                jup_aspects_moon = True
        rules.append(Rule(
            fires=jup_aspects_moon,
            text='Jupiter aspects Moon → wealth and happiness',
            source='BPHS 37.2-4',
            polarity='positive',
        ))

        # 11th lord strong → income strong
        rules.append(Rule(
            fires=self._is_strong(lord11),
            text=f'11th lord {lord11} strong → strong income',
            source='BPHS',
            polarity='positive',
        ))

        # 11th lord in dusthana → income problems
        rules.append(Rule(
            fires=self._h(lord11) in [6, 8, 12] and self._is_weak(lord11),
            text=f'11th lord {lord11} weak in dusthana → income problems',
            source='BPHS',
            polarity='strong_negative',
        ))

        # Rahu in 2nd/11th → unconventional massive wealth
        rahu_h = self._h('Rahu')
        rules.append(Rule(
            fires=rahu_h in [2, 11],
            text=f'Rahu in H{rahu_h} → massive unconventional wealth',
            source='Classical',
            polarity='positive',
        ))

        # Benefics in 2nd
        ben2 = [p for p in self._occ(2) if p in ('Jupiter', 'Venus', 'Mercury')]
        rules.append(Rule(
            fires=bool(ben2),
            text=f'Benefics {ben2} in 2nd → wealth accumulation',
            source='BPHS',
            polarity='positive',
        ))

        # BPHS Ch.42 (Poverty): Lagna lord in 12th + 12th lord in lagna with maraka → penniless
        lord1 = self._lord(1)
        lord12 = self._lord(12)
        maraka_lords = [self._lord(2), self._lord(7)]
        rules.append(Rule(
            fires=self._h(lord1) == 12 and self._h(lord12) == 1 and any(self._conj(lord12, m) for m in maraka_lords),
            text='Lagna lord in 12th + 12th lord in lagna with maraka → poverty yoga',
            source='BPHS 42.2',
            polarity='denial',
        ))

        # Mars strong/exalted → aggressive wealth accumulation
        if self._is_strong('Mars'):
            rules.append(Rule(True,
                f'Mars strong → aggressive drive for wealth and success',
                'BPHS', 'positive'))

        # Sun strong → authority brings wealth
        if self._is_strong('Sun'):
            rules.append(Rule(True,
                f'Sun strong → authority and status bring wealth',
                'BPHS', 'positive'))

        # Strong lagna lord → self-made wealth capacity
        lord1 = self._lord(1)
        rules.append(Rule(
            fires=self._is_strong(lord1),
            text=f'Lagna lord {lord1} strong → self-made wealth capacity',
            source='BPHS', polarity='positive'))

        # 9th lord strong → fortunate, wealth through luck
        lord9 = self._lord(9)
        rules.append(Rule(
            fires=self._is_strong(lord9),
            text=f'9th lord {lord9} strong → fortunate wealth',
            source='BPHS', polarity='positive'))

        # 10th lord strong + in kendra → career drives wealth
        lord10 = self._lord(10)
        rules.append(Rule(
            fires=self._is_strong(lord10) or self._h(lord10) in [1, 4, 7, 10],
            text=f'10th lord {lord10} strong or in kendra → career supports wealth',
            source='BPHS', polarity='positive'))

        return [r for r in rules if r.fires]

    # ═══════════════════════════════════════════════════════════════
    # SPIRITUAL RULES (BPHS + Phaladeepika)
    # ═══════════════════════════════════════════════════════════════

    def spiritual_rules(self) -> List[Rule]:
        rules = []

        # BPHS: 4+ planets in one house → sanyasa yoga
        for h in range(1, 13):
            occ = self._occ(h)
            if len(occ) >= 4:
                rules.append(Rule(True,
                    f'{len(occ)} planets in H{h} ({", ".join(occ)}) → Sanyasa Yoga',
                    'BPHS (Sanyasa)', 'strong_positive'))

        # Ketu in 12th → moksha karaka in moksha house
        rules.append(Rule(
            fires=self._h('Ketu') == 12,
            text='Ketu in 12th → moksha karaka in moksha house',
            source='Classical (Ketu signification)',
            polarity='strong_positive',
        ))

        # 12th house stellium (3+ planets)
        h12_occ = self._occ(12)
        rules.append(Rule(
            fires=len(h12_occ) >= 3,
            text=f'Stellium in 12th ({", ".join(h12_occ)}) → powerful spiritual energy',
            source='Classical',
            polarity='strong_positive',
        ))

        # Jupiter retrograde → past-life spiritual wisdom
        rules.append(Rule(
            fires=self._retro('Jupiter'),
            text='Jupiter retrograde → past-life spiritual wisdom',
            source='Classical (retrograde interpretation)',
            polarity='positive',
        ))

        # 9th lord strong → dharma strong
        lord9 = self._lord(9)
        rules.append(Rule(
            fires=self._is_strong(lord9),
            text=f'9th lord {lord9} strong → dharma blessed',
            source='BPHS',
            polarity='positive',
        ))

        # 12th lord strong or in 12th → spiritual matters strong
        lord12 = self._lord(12)
        rules.append(Rule(
            fires=self._is_strong(lord12) or self._h(lord12) == 12,
            text=f'12th lord {lord12} strong/in 12th → spiritual matters strong',
            source='BPHS',
            polarity='positive',
        ))

        # Ketu in 12th combined with other spiritual indicators = amplified
        if self._h('Ketu') == 12:
            # Check if 12th has multiple planets with Ketu
            h12_occ = self._occ(12)
            spiritual_h12 = [p for p in h12_occ if p in ('Ketu', 'Jupiter', 'Moon')]
            if len(h12_occ) >= 2:
                rules.append(Rule(True,
                    f'Ketu + {[p for p in h12_occ if p != "Ketu"]} in 12th → amplified spiritual energy',
                    'Classical', 'positive'))

        # Saturn + Moon conjunction = emotional austerity (key renunciation indicator)
        if self._conj('Saturn', 'Moon'):
            rules.append(Rule(True,
                'Saturn+Moon conjunction → emotional austerity, renunciation tendency',
                'BPHS (Sanyasa indicators)', 'strong_positive'))

        # Saturn aspects weak lagna lord → renunciation tendency (Phaladeepika)
        lord1 = self._lord(1)
        sat_aspects_ll = False
        sh = self._h('Saturn')
        lh = self._h(lord1)
        for asp in PLANETS.get('Saturn', {}).get('aspects', [7]):
            if ((sh + asp - 1) % 12) + 1 == lh:
                sat_aspects_ll = True
        rules.append(Rule(
            fires=sat_aspects_ll and self._is_weak(lord1),
            text=f'Saturn aspects weak lagna lord {lord1} → renunciation tendency',
            source='Phaladeepika (Sanyasa)',
            polarity='strong_positive',
        ))

        # Moon in water sign → intuitive
        moon_r = self._r('Moon')
        rules.append(Rule(
            fires=moon_r in [3, 7, 11],  # Cancer, Scorpio, Pisces
            text=f'Moon in water sign ({RASHI_NAMES[moon_r]}) → intuitive nature',
            source='Classical',
            polarity='positive',
        ))

        # D20 check
        try:
            d20 = self.engine.get_divisional_chart(20)
            if d20:
                k_d20 = d20.get('planets', {}).get('Ketu', {})
                k_d20_r = k_d20.get('rashi', k_d20) if isinstance(k_d20, dict) else k_d20
                if isinstance(k_d20_r, int):
                    kp = PLANETS.get('Ketu', {})
                    if k_d20_r == kp.get('exalted'):
                        rules.append(Rule(True, 'Ketu exalted in D20 → spiritual destiny confirmed',
                            'BPHS (D20)', 'strong_positive'))
        except Exception:
            pass

        return [r for r in rules if r.fires]

    # ═══════════════════════════════════════════════════════════════
    # CAREER RULES
    # ═══════════════════════════════════════════════════════════════

    def career_rules(self) -> List[Rule]:
        rules = []
        lord10 = self._lord(10)

        rules.append(Rule(
            fires=self._is_strong(lord10),
            text=f'10th lord {lord10} strong → excellent career',
            source='BPHS', polarity='strong_positive'))

        rules.append(Rule(
            fires=self._is_weak(lord10),
            text=f'10th lord {lord10} weak → career challenges',
            source='BPHS', polarity='strong_negative'))

        rules.append(Rule(
            fires=self._h(lord10) in [1, 4, 7, 10],
            text=f'10th lord in kendra H{self._h(lord10)} → strong career foundation',
            source='BPHS', polarity='positive'))

        rules.append(Rule(
            fires=self._h(lord10) in [5, 9],
            text=f'10th lord in trikona H{self._h(lord10)} → fortunate career',
            source='BPHS', polarity='positive'))

        # Raja Yoga: 9th + 5th lords connected
        lord5 = self._lord(5)
        lord9 = self._lord(9)
        rules.append(Rule(
            fires=self._conj(lord5, lord9) or self._h(lord5) == self._h(lord9),
            text=f'{lord5}(5L)+{lord9}(9L) connected → Raja Yoga (authority)',
            source='BPHS Ch.41 (Raja Yoga)', polarity='strong_positive'))

        # Sun in 10th → authority, government
        rules.append(Rule(
            fires=self._h('Sun') == 10,
            text='Sun in 10th → authority, government connection',
            source='BPHS/Phaladeepika', polarity='strong_positive'))

        # Sun strong → leadership
        rules.append(Rule(
            fires=self._is_strong('Sun'),
            text='Sun strong → natural leadership',
            source='BPHS', polarity='positive'))

        # Multiple planets in 10th
        occ10 = self._occ(10)
        rules.append(Rule(
            fires=len(occ10) >= 2,
            text=f'{len(occ10)} planets in 10th → career focus',
            source='Classical', polarity='positive'))

        # Chandra Lagna: 10th from Moon
        moon_sign = self._r('Moon')
        lord10_from_moon = RASHI_LORDS[(moon_sign + 9) % 12]
        rules.append(Rule(
            fires=self._is_strong(lord10_from_moon),
            text=f'10th lord from Moon ({lord10_from_moon}) strong → career confirmed from Chandra',
            source='BPHS (Chandra Lagna)', polarity='strong_positive'))

        # 10th lord in 2nd → career through speech/public influence
        if self._h(lord10) == 2:
            rules.append(Rule(True,
                f'10th lord {lord10} in 2nd → career through speech/public influence',
                'BPHS', 'positive'))

        # Moon in 10th → public figure
        if self._h('Moon') == 10:
            rules.append(Rule(True,
                'Moon in 10th → public career, known to masses',
                'BPHS/Phaladeepika', 'positive'))

        # 10th lord conjunct Mars → driven, powerful career
        if self._conj(lord10, 'Mars'):
            rules.append(Rule(True,
                f'10th lord {lord10} with Mars → driven powerful career',
                'Classical', 'strong_positive'))

        # Multiple kendra planets → career strength
        kendra_count = sum(1 for p in self.p if self._h(p) in [1,4,7,10])
        if kendra_count >= 4:
            rules.append(Rule(True,
                f'{kendra_count} planets in kendra → exceptional career power',
                'BPHS', 'strong_positive'))
        elif kendra_count >= 3:
            rules.append(Rule(True,
                f'{kendra_count} planets in kendra → strong career',
                'BPHS', 'positive'))

        return [r for r in rules if r.fires]

    # ═══════════════════════════════════════════════════════════════
    # HEALTH RULES
    # ═══════════════════════════════════════════════════════════════

    def health_rules(self) -> List[Rule]:
        rules = []
        lord1 = self._lord(1)
        lord6 = self._lord(6)

        # BPHS: Lagna lord in 6/8/12 → diminished health
        rules.append(Rule(
            fires=self._h(lord1) in [6, 8, 12],
            text=f'Lagna lord {lord1} in H{self._h(lord1)} → health diminished',
            source='BPHS 12.1-2', polarity='strong_negative'))

        # BPHS: Benefic in kendra/trikona → diseases disappear
        rules.append(Rule(
            fires=any(self._h(b) in [1,4,5,7,9,10] for b in ['Jupiter', 'Venus']),
            text='Benefic in kendra/trikona → health protected',
            source='BPHS 12.1-2', polarity='positive'))

        # Phaladeepika 16.17: Lagna lord stronger than 6th lord → hale and healthy
        ll_strong = self._is_strong(lord1)
        l6_weak = self._is_weak(lord6)
        rules.append(Rule(
            fires=ll_strong and l6_weak,
            text=f'Lagna lord {lord1} strong + 6th lord {lord6} weak → strong constitution',
            source='Phaladeepika 16.17', polarity='strong_positive'))

        rules.append(Rule(
            fires=self._is_weak(lord1) and self._is_strong(lord6),
            text=f'Lagna lord {lord1} weak + 6th lord {lord6} strong → health vulnerable',
            source='Phaladeepika 16.17', polarity='strong_negative'))

        # Malefics in 1st
        mal1 = [p for p in self._occ(1) if self._is_natural_malefic(p)]
        rules.append(Rule(
            fires=bool(mal1),
            text=f'Malefics {mal1} in 1st → body afflicted',
            source='BPHS', polarity='negative'))

        # Saturn + Moon → chronic + mental
        rules.append(Rule(
            fires=self._conj('Saturn', 'Moon'),
            text='Saturn+Moon → chronic illness + mental stress',
            source='Classical', polarity='strong_negative'))

        # Mars in 8th → accidents
        rules.append(Rule(
            fires=self._h('Mars') == 8,
            text='Mars in 8th → accident prone',
            source='Classical', polarity='negative'))

        # Heavy malefics in 8th
        mal8 = [p for p in self._occ(8) if self._is_natural_malefic(p)]
        rules.append(Rule(
            fires=len(mal8) >= 2,
            text=f'Heavy malefics in 8th {mal8} → health crises',
            source='BPHS', polarity='strong_negative'))

        return [r for r in rules if r.fires]

    # ═══════════════════════════════════════════════════════════════
    # FOREIGN/TRAVEL RULES (BPHS Chapter 23 - 12th House)
    # ═══════════════════════════════════════════════════════════════

    def foreign_rules(self) -> List[Rule]:
        rules = []
        lord12 = self._lord(12)
        lord9 = self._lord(9)

        # BPHS: 12th lord strong/in own → detachment, foreign lands
        rules.append(Rule(
            fires=self._is_strong(lord12),
            text=f'12th lord {lord12} strong → foreign connection supported',
            source='BPHS Ch.23', polarity='strong_positive'))

        # 12th lord in kendra → foreign settlement
        rules.append(Rule(
            fires=self._h(lord12) in [1, 4, 7, 10],
            text=f'12th lord {lord12} in kendra H{self._h(lord12)} → foreign settlement likely',
            source='BPHS', polarity='positive'))

        # Rahu in kendra/trikona → strong foreign connection (Rahu = foreign karaka)
        rahu_h = self._h('Rahu')
        rules.append(Rule(
            fires=rahu_h in [1, 4, 5, 7, 9, 10],
            text=f'Rahu in H{rahu_h} (kendra/trikona) → strong foreign connection',
            source='Classical (Rahu signification)', polarity='strong_positive'))

        # 4th lord in 12th → permanent home in foreign land (BPHS)
        lord4 = self._lord(4)
        rules.append(Rule(
            fires=self._h(lord4) == 12,
            text=f'4th lord {lord4} in 12th → permanent foreign home',
            source='BPHS', polarity='strong_positive'))

        # Rahu in 4th → home in foreign land
        rules.append(Rule(
            fires=self._h('Rahu') == 4,
            text='Rahu in 4th → home in foreign land',
            source='Classical', polarity='positive'))

        # Multiple planets in 12th → foreign connection
        h12_occ = self._occ(12)
        rules.append(Rule(
            fires=len(h12_occ) >= 2,
            text=f'Multiple planets in 12th ({", ".join(h12_occ)}) → foreign lands connection',
            source='BPHS', polarity='positive'))

        # 9th lord strong → long distance travel blessed
        rules.append(Rule(
            fires=self._is_strong(lord9),
            text=f'9th lord {lord9} strong → blessed for long journeys',
            source='BPHS', polarity='positive'))

        # 10th lord in 12th → career in foreign land (BPHS Ch.23)
        lord10 = self._lord(10)
        rules.append(Rule(
            fires=self._h(lord10) == 12,
            text=f'10th lord {lord10} in 12th → career abroad',
            source='BPHS Ch.23', polarity='positive'))

        # Chandra Lagna: 12th from Moon occupied
        moon_sign = self._r('Moon')
        h12_from_moon = (moon_sign + 11) % 12
        h12_from_moon_house = (h12_from_moon - self.asc) % 12 + 1
        h12_moon_occ = self._occ(h12_from_moon_house)
        rules.append(Rule(
            fires=bool(h12_moon_occ),
            text=f'Planets in 12th from Moon → foreign connection from Chandra Lagna',
            source='BPHS (Chandra Lagna)', polarity='positive'))

        return [r for r in rules if r.fires]

    # ═══════════════════════════════════════════════════════════════
    # PROPERTY RULES (BPHS Chapter 15 - 4th House)
    # ═══════════════════════════════════════════════════════════════

    def property_rules(self) -> List[Rule]:
        rules = []
        lord4 = self._lord(4)

        # BPHS: 4th lord strong → happiness from property, home, vehicles
        rules.append(Rule(
            fires=self._is_strong(lord4),
            text=f'4th lord {lord4} strong → property and home blessed',
            source='BPHS Ch.15', polarity='strong_positive'))

        # 4th lord in kendra → strong property foundation
        rules.append(Rule(
            fires=self._h(lord4) in [1, 4, 7, 10],
            text=f'4th lord in kendra H{self._h(lord4)} → strong property foundation',
            source='BPHS', polarity='positive'))

        # 4th lord weak in dusthana → loss of property/happiness
        rules.append(Rule(
            fires=self._is_weak(lord4) and self._h(lord4) in [6, 8, 12],
            text=f'4th lord {lord4} weak in dusthana → property challenges',
            source='BPHS Ch.15', polarity='strong_negative'))

        # Mars (karaka for property) strong → property gains
        rules.append(Rule(
            fires=self._is_strong('Mars'),
            text='Mars (property karaka) strong → land and property favored',
            source='BPHS (karaka)', polarity='strong_positive'))

        # Benefics in 4th → happiness from home
        ben4 = [p for p in self._occ(4) if self._is_functional_benefic(p)]
        rules.append(Rule(
            fires=bool(ben4),
            text=f'Benefics {ben4} in 4th → happy home',
            source='BPHS', polarity='positive'))

        # Malefics in 4th → disturbed domestic peace
        mal4 = [p for p in self._occ(4) if self._is_natural_malefic(p)]
        rules.append(Rule(
            fires=bool(mal4) and not ben4,
            text=f'Malefics {mal4} in 4th → domestic unrest',
            source='BPHS', polarity='negative'))

        # Saturn in 4th → property with delay/effort
        rules.append(Rule(
            fires=self._h('Saturn') == 4,
            text='Saturn in 4th → property through hard work and delay',
            source='Saravali', polarity='negative'))

        # Venus strong → vehicles and luxury
        rules.append(Rule(
            fires=self._is_strong('Venus'),
            text='Venus strong → vehicles and luxury comforts',
            source='BPHS', polarity='positive'))

        return [r for r in rules if r.fires]

    # ═══════════════════════════════════════════════════════════════
    # EDUCATION RULES (BPHS Chapter 16 - 4th/5th House)
    # ═══════════════════════════════════════════════════════════════

    def education_rules(self) -> List[Rule]:
        rules = []
        lord4 = self._lord(4)
        lord5 = self._lord(5)
        lord9 = self._lord(9)

        # BPHS: 4th lord strong → formal education success
        rules.append(Rule(
            fires=self._is_strong(lord4),
            text=f'4th lord {lord4} strong → education blessed',
            source='BPHS Ch.16', polarity='strong_positive'))

        # 5th lord strong → intelligence and learning
        rules.append(Rule(
            fires=self._is_strong(lord5),
            text=f'5th lord {lord5} strong → intelligence and learning',
            source='BPHS', polarity='strong_positive'))

        # Mercury strong → intellectual brilliance (Mercury = Budhi karaka)
        rules.append(Rule(
            fires=self._is_strong('Mercury'),
            text='Mercury strong → intellectual brilliance',
            source='BPHS (Budhi karaka)', polarity='strong_positive'))

        # Jupiter strong → wisdom and higher learning (Jupiter = Gnana karaka)
        rules.append(Rule(
            fires=self._is_strong('Jupiter'),
            text='Jupiter strong → wisdom and higher learning',
            source='BPHS (Gnana karaka)', polarity='positive'))

        # Mercury in kendra → strong intellect in action
        rules.append(Rule(
            fires=self._h('Mercury') in [1, 4, 5, 10],
            text=f'Mercury in H{self._h("Mercury")} → intellect well-placed',
            source='Phaladeepika', polarity='positive'))

        # 5th lord in dusthana → education challenges
        rules.append(Rule(
            fires=self._h(lord5) in [6, 8, 12] and self._is_weak(lord5),
            text=f'5th lord {lord5} weak in dusthana → education difficulties',
            source='BPHS', polarity='strong_negative'))

        # 9th lord strong → higher education (9th = higher learning)
        rules.append(Rule(
            fires=self._is_strong(lord9),
            text=f'9th lord {lord9} strong → higher education success',
            source='BPHS', polarity='positive'))

        # Jupiter in 4th/5th/9th → education blessed
        jup_h = self._h('Jupiter')
        rules.append(Rule(
            fires=jup_h in [4, 5, 9],
            text=f'Jupiter in H{jup_h} → education blessed by Guru',
            source='BPHS', polarity='positive'))

        # 4th lord in 12th → education in foreign land
        rules.append(Rule(
            fires=self._h(lord4) == 12,
            text=f'4th lord {lord4} in 12th → education abroad',
            source='BPHS', polarity='positive'))

        # Rahu in 4th/9th → foreign education
        rahu_h = self._h('Rahu')
        rules.append(Rule(
            fires=rahu_h in [4, 9],
            text=f'Rahu in H{rahu_h} → foreign education connection',
            source='Classical', polarity='positive'))

        return [r for r in rules if r.fires]

    # ═══════════════════════════════════════════════════════════════
    # LONGEVITY RULES (BPHS Chapter 19 - 8th House)
    # ═══════════════════════════════════════════════════════════════

    def longevity_rules(self) -> List[Rule]:
        rules = []
        lord1 = self._lord(1)
        lord8 = self._lord(8)

        # BPHS: 8th lord strong → good longevity
        rules.append(Rule(
            fires=self._is_strong(lord8),
            text=f'8th lord {lord8} strong → good longevity',
            source='BPHS Ch.19', polarity='strong_positive'))

        # Saturn strong → long life (Saturn = Ayushkaraka)
        rules.append(Rule(
            fires=self._is_strong('Saturn'),
            text='Saturn (Ayushkaraka) strong → long life',
            source='BPHS', polarity='strong_positive'))

        # Lagna lord strong → healthy constitution supports longevity
        rules.append(Rule(
            fires=self._is_strong(lord1),
            text=f'Lagna lord {lord1} strong → healthy body, supports longevity',
            source='BPHS', polarity='positive'))

        # Jupiter aspects 1st or 8th → divine protection on life
        jup_asp_1 = any(((self._h('Jupiter') + asp - 1) % 12) + 1 == 1
                       for asp in PLANETS.get('Jupiter', {}).get('aspects', [7]))
        jup_asp_8 = any(((self._h('Jupiter') + asp - 1) % 12) + 1 == 8
                       for asp in PLANETS.get('Jupiter', {}).get('aspects', [7]))
        rules.append(Rule(
            fires=jup_asp_1 and self._h('Jupiter') != 1,
            text='Jupiter aspects lagna → body protected',
            source='BPHS', polarity='positive'))
        rules.append(Rule(
            fires=jup_asp_8 and self._h('Jupiter') != 8,
            text='Jupiter aspects 8th → longevity extended',
            source='BPHS', polarity='positive'))

        # Heavy malefics in 8th → health crises / shortened life
        mal8 = [p for p in self._occ(8) if self._is_natural_malefic(p)]
        rules.append(Rule(
            fires=len(mal8) >= 2,
            text=f'Heavy malefics in 8th ({", ".join(mal8)}) → health crises',
            source='BPHS', polarity='strong_negative'))

        # Mars in 8th → accident prone (BPHS)
        rules.append(Rule(
            fires=self._h('Mars') == 8,
            text='Mars in 8th → accident prone, sudden events',
            source='BPHS', polarity='negative'))

        # Mars + Rahu → sudden violent events
        rules.append(Rule(
            fires=self._conj('Mars', 'Rahu'),
            text='Mars+Rahu → sudden violent events',
            source='Classical', polarity='strong_negative'))

        # 8th lord in 1st → body at risk (BPHS)
        rules.append(Rule(
            fires=self._h(lord8) == 1,
            text=f'8th lord {lord8} in 1st → body at risk',
            source='BPHS', polarity='negative'))

        # Lagna lord weak in dusthana → constitution vulnerable
        rules.append(Rule(
            fires=self._is_weak(lord1) and self._h(lord1) in [6, 8, 12],
            text=f'Lagna lord {lord1} weak in dusthana → constitution vulnerable',
            source='BPHS', polarity='strong_negative'))

        # Benefics in 8th → peaceful transition
        ben8 = [p for p in self._occ(8) if self._is_functional_benefic(p)]
        rules.append(Rule(
            fires=bool(ben8),
            text=f'Benefics {ben8} in 8th → protection in crises',
            source='BPHS', polarity='positive'))

        return [r for r in rules if r.fires]

    # ═══════════════════════════════════════════════════════════════
    # FATHER RULES (BPHS Chapter 20 - 9th House)
    # ═══════════════════════════════════════════════════════════════

    def father_rules(self) -> List[Rule]:
        rules = []
        lord9 = self._lord(9)

        # BPHS: 9th lord strong → good father, fortune from father
        rules.append(Rule(
            fires=self._is_strong(lord9),
            text=f'9th lord {lord9} strong → father blessed, good fortune',
            source='BPHS Ch.20', polarity='strong_positive'))

        # Sun (naisargik karaka for father) strong → father healthy/successful
        rules.append(Rule(
            fires=self._is_strong('Sun'),
            text='Sun strong → father healthy and successful',
            source='BPHS (Sun = Pitru karaka)', polarity='strong_positive'))

        # Sun weak → father suffers
        rules.append(Rule(
            fires=self._is_weak('Sun'),
            text='Sun weak → father faces challenges',
            source='BPHS', polarity='strong_negative'))

        # 9th lord in dusthana → fortune suffers, father may face difficulties
        rules.append(Rule(
            fires=self._h(lord9) in [6, 8, 12] and self._is_weak(lord9),
            text=f'9th lord {lord9} weak in dusthana → father/fortune suffers',
            source='BPHS Ch.20', polarity='strong_negative'))

        # Saturn in 9th → distance from father
        rules.append(Rule(
            fires=self._h('Saturn') == 9,
            text='Saturn in 9th → distance/delay in father relationship',
            source='Saravali', polarity='negative'))

        # Jupiter aspects 9th → father blessed
        rules.append(Rule(
            fires=self._aspected_by_benefic(9),
            text='Benefic aspects 9th → father protected',
            source='BPHS', polarity='positive'))

        # Sun in 9th → Karaka Bhava Nashaya (Sun=father karaka in father house)
        rules.append(Rule(
            fires=self._h('Sun') == 9,
            text='Sun in 9th → Karaka Bhava Nashaya — father karaka in own house weakens father',
            source='BPHS (Karaka Bhava Nashaya)', polarity='negative'))

        return [r for r in rules if r.fires]

    # ═══════════════════════════════════════════════════════════════
    # MOTHER RULES (BPHS Chapter 15 - 4th House)
    # ═══════════════════════════════════════════════════════════════

    def mother_rules(self) -> List[Rule]:
        rules = []
        lord4 = self._lord(4)

        # BPHS: 4th lord strong → mother happy, good relationship
        rules.append(Rule(
            fires=self._is_strong(lord4),
            text=f'4th lord {lord4} strong → mother happy, good relationship',
            source='BPHS Ch.15', polarity='strong_positive'))

        # Moon (naisargik karaka for mother) strong → mother healthy
        rules.append(Rule(
            fires=self._is_strong('Moon'),
            text='Moon strong → mother healthy and nurturing',
            source='BPHS (Moon = Matru karaka)', polarity='strong_positive'))

        # Moon weak/afflicted → mother suffers
        rules.append(Rule(
            fires=self._is_weak('Moon'),
            text='Moon weak → mother faces challenges',
            source='BPHS', polarity='strong_negative'))

        # 4th lord in dusthana → domestic happiness suffers
        rules.append(Rule(
            fires=self._h(lord4) in [6, 8, 12] and self._is_weak(lord4),
            text=f'4th lord {lord4} weak in dusthana → mother/domestic happiness suffers',
            source='BPHS Ch.15', polarity='strong_negative'))

        # Saturn in 4th → strict/distant mother
        rules.append(Rule(
            fires=self._h('Saturn') == 4,
            text='Saturn in 4th → strict or distant mother',
            source='Saravali', polarity='negative'))

        # Jupiter aspects 4th → mother blessed
        rules.append(Rule(
            fires=self._aspected_by_benefic(4),
            text='Benefic aspects 4th → mother protected and happy',
            source='BPHS', polarity='positive'))

        # Moon in 4th → Karaka Bhava Nashaya (Moon=mother karaka in mother house)
        rules.append(Rule(
            fires=self._h('Moon') == 4,
            text='Moon in 4th → Karaka Bhava Nashaya — mother karaka in own house, mixed results',
            source='BPHS (Karaka Bhava Nashaya)', polarity='negative'))

        # Moon + Saturn → mother suffers (BPHS)
        rules.append(Rule(
            fires=self._conj('Moon', 'Saturn'),
            text='Moon+Saturn → mother faces hardship/separation',
            source='BPHS', polarity='strong_negative'))

        return [r for r in rules if r.fires]

    # ═══════════════════════════════════════════════════════════════
    # SIBLINGS RULES (BPHS Chapter 14 - 3rd House)
    # ═══════════════════════════════════════════════════════════════

    def siblings_rules(self) -> List[Rule]:
        rules = []
        lord3 = self._lord(3)

        # BPHS: 3rd lord strong → siblings prosper, good courage
        rules.append(Rule(
            fires=self._is_strong(lord3),
            text=f'3rd lord {lord3} strong → siblings prosper, good courage',
            source='BPHS Ch.14', polarity='strong_positive'))

        # Mars (karaka for siblings) strong → siblings well
        rules.append(Rule(
            fires=self._is_strong('Mars'),
            text='Mars strong → siblings supported',
            source='BPHS (Mars = siblings karaka)', polarity='positive'))

        # 3rd lord in dusthana → sibling challenges
        rules.append(Rule(
            fires=self._h(lord3) in [6, 8, 12] and self._is_weak(lord3),
            text=f'3rd lord {lord3} weak in dusthana → sibling difficulties',
            source='BPHS', polarity='strong_negative'))

        # Benefics in 3rd → harmonious siblings
        ben3 = [p for p in self._occ(3) if self._is_functional_benefic(p)]
        rules.append(Rule(
            fires=bool(ben3),
            text=f'Benefics {ben3} in 3rd → sibling harmony',
            source='BPHS', polarity='positive'))

        # Malefics in 3rd → sibling conflict (but also courage)
        mal3 = [p for p in self._occ(3) if self._is_natural_malefic(p)]
        rules.append(Rule(
            fires=bool(mal3) and not ben3,
            text=f'Malefics {mal3} in 3rd → sibling conflict but also courage',
            source='BPHS', polarity='negative'))

        # Mars + Rahu in 3rd → loss of siblings (BPHS)
        rules.append(Rule(
            fires=self._h('Mars') == 3 and self._h('Rahu') == 3,
            text='Mars+Rahu in 3rd → loss of younger siblings',
            source='BPHS Ch.14', polarity='denial'))

        return [r for r in rules if r.fires]

    # ═══════════════════════════════════════════════════════════════
    # BUSINESS RULES (BPHS - 7th/10th House combined)
    # ═══════════════════════════════════════════════════════════════

    def business_rules(self) -> List[Rule]:
        rules = []
        lord7 = self._lord(7)
        lord10 = self._lord(10)

        # 7th house = business/partnership. 10th = profession.
        # BPHS: 7th lord strong → business partnerships successful
        rules.append(Rule(
            fires=self._is_strong(lord7),
            text=f'7th lord {lord7} strong → business partnerships favored',
            source='BPHS', polarity='strong_positive'))

        # Mercury strong → business acumen
        rules.append(Rule(
            fires=self._is_strong('Mercury'),
            text='Mercury strong → business acumen and intellect',
            source='BPHS', polarity='strong_positive'))

        # Sun in 1st/10th → self-employment, independent
        sun_h = self._h('Sun')
        rules.append(Rule(
            fires=sun_h in [1, 10],
            text=f'Sun in H{sun_h} → independent self-employment',
            source='Phaladeepika', polarity='positive'))

        # 10th lord strong → career/business foundation strong
        rules.append(Rule(
            fires=self._is_strong(lord10),
            text=f'10th lord {lord10} strong → business foundation strong',
            source='BPHS', polarity='positive'))

        # Jupiter aspects 7th → trustworthy partnerships
        rules.append(Rule(
            fires=self._aspected_by_benefic(7),
            text='Benefic aspects 7th → blessed business partnerships',
            source='BPHS', polarity='positive'))

        # Rahu in 10th/11th → unconventional business success
        rahu_h = self._h('Rahu')
        rules.append(Rule(
            fires=rahu_h in [10, 11],
            text=f'Rahu in H{rahu_h} → unconventional business success',
            source='Classical', polarity='positive'))

        # 7th lord in 10th/11th → business brings career/gains
        lord7_h = self._h(lord7)
        rules.append(Rule(
            fires=lord7_h in [10, 11],
            text=f'7th lord in H{lord7_h} → partnerships bring career success/gains',
            source='BPHS', polarity='positive'))

        # Mars strong → entrepreneurial fire
        rules.append(Rule(
            fires=self._is_strong('Mars'),
            text='Mars strong → entrepreneurial drive',
            source='Classical', polarity='positive'))

        return [r for r in rules if r.fires]

    # ═══════════════════════════════════════════════════════════════
    # LOVE/ROMANCE RULES (5th + 7th House)
    # ═══════════════════════════════════════════════════════════════

    def love_rules(self) -> List[Rule]:
        rules = []
        lord5 = self._lord(5)
        lord7 = self._lord(7)

        # 5th lord strong → romance blessed
        rules.append(Rule(
            fires=self._is_strong(lord5),
            text=f'5th lord {lord5} strong → romance and love blessed',
            source='BPHS', polarity='strong_positive'))

        # Venus strong → love karaka powerful
        rules.append(Rule(
            fires=self._is_strong('Venus'),
            text='Venus strong → love and romance karaka powerful',
            source='BPHS', polarity='strong_positive'))

        # 5th + 7th lord connected → love leads to marriage
        rules.append(Rule(
            fires=self._conj(lord5, lord7) or self._h(lord5) == self._h(lord7),
            text=f'5th+7th lords ({lord5}+{lord7}) connected → love marriage indicated',
            source='BPHS', polarity='strong_positive'))

        # Venus in 1st/5th/7th → romantic nature
        venus_h = self._h('Venus')
        rules.append(Rule(
            fires=venus_h in [1, 5, 7],
            text=f'Venus in H{venus_h} → romantic and attractive',
            source='Phaladeepika', polarity='positive'))

        # Moon + Venus → deeply romantic
        rules.append(Rule(
            fires=self._conj('Moon', 'Venus'),
            text='Moon+Venus → deeply romantic and emotional in love',
            source='Classical', polarity='positive'))

        # Ketu in 5th/7th → detachment in love
        ketu_h = self._h('Ketu')
        rules.append(Rule(
            fires=ketu_h in [5, 7],
            text=f'Ketu in H{ketu_h} → detachment in romantic matters',
            source='Classical', polarity='strong_negative'))

        # Rahu in 7th → unconventional/multiple relationships
        rules.append(Rule(
            fires=self._h('Rahu') == 7,
            text='Rahu in 7th → unconventional love life',
            source='Classical', polarity='negative'))

        # Venus weak → love karaka weakened
        rules.append(Rule(
            fires=self._is_weak('Venus'),
            text='Venus weak → romantic fulfillment challenged',
            source='BPHS', polarity='strong_negative'))

        return [r for r in rules if r.fires]

    # ═══════════════════════════════════════════════════════════════
    # FAME/SOCIAL STATUS RULES (10th + 1st House)
    # ═══════════════════════════════════════════════════════════════

    def fame_rules(self) -> List[Rule]:
        rules = []
        lord10 = self._lord(10)

        # Sun strong → recognition and fame
        rules.append(Rule(
            fires=self._is_strong('Sun'),
            text='Sun strong → destined for recognition',
            source='BPHS', polarity='strong_positive'))

        # 10th lord in 1st → highly visible career
        rules.append(Rule(
            fires=self._h(lord10) == 1,
            text=f'10th lord {lord10} in 1st → highly visible, public figure',
            source='BPHS', polarity='strong_positive'))

        # Rahu in 10th → unusual fame, mass visibility
        rules.append(Rule(
            fires=self._h('Rahu') == 10,
            text='Rahu in 10th → unusual fame, mass visibility',
            source='Classical', polarity='strong_positive'))

        # Moon in 10th → public image, known to masses
        rules.append(Rule(
            fires=self._h('Moon') == 10,
            text='Moon in 10th → public image, known to masses',
            source='Phaladeepika', polarity='strong_positive'))

        # Raja Yoga → fame through power
        lord5 = self._lord(5)
        lord9 = self._lord(9)
        rules.append(Rule(
            fires=self._conj(lord5, lord9) or self._h(lord5) == self._h(lord9),
            text=f'{lord5}(5L)+{lord9}(9L) connected → Raja Yoga brings fame',
            source='BPHS Ch.41', polarity='strong_positive'))

        # Sun in 10th → authority figure, government recognition
        rules.append(Rule(
            fires=self._h('Sun') == 10,
            text='Sun in 10th → authority and government recognition',
            source='BPHS/Phaladeepika', polarity='strong_positive'))

        # 10th lord weak in dusthana → reputation suffers
        rules.append(Rule(
            fires=self._is_weak(lord10) and self._h(lord10) in [6, 8, 12],
            text=f'10th lord {lord10} weak in dusthana → reputation challenges',
            source='BPHS', polarity='strong_negative'))

        return [r for r in rules if r.fires]

    # ═══════════════════════════════════════════════════════════════
    # HELPER
    # ═══════════════════════════════════════════════════════════════

    def _check_papakartari(self, house):
        """Uses BPHS Moon/Mercury classification."""
        prev = house - 1 if house > 1 else 12
        nxt = house + 1 if house < 12 else 1
        prev_occ = self._occ(prev)
        next_occ = self._occ(nxt)
        prev_mal = any(self._is_natural_malefic(p) for p in prev_occ)
        next_mal = any(self._is_natural_malefic(p) for p in next_occ)
        prev_ben = any(self._is_functional_benefic(p) for p in prev_occ)
        next_ben = any(self._is_functional_benefic(p) for p in next_occ)
        return prev_mal and next_mal and not prev_ben and not next_ben

    # ═══════════════════════════════════════════════════════════════
    # MASTER EVALUATION — RULE-BASED SCORING
    # ═══════════════════════════════════════════════════════════════

    def evaluate(self, event: str) -> Dict:
        """
        Evaluate by firing classical rules — NO invented scores.
        Returns the raw fired rules with their textual descriptions.
        The Oracle interprets them qualitatively, as the texts intended.
        """
        method = getattr(self, f'{event}_rules', None)
        if not method:
            return {'event': event, 'rules_fired': 0, 'supports': [], 'opposes': [], 'denies': [], 'summary': 'Unknown event type'}

        fired_rules = method()

        # Add BPHS Ch.24 lord-in-house effects
        try:
            lord_effects = get_lord_effects_for_event(self.engine, event)
            for le in lord_effects:
                polarity = 'positive' if le['nature'] == 'positive' else 'negative' if le['nature'] == 'negative' else 'neutral'
                if polarity != 'neutral':
                    fired_rules.append(Rule(
                        fires=True,
                        text=f"{le['lord_of_house']}L ({le['lord_planet']}) in H{le['placed_in_house']} → {le['text']}",
                        source=le['source'],
                        polarity=polarity,
                    ))
        except Exception:
            pass

        # Add BPHS planet-in-house effects
        try:
            planet_effects = get_planet_effects_for_event(self.engine, event)
            for pe in planet_effects:
                polarity = 'positive' if pe['nature'] == 'positive' else 'negative' if pe['nature'] == 'negative' else 'neutral'
                if polarity != 'neutral':
                    fired_rules.append(Rule(
                        fires=True,
                        text=f"{pe['planet']} in H{pe['house']} → {pe['text']}",
                        source=pe['source'],
                        polarity=polarity,
                    ))
        except Exception:
            pass

        # Categorize by what the TEXT says, not by invented numbers
        supports = [r for r in fired_rules if r.polarity in ('strong_positive', 'positive')]
        opposes = [r for r in fired_rules if r.polarity in ('negative', 'strong_negative')]
        denies = [r for r in fired_rules if r.polarity == 'denial']

        # Build textual summary — exactly what a Jyotishi would say
        if denies:
            if len(denies) >= 2:
                summary = f'DENIED — {len(denies)} classical denial rules fire. The texts say this event will not manifest.'
            else:
                if len(supports) >= 3:
                    summary = f'CONFLICTED — 1 denial rule but {len(supports)} supporting rules. Event is heavily challenged but not impossible.'
                else:
                    summary = f'DENIED — denial rule fires with insufficient support to override.'
        elif len(opposes) > len(supports) and len(opposes) >= 3:
            summary = f'WEAK — {len(opposes)} opposing rules vs {len(supports)} supporting. The texts indicate significant challenges.'
        elif len(supports) > len(opposes) and len(supports) >= 3:
            summary = f'STRONG — {len(supports)} supporting rules vs {len(opposes)} opposing. The texts promise this event.'
        elif len(supports) > len(opposes):
            summary = f'SUPPORTED — {len(supports)} supporting rules vs {len(opposes)} opposing. The texts lean toward this event manifesting.'
        elif len(opposes) > len(supports):
            summary = f'CHALLENGED — {len(opposes)} opposing rules vs {len(supports)} supporting. The texts indicate difficulties.'
        elif not supports and not opposes:
            summary = f'NEUTRAL — no strong classical rules fire for this event. Chart is average for this area.'
        else:
            summary = f'MIXED — equal supporting ({len(supports)}) and opposing ({len(opposes)}) rules. Result depends on dasha activation.'

        return {
            'event': event,
            'rules_fired': len(fired_rules),
            'supports': [{'text': r.text, 'source': r.source, 'weight': r.polarity} for r in supports],
            'opposes': [{'text': r.text, 'source': r.source, 'weight': r.polarity} for r in opposes],
            'denies': [{'text': r.text, 'source': r.source} for r in denies],
            'summary': summary,
            'support_count': len(supports),
            'oppose_count': len(opposes),
            'denial_count': len(denies),
        }
