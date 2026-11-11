"""
LO SHU GRID — computable numerology on the 3×3 magic square.

The Lo Shu square is a fixed magic square (every row, column and diagonal sums to 15).
Birth-date digits are placed into their cells; the pattern of what's present, missing,
repeated and collinear is the reading. Pure, self-verifying mathematics.

    4 9 2
    3 5 7
    8 1 6

Also computes the Driver (birth-day root) and the Life Path (full-date root) — the two
key numbers traditionally added to the grid.
"""
from dataclasses import dataclass
from typing import Dict, List

MAGIC_SQUARE = [[4, 9, 2], [3, 5, 7], [8, 1, 6]]
POS = {n: (r, c) for r, row in enumerate(MAGIC_SQUARE) for c, n in enumerate(row)}

# The 8 lines of the grid (as number-sets) + what each axis governs.
LINES = [
    (frozenset({4, 9, 2}), "the mental plane — thought, memory, imagination"),
    (frozenset({3, 5, 7}), "the emotional plane — feeling, will, intuition"),
    (frozenset({8, 1, 6}), "the practical plane — action, order, doing"),
    (frozenset({4, 3, 8}), "the plane of thought — planning and analysis"),
    (frozenset({9, 5, 1}), "the plane of will — determination and drive"),
    (frozenset({2, 7, 6}), "the plane of action — energy and activity"),
    (frozenset({4, 5, 6}), "the golden diagonal — willpower and kindness"),
    (frozenset({2, 5, 8}), "the silver diagonal — sensitivity and compassion"),
]

# Standard Pythagorean single-digit meanings (the conventional set).
DIGIT_MEANING = {
    1: "the self — independence, leadership, ego, drive",
    2: "sensitivity — intuition, partnership, peacemaking",
    3: "expression — creativity, communication, joy",
    4: "order — work, structure, the patient builder",
    5: "freedom — change, the senses, the balancing centre",
    6: "love — home, responsibility, nurture",
    7: "spirit — analysis, introspection, faith",
    8: "power — ambition, material mastery, karma",
    9: "wisdom — compassion, the humanitarian, completion",
}


def _root(n: int) -> int:
    n = abs(int(n))
    while n > 9:
        n = sum(int(c) for c in str(n))
    return n or 9 if n == 0 else n   # keep 0→9 out; a 0 day can't occur, guard anyway


def digital_root(n: int) -> int:
    n = abs(int(n))
    while n > 9:
        n = sum(int(c) for c in str(n))
    return n


@dataclass
class LoShu:
    counts: Dict[int, int]                 # number → occurrences (1..9)
    grid: List[List[str]]                  # 3×3 of repeated-digit strings ("", "5", "55")
    missing: List[int]
    repeated: List[int]                    # numbers appearing 2+ times
    strength_lines: List[str]              # fully-present lines (arrows of strength)
    absent_lines: List[str]                # fully-missing lines (arrows of absence)
    driver: int                            # birth-day root
    life_path: int                         # full-date root
    digits: str


def lo_shu_grid(day: int, month: int, year: int) -> LoShu:
    digits = f"{int(day):02d}{int(month):02d}{int(year)}"
    present = [int(c) for c in digits if c != "0"]
    counts = {n: present.count(n) for n in range(1, 10)}

    grid = [["", "", ""], ["", "", ""], ["", "", ""]]
    for n in range(1, 10):
        r, c = POS[n]
        grid[r][c] = str(n) * counts[n]

    missing = [n for n in range(1, 10) if counts[n] == 0]
    repeated = [n for n in range(1, 10) if counts[n] >= 2]
    have = {n for n in range(1, 10) if counts[n] > 0}
    strength = [desc for (line, desc) in LINES if line <= have]
    absent = [desc for (line, desc) in LINES if not (line & have)]

    return LoShu(
        counts=counts, grid=grid, missing=missing, repeated=repeated,
        strength_lines=strength, absent_lines=absent,
        driver=digital_root(day), life_path=digital_root(sum(int(c) for c in digits)),
        digits=digits,
    )
