"""
GUNGHAP (궁합) — Korean marriage compatibility.

A formal practice in its own right, not a footnote to Saju. Families commissioned a
gunghap reading before agreeing a marriage, and the two halves it is built from are read
separately and can disagree:

  겉궁합 GEOT-GUNGHAP  the outer match, from the two birth-year animals. Quick, public,
                      and the one everybody knows — this is the layer behind "don't marry
                      a Tiger to a Snake".

  속궁합 SOK-GUNGHAP   the inner match, from the two day masters and the elemental balance
                      of the full pillars. Slower, private, and the one a practitioner
                      actually weights.

A pair can be strong outside and weak inside, which is precisely the finding the practice
exists to surface — and reporting a single blended score would destroy it. Both are
returned separately here, with the disagreement called out when it occurs.

The 원진 WONJIN pairs are the six animal combinations held to be actively hostile — worse
than merely unmatched — and they are named rather than folded into a number, because in
Korean practice a wonjin pairing is a specific objection with a specific remedy.
"""
from dataclasses import dataclass
from typing import Dict, Optional

from app.services.chinese.lunisolar import BRANCH_ANIMALS

ANIMALS_KO = ["쥐", "소", "호랑이", "토끼", "용", "뱀",
              "말", "양", "원숭이", "닭", "개", "돼지"]

# 삼합 — the three harmonies; the strongest outer match.
SAMHAP = [{8, 0, 4}, {5, 9, 1}, {2, 6, 10}, {11, 3, 7}]
# 육합 — the six unions; a strong pair bond.
YUKHAP = [(0, 1), (2, 11), (3, 10), (4, 9), (5, 8), (6, 7)]
# 충 — the six clashes; direct opposition.
CHUNG = [(0, 6), (1, 7), (2, 8), (3, 9), (4, 10), (5, 11)]
# 원진 — the six hostilities. Distinct from a clash and worse; a specific objection.
WONJIN = [(0, 7), (1, 6), (2, 9), (3, 8), (4, 11), (5, 10)]

_PRODUCES = {"Wood": "Fire", "Fire": "Earth", "Earth": "Metal",
             "Metal": "Water", "Water": "Wood"}
_CONTROLS = {"Wood": "Earth", "Earth": "Water", "Water": "Fire",
             "Fire": "Metal", "Metal": "Wood"}


def _pair_in(a: int, b: int, pairs) -> bool:
    return (a, b) in pairs or (b, a) in pairs


def outer_match(branch_a: int, branch_b: int) -> Dict:
    """겉궁합 — the year-animal match."""
    a, b = int(branch_a) % 12, int(branch_b) % 12
    if a == b:
        kind, score = ("같은 띠 — the same sign; easy sympathy, and the same blind spots", 65)
    elif any({a, b} <= s for s in SAMHAP):
        kind, score = ("삼합 — the three harmonies; the strongest outer match there is", 95)
    elif _pair_in(a, b, YUKHAP):
        kind, score = ("육합 — the six unions; a close and binding pair", 88)
    elif _pair_in(a, b, WONJIN):
        kind, score = ("원진 — hostility; the tradition's specific objection, worse than a clash", 25)
    elif _pair_in(a, b, CHUNG):
        kind, score = ("충 — a clash; direct opposition, workable only with effort on both sides", 35)
    else:
        kind, score = ("평 — neutral; neither helped nor hindered by the signs", 60)
    return {"animals": [BRANCH_ANIMALS[a], BRANCH_ANIMALS[b]],
            "korean": [ANIMALS_KO[a], ANIMALS_KO[b]],
            "relation": kind, "score": score,
            "is_wonjin": _pair_in(a, b, WONJIN)}


