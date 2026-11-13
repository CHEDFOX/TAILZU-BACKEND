"""
MAYAN CALENDAR — accurate, deterministic date mathematics.

Three interlocking counts of the Classic Maya calendar, computed from the civil
birth date via the GMT correlation (JDN 584283):

  • TZOLKIN  — the 260-day sacred round: a tone (1–13) + one of 20 day-signs.
               The "Galactic Signature." Anchor: JDN 584283 = 4 Ahau.
  • HAAB     — the 365-day vague year: 18 months of 20 days + Wayeb (5 days).
               Anchor: JDN 584283 = 8 Cumku (day-of-year 348).
  • LONG COUNT — days since the creation date 0.0.0.0.0, as
               baktun.katun.tun.winal.kin.

No ephemeris needed: this is exact calendar arithmetic. Gregorian → JDN uses the
standard Fliegel–Van Flandern algorithm (noon-based integer JDN).
"""
from dataclasses import dataclass

GMT_CORRELATION = 584283          # JDN of 0.0.0.0.0 4 Ahau 8 Cumku (GMT/584283)

# ── the 20 day-signs (Yucatec), with an authentic keyword seed ──────────────────
DAY_SIGNS = [
    ("Imix",     "Crocodile",   "primal waters, nurture, the source"),
    ("Ik",       "Wind",        "breath, spirit, communication"),
    ("Akbal",    "Night",       "dream, mystery, the inner house"),
    ("Kan",      "Seed",        "potential, ripening, growth"),
    ("Chicchan", "Serpent",     "life-force, instinct, vitality"),
    ("Cimi",     "Death",       "transformation, release, surrender"),
    ("Manik",    "Deer",        "healing, the hand, service"),
    ("Lamat",    "Star",        "abundance, harmony, fertility"),
    ("Muluc",    "Water",       "emotion, offering, flow"),
    ("Oc",       "Dog",         "loyalty, love, the guide"),
    ("Chuen",    "Monkey",      "play, artistry, the weaver"),
    ("Eb",       "Road",        "destiny, the path, humility"),
    ("Ben",      "Reed",        "authority, home, the pillar"),
    ("Ix",       "Jaguar",      "magic, the earth, the shaman"),
    ("Men",      "Eagle",       "vision, the mind, the higher view"),
    ("Cib",      "Owl",         "wisdom, forgiveness, the ancestors"),
    ("Caban",    "Earth",       "movement, synchronicity, intelligence"),
    ("Etznab",   "Flint",       "truth, reflection, the blade"),
    ("Cauac",    "Storm",       "renewal, the catalyst, cleansing"),
    ("Ahau",     "Sun",         "enlightenment, wholeness, the flowering"),
]
_AHAU_INDEX = 19                  # anchor day-sign at JDN 584283

# ── the 13 galactic tones, with an authentic keyword seed ───────────────────────
TONES = [
    ("Magnetic",       "purpose, the one, attraction"),
    ("Lunar",          "challenge, polarity, what must be met"),
    ("Electric",       "service, activation, bonding"),
    ("Self-Existing",  "form, measure, definition"),
    ("Overtone",       "radiance, command, empowerment"),
    ("Rhythmic",       "balance, organisation, equality"),
    ("Resonant",       "attunement, channelling, inspiration"),
    ("Galactic",       "integrity, harmony, modelling"),
    ("Solar",          "intention, pulse, realisation"),
    ("Planetary",      "manifestation, perfection, production"),
    ("Spectral",       "liberation, dissolving, release"),
    ("Crystal",        "cooperation, dedication, the round table"),
    ("Cosmic",         "presence, endurance, transcendence"),
]

# ── the Haab: 18 months of 20 days + Wayeb (5 unlucky days) ──────────────────────
HAAB_MONTHS = [
    "Pop", "Uo", "Zip", "Zotz", "Tzec", "Xul", "Yaxkin", "Mol", "Chen", "Yax",
    "Zac", "Ceh", "Mac", "Kankin", "Muan", "Pax", "Kayab", "Cumku", "Wayeb",
]
_HAAB_ANCHOR_POS = 348            # 8 Cumku = month 17 (Cumku) × 20 + 8


def gregorian_to_jdn(year: int, month: int, day: int) -> int:
    """Gregorian calendar date → Julian Day Number (noon-based integer).
    Fliegel–Van Flandern algorithm; valid across the proleptic Gregorian calendar."""
    a = (14 - month) // 12
    y = year + 4800 - a
    m = month + 12 * a - 3
    return day + (153 * m + 2) // 5 + 365 * y + y // 4 - y // 100 + y // 400 - 32045


@dataclass
class MayanSignature:
    long_count: str            # "b.k.t.w.n"
    baktun: int
    katun: int
    tun: int
    winal: int
    kin: int
    tzolkin_tone: int          # 1..13
    tzolkin_tone_name: str
    tzolkin_sign: str          # e.g. "Ahau"
    tzolkin_sign_glyph: str    # e.g. "Sun"
    tzolkin: str               # "4 Ahau"
    tzolkin_seed: str          # keyword seed (day-sign)
    tone_seed: str             # keyword seed (tone)
    haab_day: int              # 0..19 (0 for Wayeb days too)
    haab_month: str            # e.g. "Kankin"
    haab: str                  # "3 Kankin"
    jdn: int


def mayan_signature(year: int, month: int, day: int) -> MayanSignature:
    jdn = gregorian_to_jdn(int(year), int(month), int(day))
    L = jdn - GMT_CORRELATION          # days since 0.0.0.0.0

    # Long Count
    rem = L
    baktun, rem = divmod(rem, 144000)
    katun, rem = divmod(rem, 7200)
    tun, rem = divmod(rem, 360)
    winal, kin = divmod(rem, 20)

    # Tzolkin — tone (1..13) + day-sign (anchor 4 Ahau at L=0)
    tone = ((L + 3) % 13) + 1
    sign_idx = (L + _AHAU_INDEX) % 20
    sign, glyph, sign_seed = DAY_SIGNS[sign_idx]
    tone_name, tone_seed = TONES[tone - 1]

    # Haab — day-of-year (anchor 8 Cumku = 348 at L=0)
    haab_pos = (L + _HAAB_ANCHOR_POS) % 365
    haab_month_idx, haab_day = divmod(haab_pos, 20)      # months of 20; Wayeb (idx 18) has 5
    haab_month = HAAB_MONTHS[haab_month_idx]

    return MayanSignature(
        long_count=f"{baktun}.{katun}.{tun}.{winal}.{kin}",
        baktun=baktun, katun=katun, tun=tun, winal=winal, kin=kin,
        tzolkin_tone=tone, tzolkin_tone_name=tone_name,
        tzolkin_sign=sign, tzolkin_sign_glyph=glyph,
        tzolkin=f"{tone} {sign}", tzolkin_seed=sign_seed, tone_seed=tone_seed,
        haab_day=haab_day, haab_month=haab_month, haab=f"{haab_day} {haab_month}",
        jdn=jdn,
    )
