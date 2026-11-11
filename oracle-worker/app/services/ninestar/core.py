"""
NINE STAR KI (九星気学) — the principal star from the birth year.

Formula and element/direction/trigram tables verified against the vedika-io/xalen
ephemeris crate, whose own tests anchor 2020=7 (Metal), 2024=3 (Tree), 2025=2 (Earth).
The solar year turns at risshun (~Feb 4): births before Feb 4 use the previous year.
Star colour-names are the standard 九星 set (一白…九紫).
"""
from dataclasses import dataclass

# index 1..9 → (colour name, element, auspicious direction, trigram, personality seed)
STARS = {
    1: ("One White", "Water", "North", "Kan", "adaptable, intuitive, diplomatic — the deep flow"),
    2: ("Two Black", "Earth", "Southwest", "Kun", "nurturing, patient, supportive — the receptive ground"),
    3: ("Three Jade", "Wood", "East", "Zhen", "energetic, pioneering, honest — the initiator"),
    4: ("Four Green", "Wood", "Southeast", "Xun", "gentle, influential, harmonising — the persuader"),
    5: ("Five Yellow", "Earth", "Center", "—", "powerful, central, magnetic — the pivot of all"),
    6: ("Six White", "Metal", "Northwest", "Qian", "dignified, principled, responsible — the leader"),
    7: ("Seven Red", "Metal", "West", "Dui", "charming, expressive, sociable — the communicator"),
    8: ("Eight White", "Earth", "Northeast", "Gen", "steady, ambitious, reforming — the mountain"),
    9: ("Nine Purple", "Fire", "South", "Li", "passionate, brilliant, proud — the illuminator"),
}


@dataclass
class NineStar:
    star: int            # 1..9
    name: str
    element: str
    direction: str
    trigram: str
    seed: str


def _year_star(year: int) -> int:
    rem = year % 9
    raw = (11 - rem) % 9
    return 9 if raw == 0 else raw


def nine_star(year: int, month: int, day: int) -> NineStar:
    y = int(year)
    if int(month) < 2 or (int(month) == 2 and int(day) < 4):    # before risshun (~Feb 4)
        y -= 1
    s = _year_star(y)
    name, elem, direction, trigram, seed = STARS[s]
    return NineStar(star=s, name=name, element=elem, direction=direction, trigram=trigram, seed=seed)
