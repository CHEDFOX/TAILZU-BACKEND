"""
PLUM BLOSSOM (梅花易數 · Mei Hua Yi Shu) — divination from number alone.

Attributed to Shao Yong (1011–1077). Where Liu Yao charges the hexagram with branches and
reads six relatives, Plum Blossom throws all of that away and reads one relation: between
the trigram that stands for the QUERENT (體 tǐ, the Body) and the trigram that stands for
the MATTER (用 yòng, the Use). Everything follows from which of the five phases each is in.

Its reputation comes from needing no ritual and no cast — any two numbers will do: the
time, a count of strokes in a written character, the number of birds that just passed. The
tradition's own framing is that the moment supplies the number, so the method is a way of
reading a moment rather than of consulting a text.

CASTING
  upper trigram = n1 mod 8      (0 → 8, Kun)
  lower trigram = n2 mod 8
  moving line   = (n1 + n2) mod 6   (0 → 6), counted from the bottom
  體 is the trigram WITHOUT the moving line; 用 is the one WITH it.

Trigram numbers follow the 先天 (Earlier Heaven / Fu Xi) sequence, which is the sequence
Shao Yong used. The 後天 (Later Heaven) sequence assigns different numbers and would give
different hexagrams — a real fork, noted rather than silently chosen.
"""
from typing import Dict, Optional, Tuple

from app.services.divination.iching import HEX, nuclear_hexagram, changed_hexagram

# 先天 numbering — Shao Yong's sequence.
XIANTIAN = [
    (1, "qian", "乾", "Heaven", "111", "metal"),
    (2, "dui",  "兌", "Lake",   "011", "metal"),
    (3, "li",   "離", "Fire",   "101", "fire"),
    (4, "zhen", "震", "Thunder", "001", "wood"),
    (5, "xun",  "巽", "Wind",   "110", "wood"),
    (6, "kan",  "坎", "Water",  "010", "water"),
    (7, "gen",  "艮", "Mountain", "100", "earth"),
    (8, "kun",  "坤", "Earth",  "000", "earth"),
]
_BY_NUM = {t[0]: t for t in XIANTIAN}
_BY_ID = {t[1]: t for t in XIANTIAN}

GENERATES = {"wood": "fire", "fire": "earth", "earth": "metal",
             "metal": "water", "water": "wood"}
CONTROLS = {"wood": "earth", "earth": "water", "water": "fire",
            "fire": "metal", "metal": "wood"}

# The five verdicts, in the tradition's own order of preference.
_VERDICTS = {
    "yong_generates_ti": (
        "用生體 — most favourable",
        "The matter feeds the querent. Help arrives from outside without being forced; "
        "what is sought comes toward them."),
    "same": (
        "比和 — favourable",
        "Body and Use are the same phase. Peers, not obstacles: the matter moves with "
        "the querent rather than against them."),
    "ti_controls_yong": (
        "體剋用 — favourable with effort",
        "The querent overcomes the matter. It yields, but only to work — the gain is real "
        "and it is earned."),
    "ti_generates_yong": (
        "體生用 — draining",
        "The querent feeds the matter. Energy and resources flow outward; the thing may "
        "complete, but at the querent's expense."),
    "yong_controls_ti": (
        "用剋體 — unfavourable",
        "The matter overcomes the querent. Pressure comes from outside and the position "
        "is not strong enough to resist it directly."),
}


def _relation(ti_elem: str, yong_elem: str) -> str:
    if ti_elem == yong_elem:
        return "same"
    if GENERATES.get(yong_elem) == ti_elem:
        return "yong_generates_ti"
    if GENERATES.get(ti_elem) == yong_elem:
        return "ti_generates_yong"
    if CONTROLS.get(ti_elem) == yong_elem:
        return "ti_controls_yong"
    return "yong_controls_ti"


def _tri(n: int) -> Tuple:
    return _BY_NUM[((int(n) - 1) % 8) + 1]


