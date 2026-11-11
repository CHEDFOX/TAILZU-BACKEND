"""
FEATURE SHOWCASE — turn a chat answer into an invitation to open the matching feature.

When a question clearly lands on something Plutto can *show* (a dasha timeline, a
compatibility match, a transit reading…), the classifier picks the feature from the
per-system menu below and the chat reply carries ONE hook — a 1–2 word "explore"
button. The frontend's `openFeature(target)` resolves the id via the catalog and opens
it. Pure backend: to add/rename/retune a showcase, edit this file only.

Each entry: (catalog_section_id, button_label, [trigger topics/keywords]).
The `id` MUST be a real catalog section id (app/services/catalog/data.py SECTIONS),
because that is what `openFeature` can resolve.
"""
from typing import Dict, List, Optional

# Universal numerology / topic features — offered under every system.
_UNIVERSAL: List[tuple] = [
    ("core_numbers",  "Your Numbers",  ["numerology", "numbers", "life path", "destiny number"]),
    ("angel_numbers", "Angel Number",  ["angel number", "repeating number", "111", "222", "333"]),
    ("compatibility_hook", "Compatibility", ["compatibility", "match", "partner match"]),
    ("person_reading", "Read Someone", ["my husband", "my wife", "my partner", "my mother",
                                       "my father", "my son", "my daughter", "my friend",
                                       "someone else", "another person", "their chart",
                                       "his chart", "her chart"]),
    ("place_match",   "A Place for You", ["place", "city", "country", "move", "relocate", "relocation",
                                          "where to live", "where should i live", "location", "abroad", "settle"]),
    ("topics_screen", "Life Topics",   ["desire", "sex", "money topic", "explore topics"]),
]

# Per-system showcasable features. Order matters only for the deterministic fallback
# (first strong topic match wins); the classifier can pick any id in the menu.
SHOWCASE: Dict[str, List[tuple]] = {
    "bphs": [
        ("dashas",          "Dashas",        ["timing", "when", "period", "phase", "dasha", "mahadasha"]),
        ("transits",        "Transits",      ["now", "current", "today", "gochara", "transit", "sade sati"]),
        ("yogas",           "Yogas",         ["yoga", "potential", "combination", "raja yoga", "gift"]),
        ("doshas",          "Doshas",        ["dosha", "affliction", "manglik", "kaal sarp", "problem"]),
        ("compatibility",   "Compatibility", ["marriage", "spouse", "partner", "match", "guna milan", "relationship"]),
        ("past_life",       "Past Life",     ["past life", "karma", "previous birth", "purva janma"]),
        ("life_story",      "Life Story",    ["life story", "life purpose", "my journey", "whole life"]),
        ("muhurta",         "Muhurta",       ["auspicious time", "muhurta", "good time to", "when to start"]),
        ("kp_horary",       "Prashna",       ["will it happen", "yes or no", "prashna", "horary"]),
        ("core_chart",      "Your Chart",    ["chart", "grahas", "planets", "kundli", "birth chart"]),
        ("numbers_vedic",   "Ank Jyotish",   ["ank", "vedic numerology"]),
    ],
    "western": [
        ("western_transits",    "Transits",    ["now", "current", "today", "transit", "what's happening"]),
        ("western_profections", "Profections", ["this year", "year ahead", "profection", "annual"]),
        ("western_patterns",    "Aspects",     ["aspect", "pattern", "configuration"]),
        ("western_tensions",    "Hard Aspects",["challenge", "tension", "hard aspect", "square", "struggle"]),
        ("western_balance",     "Temperament", ["temperament", "element balance", "my nature"]),
        ("western_compat",      "Synastry",    ["compatibility", "relationship", "partner", "synastry", "love"]),
        ("western_planets",     "Your Planets",["planets", "chart", "placements", "big three"]),
        ("numbers_western",     "Arithmancy",  ["numerology", "numbers", "arithmancy"]),
    ],
    "chinese": [
        ("chinese_luck",       "Luck Pillars", ["timing", "when", "luck", "decade", "da yun", "luck pillar"]),
        ("chinese_overlay",    "This Year",    ["this year", "annual", "year ahead", "liu nian"]),
        ("chinese_elements",   "Five Elements",["element", "wu xing", "balance", "my nature"]),
        ("chinese_balance",    "Yong Shen",    ["favorable element", "useful god", "yong shen", "lucky element"]),
        ("chinese_relations",  "Relations",    ["clash", "harmony", "he chong", "conflict"]),
        ("chinese_compat",     "He Hun",       ["compatibility", "relationship", "partner", "marriage", "he hun"]),
        ("chinese_animals",    "Your Animals", ["animal", "zodiac", "sheng xiao", "sign"]),
        ("chinese_auspicious", "Date Select",  ["auspicious date", "ze ri", "good day to", "date selection"]),
        ("numbers_chinese",    "Jiu Xing",     ["numerology", "numbers", "jiu xing"]),
    ],
}