def inner_match(element_a: str, strength_a: str, element_b: str, strength_b: str) -> Dict:
    """속궁합 — the day-master match, which is what a practitioner actually weights."""
    ea, eb = element_a, element_b
    if _PRODUCES.get(ea) == eb:
        rel, score = (f"{ea} feeds {eb} — one gives and one receives; warm, and unequal "
                      f"if the giving is never returned", 85)
    elif _PRODUCES.get(eb) == ea:
        rel, score = (f"{eb} feeds {ea} — the same bond the other way round", 85)
    elif ea == eb:
        rel, score = (f"both {ea} — alike, which is comfortable and doubles every excess", 70)
    elif _CONTROLS.get(ea) == eb:
        rel, score = (f"{ea} controls {eb} — one leads; workable where that is wanted, "
                      f"corrosive where it is not", 45)
    elif _CONTROLS.get(eb) == ea:
        rel, score = (f"{eb} controls {ea} — the same imbalance reversed", 45)
    else:
        rel, score = ("no direct elemental relation — independent, and requiring "
                      "deliberate effort to stay close", 60)
    # Two strong day masters contend; two weak ones drift.
    sa, sb = strength_a.startswith("신강"), strength_b.startswith("신강")
    if sa and sb:
        score -= 10
        note = "both day masters strong — two people who will not yield; expect contention"
    elif not sa and not sb:
        score -= 5
        note = "both day masters weak — mutual sympathy, and no one steering"
    else:
        score += 8
        note = "one strong, one yielding — the balance Korean practice reads as favourable"
    return {"elements": [ea, eb], "relation": rel,
            "score": max(0, min(100, score)), "strength_note": note}


@dataclass
class Gunghap:
    outer: Dict
    inner: Dict
    verdict: str
    disagreement: Optional[str]

    def as_dict(self) -> Dict:
        return {"system": "Gunghap (궁합)", "outer": self.outer, "inner": self.inner,
                "verdict": self.verdict, "disagreement": self.disagreement,
                "note": ("겉궁합 and 속궁합 are read separately and are not averaged. A pair "
                         "can match outwardly and not inwardly, and surfacing that is the "
                         "point of the practice.")}

    def summary(self) -> str:
        lines = [
            "궁합 — Korean compatibility",
            f"  겉궁합 outer  {self.outer['score']:>3d}  {self.outer['korean'][0]}–"
            f"{self.outer['korean'][1]}  {self.outer['relation']}",
            f"  속궁합 inner  {self.inner['score']:>3d}  {self.inner['relation']}",
            f"                {self.inner['strength_note']}",
            "",
            f"  {self.verdict}",
        ]
        if self.disagreement:
            lines.append(f"  {self.disagreement}")
        return "\n".join(lines)


def gunghap(a: Dict, b: Dict) -> Gunghap:
    """Compatibility from two birth dicts (year, month, day, hour, minute, gender)."""
    from .saju import saju

    sa = saju(int(a["year"]), int(a.get("month", 1)), int(a.get("day", 1)),
              int(a.get("hour", 12)), int(a.get("minute", 0)), a.get("gender", "male"))
    sb = saju(int(b["year"]), int(b.get("month", 1)), int(b.get("day", 1)),
              int(b.get("hour", 12)), int(b.get("minute", 0)), b.get("gender", "female"))

    outer = outer_match(sa.pillars["year"]["branch_index"],
                        sb.pillars["year"]["branch_index"])
    inner = inner_match(sa.day_master["element"], sa.strength,
                        sb.day_master["element"], sb.strength)

    combined = round(outer["score"] * 0.35 + inner["score"] * 0.65)
    verdict = ("상격 — a strong match by both readings" if combined >= 80 else
               "중상격 — a good match, with a named cost" if combined >= 68 else
               "중격 — workable; neither favoured nor opposed" if combined >= 55 else
               "하격 — the readings are against it, and the tradition would say so plainly")

    gap = abs(outer["score"] - inner["score"])
    dis = None
    if gap >= 25:
        which = "outer" if outer["score"] > inner["score"] else "inner"
        other = "inner" if which == "outer" else "outer"
        dis = (f"The two readings DISAGREE sharply — strong {which}, weak {other}. This is "
               f"the case the practice exists to catch: "
               + ("a couple who look well matched and are not."
                  if which == "outer" else
                  "a couple who look ill matched and are not."))
    if outer.get("is_wonjin"):
        dis = ((dis + " ") if dis else "") + \
            "원진 pairing — a specific objection in Korean practice, not a low score."
    return Gunghap(outer=outer, inner=inner, verdict=verdict, disagreement=dis)


# Structure: the four sets must partition the twelve branches without overlap.
assert sum(len(s) for s in SAMHAP) == 12 and len(set().union(*SAMHAP)) == 12
for _name, _pairs in (("yukhap", YUKHAP), ("chung", CHUNG), ("wonjin", WONJIN)):
    assert len(_pairs) == 6, f"{_name} must hold six pairs"
    _flat = [x for p in _pairs for x in p]
    assert sorted(_flat) == list(range(12)), f"{_name} must cover each branch once"
