"""
BODY AND OMEN READING — the systems that need something the app cannot see.

Eight traditions that read a hand, a face, a cup or a pendulum. All eight are real and
widely practised; none of them derives from a birth date, and that is the whole difficulty.

The temptation with this group is to fake it: take the birth date, run it through a
numerology reduction, and print "you have a long head line". That would be inventing a
system rather than computing one, and it is exactly what this catalogue exists not to do.

So this module gives each tradition its VOCABULARY and its reading rules, structured so a
user's own observation can be entered against them, and computes nothing from a birthday.
Where a system does have a determinate component — the pendulum's convention, the
tasseography sectors, the Chinese face palaces' age map — that part IS computed, because
it genuinely is arithmetic.

`read_*` functions take observations. `*_framework` functions return the vocabulary alone.
Nothing here accepts a birth date, deliberately.
"""
from typing import Dict, Optional

# ══════════════════════════════════════════════════════════════════════════════
# WESTERN CHIROMANCY
# ══════════════════════════════════════════════════════════════════════════════

PALM_LINES = {
    "life": ("the life line", "vitality, constitution and major changes of circumstance — "
             "NOT lifespan, which is the commonest misreading of the whole art"),
    "head": ("the head line", "reasoning style — long and straight is analytic, curved and "
             "sloping is imaginative, forked is both"),
    "heart": ("the heart line", "how feeling is given and received; where it ends matters "
              "more than how long it is"),
    "fate": ("the fate line (Saturn line)", "career and the sense of a directed life; often "
             "absent, which is not a defect"),
    "sun": ("the sun line (Apollo line)", "recognition, artistry, and public success"),
    "mercury": ("the mercury line (health line)", "digestion and nervous constitution"),
    "girdle": ("the girdle of Venus", "sensitivity and emotional intensity"),
    "marriage": ("the marriage lines", "significant attachments, read on the side of the palm"),
}
PALM_MOUNTS = {
    "Jupiter": "below the index — ambition, leadership, self-regard",
    "Saturn": "below the middle finger — seriousness, solitude, discipline",
    "Apollo": "below the ring finger — art, brightness, the desire to be seen",
    "Mercury": "below the little finger — speech, commerce, quickness",
    "Mars positive": "below Jupiter — courage, physical assertion",
    "Mars negative": "below Mercury — endurance, resistance under pressure",
    "Venus": "the ball of the thumb — vitality, warmth, appetite for life",
    "Luna": "the outer edge below Mercury — imagination, restlessness, the sea",
}
HAND_SHAPES = {
    "earth": "square palm, short fingers — practical, steady, physical",
    "air": "square palm, long fingers — analytic, communicative, restless",
    "water": "long palm, long fingers — intuitive, sensitive, changeable",
    "fire": "long palm, short fingers — energetic, impulsive, decisive",
}


def chiromancy_framework() -> Dict:
    """The Western palmistry vocabulary. Nothing is computed from a birth date, because
    palmistry does not work from one."""
    return {"system": "Chiromancy (Western palmistry)", "computed": False,
            "lines": {k: {"name": v[0], "reads": v[1]} for k, v in PALM_LINES.items()},
            "mounts": PALM_MOUNTS, "hand_shapes": HAND_SHAPES,
            "convention": ("The dominant hand shows what has been made of the life; the "
                           "other shows what was given. A reading compares them."),
            "limit": "Requires an observed hand. No birth-date derivation exists."}


def read_palm(shape: Optional[str] = None, lines: Optional[Dict[str, str]] = None,
              dominant_mount: Optional[str] = None) -> Dict:
    """A reading from observations the user supplies."""
    out = {"system": "Chiromancy", "observations": {}}
    if shape and shape.lower() in HAND_SHAPES:
        out["observations"]["hand_shape"] = {"shape": shape.lower(),
                                            "reads": HAND_SHAPES[shape.lower()]}
    for key, desc in (lines or {}).items():
        if key in PALM_LINES:
            out["observations"][key] = {"name": PALM_LINES[key][0],
                                        "reads": PALM_LINES[key][1], "observed": desc}
    if dominant_mount and dominant_mount in PALM_MOUNTS:
        out["observations"]["dominant_mount"] = {"mount": dominant_mount,
                                                 "reads": PALM_MOUNTS[dominant_mount]}
    if not out["observations"]:
        out["note"] = "No observations supplied — palmistry needs a hand, not a birthday."
    return out


# ══════════════════════════════════════════════════════════════════════════════
# MIAN XIANG — Chinese face reading
# ══════════════════════════════════════════════════════════════════════════════