# A showcased feature is only useful if the app can actually OPEN it. The catalog
# the app holds is scoped to the user's ACTIVE system + universal sections
# (catalog.py drops other systems), so we scope the showcase the same way. The
# chat LENS (`system`, which may be plutto or a cross-tradition lens) only decides
# tone; what's *openable* depends on the active system.
def _scope(system: str, active_system: Optional[str]) -> Optional[str]:
    s = (active_system or system or "bphs").lower()
    if s == "plutto":
        return None   # active tradition unknown → only universal features are guaranteed openable
    return s if s in SHOWCASE else "bphs"


def _concept_entries() -> List[tuple]:
    """Every system's CONCEPT features (yogas / transits / dashas / doshas / the Chinese
    & Western concept rails), de-duplicated. Under the Plutto lens these are recommended
    AS THEY ARE — each opens its own latest concept presentation inline (chat.py swaps
    the action to the education-reels + explore-active section), so catalog scoping never
    blocks them even though Plutto's catalog doesn't carry other systems' sections."""
    try:
        from app.services.catalog.data import CONCEPT_EDU
    except Exception:
        return []
    seen, out = set(), []
    for entries in SHOWCASE.values():
        for e in entries:
            if e[0] in CONCEPT_EDU and e[0] not in seen:
                seen.add(e[0])
                out.append(e)
    return out


def _entries(system: str, active_system: Optional[str] = None) -> List[tuple]:
    scope = _scope(system, active_system)
    if scope is None:
        # Plutto (the collective lens): the general/universal features — already
        # system-agnostic, i.e. collective — PLUS every system's concepts, recommended
        # as they are (opened inline, no catalog dependency).
        return _concept_entries() + list(_UNIVERSAL)
    return SHOWCASE[scope] + _UNIVERSAL


def menu(system: str, active_system: Optional[str] = None) -> str:
    """Rich id → name + PLAIN description + triggers, for the classifier prompt. The
    description (what the feature actually answers, in everyday words) is what lets the
    LLM pick the most RELEVANT feature for a question instead of keyword-matching jargon."""
    lines = []
    for sid, label, triggers in _entries(system, active_system):
        desc = _DESC.get(sid, "")
        d = f" — {desc}" if desc else ""
        lines.append(f'{sid} — "{label}"{d} (matches: {", ".join(triggers[:5])})')
    return "\n".join(lines)


