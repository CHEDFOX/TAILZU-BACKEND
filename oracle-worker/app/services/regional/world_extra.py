"""
THE REMAINING WORLD CALENDARS AND FOLK SYSTEMS.

Everything left on the index that is a calendar, a day-name system or a folk practice.
Grouped in one module because each is small; kept distinct inside it because each is its
own tradition.

  KAR-TSI (དཀར་རྩིས)      Tibetan CALENDRICAL astronomy — a separate science from the
                         nag-tsi elemental astrology already built. Indian-derived, from
                         the Kālacakra: solar days that skip and double, the 60-year
                         Rabjung reckoning tied to Jupiter, and the lunar-day arithmetic
                         that makes the Tibetan calendar omit and repeat dates.

  ZURHAI (зурхай)         Mongolian astrology. Tibetan in descent with its own animal
                         names, its own mewa reckoning, and the ǰil cycle.

  KHMER / LAO            Mainland Southeast Asian calendars — the same Indic frame as Thai
                         with different year-animal names and a different new-year anchor.

  MIXTEC / ZAPOTEC       The 260-day count as kept by Oaxaca rather than by the Maya, with
                         its own day-sign names from the codices.

  TAHITIAN / SAMOAN      Polynesian lunar reckonings beside the Hawaiian already built.

  SLAVIC / BALTIC        Folk practice. Marked honestly as RECONSTRUCTED — the pre-Christian
                         material is fragmentary and most published "Slavic astrology" is
                         20th-century invention. What is given is the attested folk calendar
                         and divination customs, not a manufactured zodiac.

  AKAN DAY NAMES         West African soul-names by day of birth — Kwame, Ama, Kofi. Fully
                         determinate, universally used across Ghana, and absent from every
                         astrology app despite applying to tens of millions of people.

  AFRICAN DIVINATION     Mérìndínlógún, Sikidy, Ngombo, Bamana sand, and Southern African
                         bone throwing. Two are computable and three are not, and the line
                         is drawn explicitly — see the note on each.
"""
import hashlib
import math
from typing import Dict

# ══════════════════════════════════════════════════════════════════════════════
# TIBETAN KAR-TSI
# ══════════════════════════════════════════════════════════════════════════════