# The 百歲流年 — the hundred-year age map of the face. This part IS determinate: each age
# is assigned to a specific facial position, and the map is fixed.
FACE_AGE_MAP = [
    (1, 7, "left ear (輪飛)", "early childhood, and what the family gave"),
    (8, 14, "right ear", "later childhood and schooling"),
    (15, 21, "forehead upper (天中/天庭)", "parents, authority, and inherited fortune"),
    (22, 25, "forehead lower (司空/中正)", "early career and official prospects"),
    (26, 30, "eyebrows (兄弟宮)", "siblings, peers, and the first working years"),
    (31, 34, "eyes (田宅宮)", "property, and the quality of one's inner life"),
    (35, 40, "eyes and bridge (山根)", "the first great test; a weak bridge marks 41 as a crisis"),
    (41, 50, "nose (財帛宮)", "wealth — the nose is the wealth palace, and these are its years"),
    (51, 55, "philtrum (人中)", "children, vitality, and the transition to later life"),
    (56, 65, "mouth and its corners (水星)", "speech, appetite, and how one is received"),
    (66, 75, "chin and jaw (地閣)", "subordinates, property in old age, and stability"),
    (76, 100, "the whole lower face", "the closing years, read from the jaw's fullness"),
]
FACE_PALACES = {
    "命宮 Life": "between the brows — the overall fortune; should be clear and unlined",
    "財帛宮 Wealth": "the nose — money accumulated and held",
    "兄弟宮 Siblings": "the eyebrows — peers, and one's own temperament",
    "田宅宮 Property": "the upper eyelids — land, home, and inner steadiness",
    "男女宮 Children": "beneath the eyes — offspring and creative output",
    "奴僕宮 Subordinates": "the lower jaw — those who work for one",
    "妻妾宮 Spouse": "the outer corners of the eyes — marriage",
    "疾厄宮 Health": "the bridge of the nose — constitution",
    "遷移宮 Travel": "the temples — movement and life away from home",
    "官祿宮 Career": "the mid-forehead — office and standing",
    "福德宮 Fortune": "the upper temples — inner peace and merit",
    "父母宮 Parents": "the upper forehead, left and right — father and mother",
}


def mian_xiang_age(age: int) -> Dict:
    """Which part of the face governs a given age. This IS determinate — the hundred-year
    map is fixed, and it is the one computable part of face reading."""
    a = max(1, min(100, int(age)))
    lo, hi, position, meaning = next(
        (r for r in FACE_AGE_MAP if r[0] <= a <= r[1]), FACE_AGE_MAP[-1])
    return {"system": "Mian Xiang (面相)", "age": a, "position": position,
            "age_range": f"{lo}-{hi}", "governs": meaning,
            "note": ("The 百歲流年 age map is fixed and is computed. The READING of the "
                     "feature at that position requires an observed face.")}


def mian_xiang_framework() -> Dict:
    return {"system": "Mian Xiang (面相)", "computed": False,
            "twelve_palaces": FACE_PALACES,
            "age_map": [{"from": a, "to": b, "position": p, "governs": m}
                        for a, b, p, m in FACE_AGE_MAP],
            "limit": "The palaces need an observed face; only the age map is arithmetic."}


def shou_xiang_framework() -> Dict:
    """Chinese palmistry — related to the Western art and not the same one.

    Chinese practice reads the palm against the eight trigrams and the five elements
    rather than against the seven planets, so the mounts carry different names and
    different meanings even where they sit in the same place."""
    return {"system": "Shou Xiang (手相)", "computed": False,
            "eight_palaces": {
                "乾 Qian (below index, outer)": "the father, heaven, authority",
                "坎 Kan (base of palm, centre)": "the deep; hidden difficulty and resource",
                "艮 Gen (base of thumb, outer)": "the mountain; stopping, and property",
                "震 Zhen (base of thumb)": "thunder; vitality and the elder brother",
                "巽 Xun (below index)": "wind; wealth accumulated gradually",
                "離 Li (below middle/ring)": "fire; reputation and the eyes",
                "坤 Kun (below little finger, outer)": "earth; the mother, and the spouse",
                "兌 Dui (below little finger)": "lake; speech, pleasure, the youngest child"},
            "difference": ("Read against the eight trigrams and five elements, not the "
                           "seven planets. The same region of the hand carries a different "
                           "name and a different meaning from the Western mount."),
            "limit": "Requires an observed hand."}


# ══════════════════════════════════════════════════════════════════════════════
# PHYSIOGNOMY, TASSEOGRAPHY, SCRYING, DOWSING, MOLEOSOPHY
# ══════════════════════════════════════════════════════════════════════════════

def physiognomy_framework() -> Dict:
    """European physiognomy — given with its history stated, because that history matters.

    Lavater's system was influential into the 19th century and fed directly into
    phrenology and then into scientific racism. It is included because it existed and the
    index is an index; it is dated and flagged rather than presented as usable insight."""
    return {
        "system": "Physiognomy (European)", "computed": False,
        "elements": {
            "forehead": "reasoning and disposition, in Lavater's scheme",
            "eyes": "the seat of character; the feature Lavater weighted most",
            "nose": "will and enterprise",
            "mouth": "appetite and sociability",
            "chin": "resolve",
        },
        "history": ("Systematised by Johann Kaspar Lavater in the 1770s and widely believed "
                    "into the 19th century. It fed directly into phrenology and from there "
                    "into scientific racism, and its claims about character from facial "
                    "structure have no empirical support."),
        "position": ("Catalogued because it existed and was practised. Flagged rather than "
                     "offered — a system used to justify harm should be labelled as such "
                     "wherever it is listed."),
    }


