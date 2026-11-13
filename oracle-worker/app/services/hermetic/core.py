"""
HERMETIC PRINCIPLES — the seven laws of the Kybalion, as a birth lens.

Not astrology and not divination — a teaching. The seven principles are fixed and
canonical (Three Initiates, 1908, public domain). A birth is given the ONE principle
most alive for it (by its life-path number), the law it is here to learn and live.
"""

# (name, axiom, seed)
PRINCIPLES = [
    ("Mentalism",       "The All is Mind; the Universe is Mental.",
     "reality answers to what you hold in mind — you are the thinker, not the thought"),
    ("Correspondence",  "As above, so below; as below, so above.",
     "the small mirrors the great — your inner world is written across your outer life"),
    ("Vibration",       "Nothing rests; everything moves; everything vibrates.",
     "everything in you is motion and frequency — raise your note and your world rises"),
    ("Polarity",        "Everything is dual; opposites are identical in nature, different in degree.",
     "love and hate, warm and cold are one thing on a dial — you can turn it"),
    ("Rhythm",          "Everything flows, out and in; the pendulum-swing manifests in everything.",
     "the tide that carried you out will carry you back — ride the swing, don't fight it"),
    ("Cause and Effect","Every cause has its effect; every effect its cause; nothing is chance.",
     "you are either a cause or an effect — rise above the game and set things in motion"),
    ("Gender",          "Gender is in everything; the masculine and feminine principles are in all.",
     "the seed-force and the shaping-force both live in you — creation needs the two"),
]


def _reduce(n):
    while n > 9:
        n = sum(int(d) for d in str(n))
    return n


def hermetic(year, month, day):
    """The governing principle for a birth — its life-path (1-9) mapped across the seven
    laws (so the same law never lands twice by accident)."""
    total = sum(int(c) for c in f"{int(year)}{int(month):02d}{int(day):02d}")
    lp = _reduce(total)
    idx = (lp - 1) % 7
    name, axiom, seed = PRINCIPLES[idx]
    return {"life_path": lp, "index": idx, "name": name, "axiom": axiom, "seed": seed}


if __name__ == "__main__":
    for d in (15, 7, 22, 3):
        r = hermetic(1990, 5, d)
        print(f"LP{r['life_path']} → {r['name']}: {r['axiom']}")
    assert len(PRINCIPLES) == 7
    print("structure OK")