def cast(n1: int, n2: int, n3: Optional[int] = None) -> Dict:
    """Cast from two numbers (a third, if given, sets the moving line instead of the sum).

    Returns the primary, nuclear and changed hexagrams plus the Ti/Yong verdict."""
    upper = _tri(n1)
    lower = _tri(n2)
    total = int(n1) + int(n2) + (int(n3) if n3 is not None else 0)
    moving = ((total - 1) % 6) + 1

    key = upper[4] + lower[4]                       # upper top→bottom + lower top→bottom
    changed = changed_hexagram(key, [moving])
    nuclear = nuclear_hexagram(key)

    # The moving line sits in the lower trigram if it is 1-3, upper if 4-6.
    moving_in_upper = moving >= 4
    ti, yong = (lower, upper) if moving_in_upper else (upper, lower)

    rel = _relation(ti[5], yong[5])
    label, gloss = _VERDICTS[rel]

    return {
        "numbers": {"n1": int(n1), "n2": int(n2), "n3": (int(n3) if n3 is not None else None),
                    "sum": total},
        "hexagram": {"key": key, "chinese": HEX.get(key)},
        "upper": {"id": upper[1], "cn": upper[2], "name": upper[3], "element": upper[5],
                  "number": upper[0]},
        "lower": {"id": lower[1], "cn": lower[2], "name": lower[3], "element": lower[5],
                  "number": lower[0]},
        "moving_line": moving,
        "ti": {"id": ti[1], "cn": ti[2], "name": ti[3], "element": ti[5],
               "role": "the querent"},
        "yong": {"id": yong[1], "cn": yong[2], "name": yong[3], "element": yong[5],
                 "role": "the matter asked about"},
        "relation": rel, "verdict": label, "reading": gloss,
        "nuclear": nuclear, "changed": changed,
        "convention": "先天 (Earlier Heaven) trigram numbering, per Shao Yong.",
    }


def cast_from_time(year_branch_index: int, month: int, day: int, hour_branch_index: int) -> Dict:
    """The classical time cast (時間起卦).

    upper = (year + month + day) mod 8; lower = (year + month + day + hour) mod 8;
    moving = the same total mod 6. `year_branch_index` is 1-12 for 子..亥, and
    `hour_branch_index` likewise — NOT the western hour."""
    base = int(year_branch_index) + int(month) + int(day)
    return _cast_time(base, int(hour_branch_index))


def _cast_time(base: int, hour_idx: int) -> Dict:
    upper = _tri(base)
    lower = _tri(base + hour_idx)
    total = base + hour_idx
    moving = ((total - 1) % 6) + 1
    key = upper[4] + lower[4]
    moving_in_upper = moving >= 4
    ti, yong = (lower, upper) if moving_in_upper else (upper, lower)
    rel = _relation(ti[5], yong[5])
    label, gloss = _VERDICTS[rel]
    return {
        "numbers": {"base": base, "hour_index": hour_idx, "sum": total},
        "hexagram": {"key": key, "chinese": HEX.get(key)},
        "upper": {"id": upper[1], "cn": upper[2], "name": upper[3], "element": upper[5]},
        "lower": {"id": lower[1], "cn": lower[2], "name": lower[3], "element": lower[5]},
        "moving_line": moving,
        "ti": {"id": ti[1], "cn": ti[2], "name": ti[3], "element": ti[5], "role": "the querent"},
        "yong": {"id": yong[1], "cn": yong[2], "name": yong[3], "element": yong[5],
                 "role": "the matter asked about"},
        "relation": rel, "verdict": label, "reading": gloss,
        "nuclear": nuclear_hexagram(key), "changed": changed_hexagram(key, [moving]),
        "convention": "先天 numbering; time cast (時間起卦).",
    }


def summary(r: Dict) -> str:
    if not r:
        return ""
    h = r["hexagram"]
    return "\n".join([
        f"PLUM BLOSSOM — {h['chinese']} ({h['key']}), moving line {r['moving_line']}",
        f"  上 {r['upper']['cn']} {r['upper']['name']} ({r['upper']['element']}) · "
        f"下 {r['lower']['cn']} {r['lower']['name']} ({r['lower']['element']})",
        f"  體 {r['ti']['cn']} {r['ti']['element']} (querent) vs "
        f"用 {r['yong']['cn']} {r['yong']['element']} (matter)",
        f"  {r['verdict']}",
        f"  {r['reading']}",
        f"  互 {r['nuclear']['chinese']} → 變 {r['changed']['chinese']}",
    ])