TEA_SECTORS = {
    "rim": "the present, and the immediate weeks",
    "side": "the coming months — the further down, the further out",
    "bottom": "the distant future, and things that will not resolve soon",
    "handle_near": "the querent's own household and self",
    "handle_opposite": "strangers, distance, and what comes from outside",
}
TEA_SHAPES = {
    "bird": "news arriving — swift if flying, delayed if at rest",
    "ring": "completion, or marriage; broken means an agreement fails",
    "line": "a journey — straight is direct, wavy is uncertain",
    "cross": "trial and obstruction",
    "heart": "love, or a matter of affection",
    "tree": "growth and improvement, especially in health",
    "mountain": "an obstacle, or a powerful friend, depending on whether it is climbed",
    "snake": "an enemy, or hidden knowledge",
    "anchor": "stability reached, usually in work",
    "star": "good fortune, and the wish granted",
}


def tasseography(sector: str, shape: str) -> Dict:
    """Reading a cup. The SECTORS are determinate — position in the cup means time and
    relationship by a fixed convention — while the shapes are the reader's perception."""
    s, sh = str(sector).lower(), str(shape).lower()
    return {"system": "Tasseography", "sector": s,
            "sector_meaning": TEA_SECTORS.get(s, "unrecognised sector"),
            "shape": sh, "shape_meaning": TEA_SHAPES.get(sh, "unrecognised shape"),
            "convention": ("The cup is turned three times anticlockwise and inverted on "
                           "the saucer; the handle points at the querent and orients "
                           "everything else."),
            "limit": "The sectors are conventional and fixed. The shapes are perceived, "
                     "not computed."}


def scrying_framework() -> Dict:
    return {"system": "Scrying", "computed": False,
            "media": {"mirror": "black mirror or obsidian; the classical European medium",
                      "crystal": "beryl or quartz sphere — the shewstone",
                      "water": "a dark bowl, sometimes with ink or oil floated on it",
                      "flame": "candle or fire gazing (pyromancy)",
                      "ink": "a pool in the palm — the Egyptian and Arabic method"},
            "method": ("Low light, a fixed gaze held past the point of comfort, and a "
                       "question held loosely. What is reported is a perceptual effect of "
                       "sustained fixation — the Troxler fade — which the traditions "
                       "describe accurately even where they explain it differently."),
            "limit": "There is nothing to compute. Scrying is a technique, not a system."}


def dowsing(question: str, convention: str = "standard") -> Dict:
    """The pendulum. The one determinate part is the CONVENTION — the operator establishes
    which swing means yes before asking anything, and a reading without that step is not a
    dowsing at all."""
    return {"system": "Dowsing / pendulum", "question": str(question or ""),
            "convention": {
                "establish_first": ("Before any question, ask the pendulum to show 'yes' "
                                    "and then 'no'. The answers are personal to the "
                                    "operator and must be re-established each session."),
                "standard": "clockwise or toward-and-away for yes; anticlockwise or "
                            "side-to-side for no",
                "neutral": "a still or erratic pendulum means the question is malformed, "
                           "not that the answer is no",
            },
            "computed": False,
            "note": ("The ideomotor effect accounts for the movement, and the traditions "
                     "that insist the operator must not watch the pendulum directly are, "
                     "in effect, describing it.")}


MOLE_POSITIONS = {
    "forehead": "fortune and authority; on the right, wealth through one's own effort",
    "between the brows": "an unusual destiny — leadership, or a life out of the ordinary",
    "right eyebrow": "an early and fortunate marriage",
    "left eyebrow": "delays in partnership, and effort in it",
    "nose": "travel and enterprise; on the tip, a temper",
    "cheek": "on the right, gravity and duty; on the left, thrift and privacy",
    "lip": "appetite, charm, and a taste for pleasure",
    "chin": "steadiness in later life and a settled home",
    "neck": "on the front, an easy nature; behind, a hidden one",
    "shoulder": "burden carried willingly; industry",
    "chest": "on the right, comfort; on the left, struggle then reward",
    "palm": "wealth by one's own hand",
    "sole of foot": "restlessness — a traveller",
}


def moleosophy(position: str) -> Dict:
    """Reading a mole by its position. The position map is fixed and is what the tradition
    consists of."""
    p = str(position).lower().strip()
    return {"system": "Moleosophy", "position": p,
            "meaning": MOLE_POSITIONS.get(p, "not in the traditional position map"),
            "known_positions": sorted(MOLE_POSITIONS),
            "note": ("A fixed position map — the tradition is the map. Sāmudrika Śāstra "
                     "carries an Indian version of the same idea with a longer list.")}


assert len(FACE_PALACES) == 12, "the twelve facial palaces"
assert FACE_AGE_MAP[0][0] == 1 and FACE_AGE_MAP[-1][1] == 100, "the age map must span 1-100"
for _i in range(len(FACE_AGE_MAP) - 1):
    assert FACE_AGE_MAP[_i][1] + 1 == FACE_AGE_MAP[_i + 1][0], "the age map has a gap"
assert len(PALM_MOUNTS) == 8 and len(HAND_SHAPES) == 4
