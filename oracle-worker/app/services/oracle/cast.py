"""
CASTING IN A CHAT — the server lays the cards, the way a reader does at a table.

In the app a draw is a picker: the person lays the cards themselves, and the reading follows. A chat has no table,
so when someone asks for a draw ("pull a card", "what does the I Ching say") the oracle casts for them here: the
same decks, spreads, meanings and pictures as the app (app/services/divination), drawn by the server, seeded so a
retried message gets the same cards, and handed to the reply as THE DRAW at the top of its briefing. The cast is
returned with the result, so a follow-up can be read against the same cards.
"""
import hashlib
import importlib
import random
from typing import Dict, List, Optional

DECKS = ("tarot", "iching", "runes", "ogham", "lenormand", "geomancy")
# The spread a chat question gets: three positions to read a situation; one for a plain yes-or-no.
SPREAD = {"tarot": "three", "lenormand": "three", "runes": "norns", "ogham": "land_sea_sky",
          "iching": "hexagram", "geomancy": "shield"}
SPREAD_YES_NO = {"tarot": "one", "lenormand": "one", "runes": "one", "ogham": "one"}
REVERSIBLE = {"tarot", "runes"}
WITH_REPEATS = {"iching", "geomancy"}        # a trigram or a figure may come up twice


def seed_for(*parts) -> int:
    return int(hashlib.sha1("|".join(str(p) for p in parts).encode()).hexdigest()[:12], 16)


def _module(deck: str):
    return importlib.import_module(f"app.services.divination.{deck}")


def cast(deck: str, question: str = "", seed: Optional[int] = None, question_type: str = "general") -> Optional[Dict]:
    """Lay a spread of `deck` for a question: {deck, title, spread, spread_name, picks, brief, extra}; None for a deck
    this does not know."""
    if deck not in DECKS:
        return None
    mod = _module(deck)
    rng = random.Random(seed if seed is not None else seed_for(deck, question))
    spread_id = (SPREAD_YES_NO.get(deck) if question_type == "yes_no" else None) or SPREAD.get(deck) or mod.DEFAULT_SPREAD
    sp = mod.SPREADS.get(spread_id) or mod.SPREADS[mod.DEFAULT_SPREAD]
    by = {c["id"]: c for c in mod.DECK}
    ids = list(by)
    n = len(sp["positions"])
    chosen = [rng.choice(ids) for _ in range(n)] if deck in WITH_REPEATS else rng.sample(ids, n)
    picks: List[Dict] = []
    for pos, cid in zip(sp["positions"], chosen):
        rev = deck in REVERSIBLE and rng.random() < 0.3
        picks.append({"position": pos["id"], "label": pos.get("label", pos["id"]), "meaning": pos.get("meaning", ""),
                      "card": cid, "name": by[cid]["name"], "reversed": rev})
    extra = {}
    if deck == "iching":
        hx = mod.hexagram(picks[0]["card"], picks[1]["card"])
        if hx:
            extra = {"hexagram": hx["chinese"], "key": hx["key"], "lower": hx["lower"], "lower_seed": hx["lower_seed"],
                     "upper": hx["upper"], "upper_seed": hx["upper_seed"],
                     "hidden": (mod.nuclear_hexagram(hx["key"]) or {}).get("chinese")}
    elif deck == "geomancy":
        sh = mod.shield([p["card"] for p in picks])
        if sh:
            extra = {"judge": sh["judge"], "judge_seed": sh["judge_seed"], "right_witness": sh["right_witness"],
                     "right_seed": sh["right_seed"], "left_witness": sh["left_witness"], "left_seed": sh["left_seed"]}
    return {"deck": deck, "title": getattr(mod, "TITLE", deck.title()), "spread": spread_id, "spread_name": sp["name"],
            "picks": picks, "extra": extra, "brief": _brief(mod, deck, sp, picks, extra, by)}


def _item(mod, deck: str, card: Dict, reversed_: bool) -> str:
    describe = getattr(mod, "describe", None)
    if callable(describe):
        try:
            return describe(card, reversed_)
        except Exception:
            pass
    return f'{card["name"]}{" (reversed)" if reversed_ else ""}: {card.get("seed", "")}'


def _brief(mod, deck: str, sp: Dict, picks: List[Dict], extra: Dict, by: Dict) -> str:
    noun = getattr(mod, "NOUN", "card")
    head = (f"THE DRAW — you cast {getattr(mod, 'TITLE', deck)} for them just now ({sp['name']}). It is your answer "
            f"to what they asked: read it as the heart of the reply, in your own voice, and name what came up so they "
            f"can follow it; let the chart behind it deepen it, not replace it.")
    if deck == "iching" and extra:
        return (f"{head}\n- The hexagram {extra['hexagram']}: lower (inner) trigram {extra['lower']} [{extra['lower_seed']}], "
                f"upper (outer) trigram {extra['upper']} [{extra['upper_seed']}]. Its hidden (nuclear) hexagram is "
                f"{extra.get('hidden') or '—'}: what is working underneath.")
    if deck == "geomancy" and extra:
        mothers = ", ".join(p["name"] for p in picks)
        return (f"{head}\n- The four Mothers: {mothers}.\n- Right Witness {extra['right_witness']} [{extra['right_seed']}]: "
                f"the querent, the past.\n- Left Witness {extra['left_witness']} [{extra['left_seed']}]: the matter, the "
                f"future.\n- The JUDGE {extra['judge']} [{extra['judge_seed']}]: the verdict of the whole question.")
    lines = [f"- {p['label']} ({p['meaning']}): {_item(mod, deck, by[p['card']], p['reversed'])}" for p in picks]
    tail = f" Read the {noun}s together, how they speak to each other across the spread." if len(picks) > 1 else ""
    return head + tail + "\n" + "\n".join(lines)