# PLAIN-LANGUAGE description of what each feature ANSWERS / SHOWS — the signal the
# classifier LLM matches a question against (jargon labels alone made it pick badly).
# Keyed by catalog id; add a line when you add a showcase entry above.
_DESC: Dict[str, str] = {
    # universal
    "core_numbers":  "their core numerology — life-path & destiny numbers and what those say about them",
    "angel_numbers": "the meaning of a repeating number they keep seeing (111, 222, 333…)",
    "compatibility_hook": "how they and another person match — love/marriage compatibility across every tradition",
    "person_reading": "read ANOTHER PERSON — partner, parent, child, friend or colleague. Takes THAT person's birth details and shows their own chart, with a chat to ask about them. Pick this whenever the question is about someone other than the user, whose chart cannot answer it",
    "place_match":   "how a specific place on Earth would treat them — where to live, move, travel or settle",
    "topics_screen": "deep readings on a charged life-area — desire, sex, money, purpose",
    # vedic (bphs)
    "dashas":        "their life TIMING — which chapter/period is running now, what's coming next, and WHEN things ripen",
    "transits":      "what the sky is doing RIGHT NOW and how today/this phase touches them (incl. Sade Sati)",
    "yogas":         "the special planetary combinations that are their gifts, strengths and strokes of luck",
    "doshas":        "the afflictions in their chart (Manglik, Kaal Sarp…) — what's hard and how to ease it",
    "compatibility": "how well they and a partner match for marriage/relationship (Guna Milan)",
    "past_life":     "their past-life karma — what carried over into this birth and why",
    "life_story":    "their whole life as one arc — purpose and the shape of their journey",
    "muhurta":       "the auspicious TIME to begin something — a launch, wedding, move, new venture",
    "kp_horary":     "a yes/no answer to one specific question they're holding right now",
    "core_chart":    "their full birth chart — the planets and exactly how they're placed",
    "numbers_vedic": "their Vedic numerology (Ank Jyotish) — their numbers and meanings",
    # western
    "western_transits":    "what the sky is doing now and how it's moving their life",
    "western_profections": "the theme of their YEAR ahead (annual profection) — what this year is about",
    "western_patterns":    "the aspect patterns/configurations that shape who they are",
    "western_tensions":    "their hard aspects — the challenges, friction and inner tension",
    "western_balance":     "their temperament — the elemental balance in their nature",
    "western_compat":      "relationship compatibility (synastry) with a specific partner",
    "western_planets":     "their planets and placements — the Big Three and beyond",
    "numbers_western":     "their numerology (Arithmancy) — their numbers and meanings",
    # chinese
    "chinese_luck":       "their luck TIMING by decade (Luck Pillars / Da Yun) — when fortune turns",
    "chinese_overlay":    "their YEAR ahead (Liu Nian) — what this year brings them",
    "chinese_elements":   "their five-element makeup (Wu Xing) and what it means for them",
    "chinese_balance":    "their most favourable/useful element (Yong Shen) — what to lean on",
    "chinese_relations":  "the clashes and harmonies between them and others",
    "chinese_compat":     "relationship compatibility (He Hun) with a specific partner",
    "chinese_animals":    "their zodiac animals and what each signifies",
    "chinese_auspicious": "picking an auspicious DATE to do something (Ze Ri)",
    "numbers_chinese":    "their numerology (Jiu Xing) — their numbers and meanings",
}


def valid_ids(system: str, active_system: Optional[str] = None) -> set:
    return {e[0] for e in _entries(system, active_system)}


def _fallback_id(system: str, intent: Dict, active_system: Optional[str] = None) -> Optional[str]:
    """Deterministic backup: match the classifier's TOPIC to a feature, on whole words,
    when the classifier didn't name one.

    It also searched the private intent note, by substring, which overrode a classifier
    that had deliberately said "no feature fits" — "They want to KNOW…" matched "now"
    and showed Transits, "unSETTLEd", "rePLACEd" and "reMOVE" showed "A Place for You",
    "misMATCH" showed Compatibility. The note is a sentence about feelings; the topic is
    the one field written to be matched."""
    import re
    entries = _entries(system, active_system)
    hay = " ".join(str(intent.get(k, "") or "").lower() for k in ("topic", "secondary_topic")).strip()
    if not hay:
        return None
    for sid, _label, triggers in entries:
        if any(re.search(r"(?<![a-z0-9])" + re.escape(t) + r"(?![a-z0-9])", hay) for t in triggers):
            return sid
    return None


def build_hook(system: str, intent: Dict, active_system: Optional[str] = None,
               current_section: Optional[str] = None) -> Optional[Dict]:
    """Return ONE showcase hook dict, or None. Gated off for small talk / off-topic.
    Only ever targets a feature the app can actually open (universal + active system)."""
    if intent.get("small_talk") or intent.get("off_topic"):
        return None
    ids = valid_ids(system, active_system)
    chosen = intent.get("showcase_feature")
    if not (isinstance(chosen, str) and chosen in ids):
        chosen = _fallback_id(system, intent, active_system)
    return hook_for(system, chosen, active_system, current_section)


def hook_for(system: str, chosen: Optional[str], active_system: Optional[str] = None,
             current_section: Optional[str] = None) -> Optional[Dict]:
    """A hook for one NAMED feature id, or None if it isn't openable here.

    Split out of build_hook so alternatives can be built the same way: "show me my
    chart" has several equally true answers (the Vedic chart, the Western planets,
    the divisional charts) and picking one silently is a guess. The registry label
    is used as-is — the oracle writes a tuned label for the primary chip only, and
    the alternatives read better as their own plain names anyway."""
    ids = valid_ids(system, active_system)
    if not chosen or chosen not in ids:
        return None
    if current_section and chosen == current_section:
        return None   # don't suggest the feature they're already looking at
    label = next((lbl for sid, lbl, _ in _entries(system, active_system) if sid == chosen), None)
    if not label:
        return None
    return {
        "label": label,
        "action": {"type": "open_feature", "target": chosen},
    }