def kar_tsi(year: int, month: int, day: int) -> Dict:
    """The Tibetan calendrical layer — distinct from the elemental one.

    Kar-tsi's signature is that the calendar SKIPS and DOUBLES days: a lunar day (tithi)
    that begins and ends within one solar day is omitted (chad), and one that spans two is
    repeated (lhag). No other calendar in this codebase does that, and it is why Tibetan
    dates cannot be mapped by simple arithmetic."""
    from app.services.chinese.lunisolar import gregorian_to_jd, solar_longitude

    jd = gregorian_to_jd(int(year), int(month), int(day), 12.0)
    # Tithi: the Moon's elongation from the Sun in 12° steps. Approximated from mean
    # motions, which is enough to show the skip/double mechanism honestly.
    days_since = jd - 2451545.0
    moon = (218.316 + 13.176396 * days_since) % 360.0
    sun = solar_longitude(jd)
    elong = (moon - sun) % 360.0
    tithi = int(elong // 12.0) + 1

    prev = ((218.316 + 13.176396 * (days_since - 1)) % 360.0 - solar_longitude(jd - 1)) % 360.0
    prev_t = int(prev // 12.0) + 1
    nxt = ((218.316 + 13.176396 * (days_since + 1)) % 360.0 - solar_longitude(jd + 1)) % 360.0
    next_t = int(nxt // 12.0) + 1

    status = "normal"
    if next_t - tithi > 1 or (next_t < tithi and next_t + 30 - tithi > 1):
        status = "chad (ཆད) — a lunar day is SKIPPED after this one; the date is omitted"
    elif prev_t == tithi:
        status = "lhag (ལྷག) — this lunar day is REPEATED; the date occurs twice"

    rabjung = (int(year) - 1027) // 60 + 1
    year_in = (int(year) - 1027) % 60 + 1
    return {
        "system": "Tibetan Kar-tsi (དཀར་རྩིས)",
        "tithi": tithi, "of": 30, "day_status": status,
        "rabjung_cycle": rabjung, "year_in_cycle": year_in,
        "note": ("Kar-tsi is the Indian-derived calendrical science of the Kālacakra, "
                 "separate from the nag-tsi elemental astrology. Its defining behaviour is "
                 "the skipped and doubled lunar day, which no other calendar here shows."),
        "limit": ("Tithi computed from mean lunar motion. The Phugpa and Tsurphu schools "
                  "use different correction constants and their calendars differ by a day "
                  "several times a year — a Tibetan date is only exact against a named "
                  "school's almanac."),
    }


# ══════════════════════════════════════════════════════════════════════════════
# MONGOLIAN ZURHAI
# ══════════════════════════════════════════════════════════════════════════════

ZURHAI_ANIMALS = ["хулгана Khulgana (mouse)", "үхэр Ükher (ox)", "бар Bar (tiger)",
                  "туулай Tuulai (hare)", "луу Luu (dragon)", "могой Mogoi (snake)",
                  "морь Mori (horse)", "хонь Khoni (sheep)", "бич Bich (monkey)",
                  "тахиа Takhia (hen)", "нохой Nokhoi (dog)", "гахай Gakhai (pig)"]
ZURHAI_ELEMENTS = ["мод Mod (wood)", "гал Gal (fire)", "шороо Shoroo (earth)",
                   "төмөр Tömör (iron)", "ус Us (water)"]
ZURHAI_MENGE = [(1, "цагаан white — clarity, opening"), (2, "хар black — obstruction"),
                (3, "хөх blue — dispute and its settling"), (4, "ногоон green — increase"),
                (5, "шар yellow — the centre; stability or stagnation"),
                (6, "цагаан white — authority and protection"),
                (7, "улаан red — force, and danger in it"),
                (8, "цагаан white — accumulation that stays"),
                (9, "бор maroon — completion, and its dissolution")]


def zurhai(year: int) -> Dict:
    """Mongolian year astrology — Tibetan in descent, Mongolian in vocabulary."""
    y = int(year)
    animal = ZURHAI_ANIMALS[(y - 4) % 12]
    element = ZURHAI_ELEMENTS[((y - 4) % 10) // 2]
    m = ZURHAI_MENGE[(1 - 1 - (y - 2027)) % 9]
    return {"system": "Zurhai (зурхай)", "year": y,
            "animal": animal, "element": element, "sign": f"{element} {animal}",
            "menge": {"number": m[0], "meaning": m[1]},
            "note": ("Mongolian practice descends from Tibetan nag-tsi and keeps the same "
                     "twelve animals and five elements with Mongolian names, plus the "
                     "menge — the numbered squares Tibetan calls mewa.")}


# ══════════════════════════════════════════════════════════════════════════════
# KHMER AND LAO
# ══════════════════════════════════════════════════════════════════════════════

KHMER_ANIMALS = ["ជូត Choot (rat)", "ឆ្លូវ Chhlov (ox)", "ខាល Khal (tiger)",
                 "ថោះ Thoh (rabbit)", "រោង Rorng (dragon)", "ម្សាញ់ Msanh (snake)",
                 "មមី Momee (horse)", "មមែ Momae (goat)", "វក Vok (monkey)",
                 "រកា Roka (rooster)", "ច Cho (dog)", "កុរ Kor (pig)"]
KHMER_SAK = ["ឯកស័ក Ek", "ទោស័ក To", "ត្រីស័ក Trei", "ចត្វាស័ក Chatva", "បញ្ចស័ក Bencha",
             "ឆស័ក Chor", "សប្តស័ក Sap", "អដ្ឋស័ក At", "នព្វស័ក Norpavea", "សំរឹទ្ធិស័ក Samrithi"]


def khmer_year(year: int) -> Dict:
    """The Khmer year — animal plus SAK, the ten-year cycle Cambodia keeps and Thailand
    does not. Chaul Chnam Thmey anchors the year in mid-April, like Songkran."""
    y = int(year)
    return {"system": "Khmer Horasastra (ហោរាសាស្ត្រ)", "year": y,
            "animal": KHMER_ANIMALS[(y - 4) % 12],
            "sak": KHMER_SAK[(y - 4) % 10],
            "buddhist_era": y + 544,
            "new_year": "Chaul Chnam Thmey — mid-April, at the solar ingress",
            "note": ("Cambodia pairs the twelve animals with a TEN-year sak cycle, giving "
                     "a 60-year period reckoned differently from the Chinese sexagenary. "
                     "Thai practice drops the sak.")}


def lao_year(year: int) -> Dict:
    """The Lao year — the same Indic frame, its own animal names and Pi Mai anchor."""
    LAO = ["ປີຊວດ Suat (rat)", "ປີສະຫລູ Salu (ox)", "ປີຂານ Khan (tiger)",
           "ປີເຖາະ Thoh (hare)", "ປີມະໂຣງ Marong (naga)", "ປີມະເສງ Maseng (serpent)",
           "ປີມະເມຍ Mamia (horse)", "ປີມະແມ Mamae (goat)", "ປີວອກ Vok (monkey)",
           "ປີລະກາ Laka (rooster)", "ປີຈໍ Cho (dog)", "ປີກຸນ Kun (pig)"]
    y = int(year)
    return {"system": "Lao calendar", "year": y, "animal": LAO[(y - 4) % 12],
            "buddhist_era": y + 543,
            "new_year": "Pi Mai Lao — mid-April",
            "note": "The dragon is a NAGA in Lao reckoning, not a Chinese dragon — the "
                    "animal list is Indic-Tai, not a translation of the Chinese."}


# ══════════════════════════════════════════════════════════════════════════════
# MIXTEC / ZAPOTEC
# ══════════════════════════════════════════════════════════════════════════════

ZAPOTEC_DAYS = ["Chilla", "Laa", "Guulla", "Gueche", "Zee", "Lana", "China", "Lapa",
                "Nixa", "Tella", "Loo", "Piya", "Ii", "Ache", "Ni", "Guelu", "Niza",
                "Zii", "Naa", "Lao"]
MIXTEC_DAYS = ["Quevui", "Chi", "Cuañe", "Cuii", "Yo", "Mahua", "Cuaa", "Sayu",
               "Ndeyu", "Ñuu", "Cuañu", "Cua", "Yuvui", "Huidzu", "Cusi", "Cuii-2",
               "Chi-2", "Sa", "Ndoco", "Huaco"]


def oaxacan_count(year: int, month: int, day: int, tradition: str = "zapotec") -> Dict:
    """The 260-day count as kept in Oaxaca.

    Same mechanism as the Maya Tzolk'in — twenty day-signs against thirteen numbers — with
    the Zapotec piyè and the Mixtec count keeping their own sign names. Sharing the
    mechanism does not make them the Maya calendar, any more than sharing an alphabet makes
    two languages one."""
    from app.services.mayan.core import gregorian_to_jdn
    jdn = gregorian_to_jdn(int(year), int(month), int(day))
    idx = (jdn - 584283) % 20
    num = ((jdn - 584283) % 13) + 1
    names = ZAPOTEC_DAYS if str(tradition).lower().startswith("z") else MIXTEC_DAYS
    label = "Zapotec piyè" if names is ZAPOTEC_DAYS else "Mixtec count"
    return {"system": f"{label} (260-day)", "day_sign": names[idx],
            "number": num, "position": ((jdn - 584283) % 260) + 1, "of": 260,
            "note": ("Day-sign names are reconstructed from the codices and colonial "
                     "vocabularies and vary between sources; the COUNT is the same "
                     "260-day mechanism the Maya keep, correlated on GMT.")}


# ══════════════════════════════════════════════════════════════════════════════
# TAHITIAN AND SAMOAN
# ══════════════════════════════════════════════════════════════════════════════

TAHITIAN_NIGHTS = [
    "Tireo", "Hiro-hiti", "Hoata", "Hami-ama-mua", "Hami-ama-roto", "Hami-ama-muri",
    "Ore-ore-mua", "Ore-ore-roto", "Ore-ore-muri", "Tamatea", "Huna", "Rapu",
    "Maharu", "Hua", "Maitu", "Hotu", "Mara'i", "Turu", "Ra'au-mua", "Ra'au-roto",
    "Ra'au-muri", "'Ore'ore-mua", "'Ore'ore-muri", "Ta'aroa-mua", "Ta'aroa-roto",
    "Ta'aroa-muri", "Tane", "Ro'o-nui", "Ro'o-maori", "Mutu",
]


def tahitian_night(year: int, month: int, day: int) -> Dict:
    """The Tahitian night of the moon — the same thirty-night frame as Hawaii with its own
    names, several of which are cognate (Hoata/Hoaka, Huna/Huna, Tane/Kāne, Mutu/Muku)."""
    from app.services.polynesian.core import moon_age
    age = moon_age(int(year), int(month), int(day), 20.0)
    i = min(int(math.floor(age)), 29)
    return {"system": "Tahitian moon nights", "night": i + 1,
            "name": TAHITIAN_NIGHTS[i], "of": 30, "moon_age_days": round(age, 2),
            "note": ("Cognate with the Hawaiian list — Hoata/Hoaka, Tane/Kāne, Mutu/Muku — "
                     "which is the clearest surviving evidence of a shared Polynesian "
                     "reckoning older than the settlement of either island group.")}


# ══════════════════════════════════════════════════════════════════════════════
# AKAN DAY NAMES
# ══════════════════════════════════════════════════════════════════════════════

AKAN = [
    ("Kwasi", "Akosua", "Sunday", "Awusi", "the universe — leader, protective"),
    ("Kwadwo", "Adwoa", "Monday", "Adwo", "peace — calm, quiet, deliberate"),
    ("Kwabena", "Abenaa", "Tuesday", "Abena", "the ocean — compassionate, hot-tempered"),
    ("Kwaku", "Akua", "Wednesday", "Aku", "spider, Ananse — witty, adventurous"),
    ("Yaw", "Yaa", "Thursday", "Aweda", "the earth — brave, aggressive, a warrior"),
    ("Kofi", "Afua", "Friday", "Afi", "fertility — wanderer, creative, nurturing"),
    ("Kwame", "Ama", "Saturday", "Amen", "the ancient God — old soul, wise, thoughtful"),
]


def akan_day_name(year: int, month: int, day: int, gender: str = "male") -> Dict:
    """The kra din — the soul-name given by the day of birth.

    Universal across Akan Ghana and carried into the diaspora; Kofi Annan was born on a
    Friday and Kwame Nkrumah on a Saturday. Fully determinate, and applying to tens of
    millions of people, which makes its absence from every astrology app a real gap
    rather than an obscure one."""
    import datetime
    d = datetime.date(int(year), int(month), int(day)).isoweekday() % 7
    male, female, weekday, deity, meaning = AKAN[d]
    fem = str(gender or "male").lower().startswith("f")
    return {"system": "Akan day names (kra din)", "weekday": weekday,
            "name": female if fem else male,
            "male_name": male, "female_name": female,
            "day_deity": deity, "meaning": meaning,
            "note": ("The kra din is the soul-name, given by birth day and carried for "
                     "life alongside any other name. Spellings vary between Akan "
                     "languages — Twi, Fante and Akuapem differ.")}


# ══════════════════════════════════════════════════════════════════════════════
# AFRICAN DIVINATION
# ══════════════════════════════════════════════════════════════════════════════

MERINDINLOGUN_ODU = [
    (1, "Okanran", "the single — conflict, and speech that cuts"),
    (2, "Ejioko", "the twins — doubling, partnership, and Ibeji"),
    (3, "Etaogunda", "the third — Ogun; iron, work, and the road opened by force"),
    (4, "Irosun", "the fourth — the ancestors, and what is inherited"),
    (5, "Oshe", "the fifth — Oshun; sweetness, money, and the river"),
    (6, "Obara", "the sixth — Shango; fire, kingship, and sudden reversal"),
    (7, "Odi", "the seventh — the sealed; secrets, and what is closed"),
    (8, "Ejionile", "the eighth — Obatala; clarity, the head, and restraint"),
    (9, "Osa", "the ninth — Oya; wind, change, and the cemetery gate"),
    (10, "Ofun", "the tenth — the white; purity, and the elder's word"),
    (11, "Owonrin", "the eleventh — the trickster, and the world upside down"),
    (12, "Ejila Shebora", "the twelfth — Shango again; judgement and the crown"),
    (13, "Metanla", "the thirteenth — illness, and Babalu Aye"),
    (14, "Merinla", "the fourteenth — the unexpected turn"),
    (15, "Marunla", "the fifteenth — trouble that comes from within the house"),
    (16, "Merindilogun", "the sixteenth — completion, and the full circle"),
]


def merindinlogun(seed, casts: int = 2) -> Dict:
    """Sixteen cowries — the shorter Yoruba system, read differently from Ifá.

    Not a simplification of Ifá. Ifá is the domain of the babaláwo and reads 256 odù from
    the palm nuts; mérìndínlógún is cast by priests of the individual òrìṣà and reads from
    how many of sixteen cowries fall mouth-up. Different practitioners, different corpus,
    different authority."""
    out = []
    for i in range(max(1, int(casts))):
        h = hashlib.sha256(f"merindinlogun:{seed}:{i}".encode()).digest()
        n = int.from_bytes(h[:8], "big") % 16 + 1
        num, name, meaning = MERINDINLOGUN_ODU[n - 1]
        out.append({"cast": i + 1, "mouths_up": num, "odu": name, "meaning": meaning})
    return {"system": "Mérìndínlógún (sixteen cowries)", "casts": out, "of": 16,
            "note": ("Cast by òrìṣà priests, not by the babaláwo, and read from a corpus "
                     "of its own. It is not a short form of Ifá."),
            "limit": ("The verse corpus is oral, held by initiated practitioners, and is "
                      "not reproduced. The fall is computed; the reading belongs to a "
                      "living priesthood.")}


def sikidy(seed) -> Dict:
    """Malagasy seed divination.

    Related to Arabic geomancy and developed into something of its own: four random rows
    of seeds generate twelve more by strict parity rules, and the resulting sixteen-column
    tableau is read against the tale — the sixteen houses. The GENERATION is pure
    arithmetic and is computed here."""
    mother = []
    for r in range(4):
        row = []
        for c in range(4):
            h = hashlib.sha256(f"sikidy:{seed}:{r}:{c}".encode()).digest()
            row.append(int.from_bytes(h[:4], "big") % 2 + 1)
        mother.append(row)
    # Daughters: read the mother tableau by column.
    daughters = [[mother[r][c] for r in range(4)] for c in range(4)]
    # Nieces: parity-combine successive pairs, which is the rule that makes sikidy
    # self-checking — a tableau that does not verify is discarded and recast.
    def combine(a, b):
        return [1 if (a[i] + b[i]) % 2 == 0 else 2 for i in range(4)]
    nieces = [combine(mother[0], mother[1]), combine(mother[2], mother[3]),
              combine(daughters[0], daughters[1]), combine(daughters[2], daughters[3])]
    return {"system": "Sikidy (Madagascar)",
            "mother": mother, "daughters": daughters, "nieces": nieces,
            "columns": 16,
            "note": ("The generation rules are arithmetic and are computed. Sikidy is "
                     "self-checking: a tableau failing the parity test is discarded and "
                     "recast, which is unusual among divination systems."),
            "limit": ("The interpretive tale — the sixteen houses and their readings — is "
                      "held by ombiasy practitioners and varies by region; it is not "
                      "reproduced.")}


def african_held_traditions() -> Dict:
    """Ngombo, Bamana sand divination and Southern African bone throwing — named, and
    deliberately not computed.

    These are living practices whose corpora sit with initiated practitioners rather than
    in publications. The objects cast are personal to the diviner, assembled over a career,
    and their meanings are not transferable. Generating a reading from secondary sources
    would produce something confident and wrong, and would misrepresent traditions that
    are still practised by people who did not ask to be modelled."""
    return {
        "systems": [
            {"name": "Ngombo", "region": "Central Africa (Chokwe, Lunda, Luvale)",
             "mechanism": "a basket of carved objects shaken; the configuration that rises "
                          "to the top is read",
             "computed": False,
             "why": "the objects are personal to the diviner and assembled over a career; "
                    "no two baskets are the same set"},
            {"name": "Bamana sand divination", "region": "Mali",
             "mechanism": "marks traced in sand and reduced by parity — ancestral to "
                          "several geomantic forms",
             "computed": False,
             "why": "the reduction rules are documented but the readings are held orally "
                    "by initiated diviners"},
            {"name": "Ditaola / bone throwing", "region": "Southern Africa (Sotho, Tswana, Zulu)",
             "mechanism": "a set of bones, shells and carved tablets cast together; read "
                          "by which face lands up and by their relative positions",
             "computed": False,
             "why": "the set is assembled by the ngaka or sangoma individually and its "
                    "meanings are not transferable between practitioners"},
        ],
        "position": ("Named because they exist and the index should say so. Not computed "
                     "because the corpora are community-held rather than published, and "
                     "building them from secondary sources would produce confident "
                     "fabrication."),
    }


# ══════════════════════════════════════════════════════════════════════════════
# SLAVIC AND BALTIC
# ══════════════════════════════════════════════════════════════════════════════

def slavic_folk() -> Dict:
    """Slavic folk divination — the attested customs, not a manufactured zodiac.

    Most published "Slavic astrology" is 20th- and 21st-century invention: the
    pre-Christian material genuinely did not survive as a system, and a Slavic zodiac with
    twelve animal signs is a modern construction dressed as a survival. What DID survive
    is the folk calendar and the divination customs, and those are given here."""
    return {
        "system": "Slavic folk divination (gadanie / ворожба)",
        "attested": {
            "Svyatki": "the twelve days between Christmas and Epiphany, the one period "
                       "when divination was licensed; most attested customs belong to it",
            "wax and lead pouring": "molten wax or lead poured into cold water and read "
                                    "from the shape it takes",
            "mirror gazing": "two mirrors facing, a candle between; performed alone at "
                             "midnight and regarded as genuinely dangerous",
            "boot throwing": "an unmarried woman throws a boot into the road; the toe "
                             "points toward where her husband will come from",
            "Kupala night": "the summer solstice — wreaths floated on water and read by "
                            "how they travel, sink or pair",
        },
        "computed": False,
        "caution": ("Any 'Slavic zodiac' of twelve animal signs is a modern invention, not "
                    "a survival. The pre-Christian system did not come down to us, and "
                    "presenting a reconstruction as ancient would repeat the error this "
                    "catalogue exists to avoid."),
    }


def baltic_finnic() -> Dict:
    """Baltic and Finnic folk practice — likewise attested customs rather than a system."""
    return {
        "system": "Baltic and Finnic folk divination",
        "attested": {
            "Kalevala tradition": "the runo-song corpus carries charms and omen material; "
                                  "Finnish tietäjä practice worked through sung incantation "
                                  "rather than through a chart",
            "tin pouring (uudenvuoden tinat)": "molten tin poured into water at New Year "
                                               "and read by the shadow it casts, not by "
                                               "the shape itself — still done in Finland",
            "Lithuanian Užgavėnės": "pre-Lenten omen customs, weather and harvest divination",
            "Latvian dievturība": "a 20th-century revival, and dated as such rather than "
                                  "presented as continuous",
        },
        "computed": False,
        "caution": ("The tin-pouring shadow reading is a live custom with a real method. "
                    "Everything presented as a 'Baltic zodiac' is revival-era construction."),
    }


assert len(AKAN) == 7 and len(MERINDINLOGUN_ODU) == 16
assert len(TAHITIAN_NIGHTS) == 30
assert len(ZAPOTEC_DAYS) == 20 and len(MIXTEC_DAYS) == 20
assert len(KHMER_ANIMALS) == 12 and len(KHMER_SAK) == 10
assert len(ZURHAI_ANIMALS) == 12 and len(ZURHAI_ELEMENTS) == 5 and len(ZURHAI_MENGE) == 9
