"""
MANAZIL AL-QAMAR — the 28 Arabic lunar mansions.

Distinct from the Indian nakshatras and not a translation of them. Both divide the ecliptic
by the Moon's daily motion, and the question of whether one borrowed from the other, or
both from a Babylonian ancestor, is genuinely unsettled — the mansions are attested in
pre-Islamic Arabian usage as an agricultural and navigational calendar before they carried
any astrological weight.

The differences are structural, not cosmetic:
  • 28 mansions of 12°51'26" each, against 27 nakshatras of 13°20'
  • measured TROPICALLY in most Islamic astrological usage, against the sidereal nakshatras
  • the mansions carry weather and seasonal lore that the nakshatras do not, because their
    first use was for knowing when to plant and when to travel

Treating them as the same system with different names — which platforms routinely do — is
wrong, and it would also corrupt the consensus engine by collapsing two genuinely separate
witnesses into one.
"""
from typing import Dict, List

SPAN = 360.0 / 28.0     # 12°51'25.7"

# (number, transliteration, meaning, traditional nature)
MANSIONS = [
    (1,  "Al-Sharatain", "the two signs", "beginnings, journeys, separation"),
    (2,  "Al-Butain", "the little belly", "hidden things, buried treasure, distrust"),
    (3,  "Al-Thurayya", "the many little ones", "the Pleiades; abundance, sight, hunting"),
    (4,  "Al-Dabaran", "the follower", "discord, hostility, the breaking of bonds"),
    (5,  "Al-Haq'ah", "the white spot", "instruction, return, the finding of what was lost"),
    (6,  "Al-Han'ah", "the brand", "hunting, siege, the taking of what is defended"),
    (7,  "Al-Dhira", "the forearm", "gain, friendship, favourable travel"),
    (8,  "Al-Nathrah", "the gap", "love, friendship, the loosening of captives"),
    (9,  "Al-Tarf", "the glance", "hindrance, the harming of harvests, ill will"),
    (10, "Al-Jabhah", "the forehead", "building, love, benefit, the strengthening of houses"),
    (11, "Al-Zubrah", "the mane", "voyages, gain, the freeing of the confined"),
    (12, "Al-Sarfah", "the changer", "harvest, planting, the ending of a season"),
    (13, "Al-Awwa", "the barker", "benevolence, gain, the securing of marriage"),
    (14, "Al-Simak", "the unarmed", "love, healing, favourable for the sick"),
    (15, "Al-Ghafr", "the cover", "digging, excavation, travel by water"),
    (16, "Al-Zubana", "the claws", "redemption of captives, gain, discord in marriage"),
    (17, "Al-Iklil", "the crown", "friendship, siege, the hiding of what is valuable"),
    (18, "Al-Qalb", "the heart", "Antares; discord, conspiracy, revenge"),
    (19, "Al-Shaulah", "the sting", "sieges, besieging, the taking of cities"),
    (20, "Al-Na'a'im", "the ostriches", "taming, friendship, the mastery of animals"),
    (21, "Al-Baldah", "the empty place", "harvest, gain, building, marriage"),
    (22, "Sa'd al-Dhabih", "fortune of the slaughterer", "healing, escape, the ending of illness"),
    (23, "Sa'd Bula", "fortune of the swallower", "release, healing, divorce"),
    (24, "Sa'd al-Su'ud", "fortune of fortunes", "marriage, benevolence, the greatest of the fortunes"),
    (25, "Sa'd al-Akhbiyah", "fortune of the tents", "siege, revenge, the harming of enemies"),
    (26, "Al-Fargh al-Muqaddam", "the forward spout", "union, harvest, gain by water"),
    (27, "Al-Fargh al-Mu'akhkhar", "the rear spout", "gain, return, the increase of merchandise"),
    (28, "Batn al-Hut", "the belly of the fish", "return, the finding of what was lost, safety in travel"),
]

assert len(MANSIONS) == 28


def mansion(longitude: float, tropical: bool = True) -> Dict:
    """Which mansion a longitude falls in.

    `tropical` records the frame used. Islamic astrological usage is normally tropical;
    some later Indo-Persian work applies the mansions sidereally, which shifts every
    boundary and is a different system in practice."""
    lon = float(longitude) % 360.0
    idx = int(lon // SPAN)
    n, name, meaning, nature = MANSIONS[idx]
    start = idx * SPAN
    return {
        "number": n, "name": name, "meaning": meaning, "nature": nature,
        "span_start": round(start, 4), "span_end": round(start + SPAN, 4),
        "degrees_into": round(lon - start, 4),
        "frame": "tropical" if tropical else "sidereal",
        "note": ("Distinct from the 27 nakshatras — different count, different spans, and "
                 "normally a different frame. Not a translation of them."),
    }


def all_mansions() -> List[Dict]:
    return [{"number": n, "name": nm, "meaning": m, "nature": nat,
             "span_start": round(i * SPAN, 4), "span_end": round((i + 1) * SPAN, 4)}
            for i, (n, nm, m, nat) in enumerate(MANSIONS)]


def summary(m: Dict) -> str:
    if not m:
        return ""
    return (f"LUNAR MANSION {m['number']}/28 — {m['name']} ({m['meaning']}), "
            f"{m['degrees_into']:.2f}° in · {m['nature']}")
