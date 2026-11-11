"""
THE WIDER COUNCIL — computed signatures from every system, for the Plutt0.8 meta-oracle.

TWO depths, both pure compute (no LLM, no network), both fully defensive:

  • wider_council()  — ONE short line per system: ambient convergence. Cheap enough to
    carry ALL systems at once so the oracle can feel where many of them agree.
  • deep_council()   — a FULL multi-field profile for the systems a question actually
    calls for: the day-sign AND its tone AND the solar station AND the long-count read
    (Mayan), the Sephirah AND its World AND the Path letter (Kabbalah), and so on. This
    is what makes the "minor" systems stand shoulder to shoulder with the big traditions
    (Vedic / KP / Western / Chinese / Mandala) instead of being a throwaway one-liner.

The pipeline scopes depth the same way it scopes the big systems: the cross-system
router picks which systems are relevant, the relevant minor ones go DEEP, and every
other system still contributes its one-line signature as ambient context.

Each adapter calls that system's OWN core compute and returns real, computed values;
any adapter that raises is dropped silently. Add a system with one entry in SIGNS.
"""
from typing import Optional, Iterable
import datetime


def _g(b, k, default):
    try:
        v = b.get(k)
        return v if v is not None else default
    except Exception:
        return default


def _date(b):
    return datetime.date(int(b["year"]), int(b["month"]), int(b["day"]))


# ══════════════════════════════════════════════════════════════════════════════
# ONE-LINERS — ambient convergence (kept tight on purpose)
# ══════════════════════════════════════════════════════════════════════════════

def _numerology(b, name):
    from app.services.numerology.core import get_numerology
    r = get_numerology(name or "", _date(b)) or {}
    mk = r.get("mulank") or {}
    if mk.get("number"):
        return f"life number {mk['number']} ({mk.get('name', '')}) — {str(mk.get('traits', '')).split(',')[0].strip().lower()}"
    return None


def _mayan(b, name):
    from app.services.mayan.core import mayan_signature
    s = mayan_signature(int(b["year"]), int(b["month"]), int(b["day"]))
    return f"{s.tzolkin} · the {s.tzolkin_sign_glyph} — {s.tzolkin_seed}"


def _celtic(b, name):
    from app.services.celtic.core import celtic_tree
    c = celtic_tree(int(b["month"]), int(b["day"]))
    return f"the {c.tree} — {c.seed}"


def _aztec(b, name):
    from app.services.aztec.core import tonalpohualli
    a = tonalpohualli(int(b["year"]), int(b["month"]), int(b["day"]))
    return f"{a.day} · the {a.sign_english} — {a.sign_seed}"


def _ninestar(b, name):
    from app.services.ninestar.core import nine_star
    n = nine_star(int(b["year"]), int(b["month"]), int(b["day"]))
    return f"{n.name} ({n.element}) — {n.seed}"


def _native(b, name):
    from app.services.native.core import native_totem
    t = native_totem(int(b["month"]), int(b["day"]))
    return f"the {t.name} ({t.clan}) — {t.seed}"


def _sacred(b, name):
    from app.services.sacred.core import sacred_geometry
    r = sacred_geometry(int(b["year"]), int(b["month"]), int(b["day"]))
    sld, pat = r["solid"], r["pattern"]
    return f"the {sld[0]} ({sld[1]}); the pattern of {pat[0]}"


def _hermetic(b, name):
    from app.services.hermetic.core import hermetic
    r = hermetic(int(b["year"]), int(b["month"]), int(b["day"]))
    return f"the Law of {r['name']} — {r['seed']}"


def _mahabote(b, name):
    from app.services.mahabote.core import mahabote
    m = mahabote(int(b["year"]), int(b["month"]), int(b["day"]))
    return f"{m.burmese} ({m.planet} · {m.animal}) — {m.seed}"


def _tibetan(b, name):
    from app.services.tibetan.core import tibetan_year
    t = tibetan_year(int(b["year"]))
    return f"{t.sign} — {t.animal_seed}"


def _egyptian(b, name):
    from app.services.egyptian.core import egyptian_decan
    e = egyptian_decan(int(b["year"]), int(b["month"]), int(b["day"]),
                       int(_g(b, "hour", 12)), int(_g(b, "minute", 0)))
    return f"the decan of {e['name']} (ruled by {e['ruler']}) — {e['ruler_seed']}"


def _alchemy(b, name):
    from app.services.alchemy.core import alchemy
    a = alchemy(int(b["year"]), int(b["month"]), int(b["day"]),
                int(_g(b, "hour", 12)), int(_g(b, "minute", 0)),
                float(_g(b, "lat", 28.6)), float(_g(b, "lng", 77.2)))
    return f"the metal {a.metal} — {a.metal_seed}; the work of {a.operation[0]}"


def _taoist(b, name):
    from app.services.taoist.core import taoist
    t = taoist(int(b["year"]), int(b["month"]), int(b["day"]),
               int(_g(b, "hour", 12)), int(_g(b, "minute", 0)))
    return f"the {t.phase} phase ({t.polarity}) — {t.seed}"


def _kabbalah(b, name):
    from app.services.kabbalah.core import tree_of_life
    r = tree_of_life(int(b["year"]), int(b["month"]), int(b["day"]), name or "")
    sp = r.sephirah
    return f"the sphere of {sp[3]} — {sp[4]}"


# ══════════════════════════════════════════════════════════════════════════════
# DEEP PROFILES — the full computed reading, on par with the big systems.
# Each returns a list of short lines (the body); deep_signature() adds the title.
# ══════════════════════════════════════════════════════════════════════════════

def _deep_numerology(b, name):
    from app.services.numerology.core import get_numerology
    r = get_numerology(name or "", _date(b)) or {}
    mk, bk, nk = r.get("mulank") or {}, r.get("bhagyank") or {}, r.get("namank") or {}
    py = r.get("personal_year") or {}
    L = []
    if mk.get("number"):
        L.append(f"Driver (Mulank) {mk['number']} — {mk.get('name', '')}, ruled by {mk.get('planet', '')}: {mk.get('traits', '')}.")
        if mk.get("strengths"):
            L.append(f"  gift — {mk['strengths']}; shadow — {mk.get('weaknesses', '')}.")
    if bk.get("number"):
        L.append(f"Destiny (Bhagyank) {bk['number']} — {bk.get('name', '')}: the arc the whole life bends toward — {bk.get('traits', '')}.")
    if nk.get("number"):
        L.append(f"Name vibration (Namank) {nk['number']} — how the world meets the name.")
    # BOTH were always computed and neither was ever named. Someone asking for their
    # Chaldean number was handed a single unlabelled figure and no way to tell whether
    # it was the one they meant — the two methods disagree often, which is the whole
    # reason practitioners quote them separately.
    _ch, _py = (nk.get("chaldean") or {}), (nk.get("pythagorean") or {})
    if _ch.get("root") or _py.get("root"):
        L.append(f"  by method — Chaldean {_ch.get('root', '—')}, Pythagorean {_py.get('root', '—')}"
                 f" (they differ often; name whichever they asked for).")
    if py.get("personal_year"):
        L.append(f"This personal year runs on {py['personal_year']} — {py.get('theme', '')}.")
    return L


def _deep_mayan(b, name):
    from app.services.mayan.core import mayan_signature
    s = mayan_signature(int(b["year"]), int(b["month"]), int(b["day"]))
    return [
        f"Galactic signature {s.tzolkin} — the {s.tzolkin_sign_glyph} ({s.tzolkin_sign}): {s.tzolkin_seed}.",
        f"Tone {s.tzolkin_tone} {s.tzolkin_tone_name} — how that nature moves: {s.tone_seed}.",
        f"Solar station (Haab): {s.haab}.  Long Count: {s.long_count}.",
        "Read: the day-sign is the nature you act from; the tone is the beat it moves on — together they set the myth being lived.",
    ]


def _deep_celtic(b, name):
    from app.services.celtic.core import celtic_tree
    c = celtic_tree(int(b["month"]), int(b["day"]))
    return [
        f"The {c.tree} tree (Ogham {c.ogham}), its moon {c.range_str}.",
        f"Nature: {c.seed}.",
    ]


def _deep_aztec(b, name):
    from app.services.aztec.core import tonalpohualli
    a = tonalpohualli(int(b["year"]), int(b["month"]), int(b["day"]))
    return [
        f"Tonalpohualli day {a.day} — the {a.sign_english} ({a.sign}): {a.sign_seed}.",
        f"The number {a.number} sets the intensity the sign is carried with.",
    ]


def _deep_ninestar(b, name):
    from app.services.ninestar.core import nine_star
    n = nine_star(int(b["year"]), int(b["month"]), int(b["day"]))
    out = [
        f"Principal star {n.name} — {n.element}, trigram {n.trigram}: {n.seed}.",
        f"Its supportive direction is {n.direction} — where energy tends to open for you.",
    ]
    # The month and tendency stars, and this year's afflicted directions. Directionology
    # is the half of Nine Star Ki people actually consult it for.
    try:
        from app.services.ninestar.deep import full_report
        r = full_report(int(b["year"]), int(b["month"]), int(b["day"]))
        ms, ts = r["month_star"], r["tendency_star"]
        out.append(f"Month star {ms['name']} ({ms['element']}) — how you were formed, "
                   f"beneath how you appear.")
        out.append(f"Tendency star {ts['name']} ({ts['element']}) — the emotional "
                   f"undertow, strongest under pressure.")
        d = r["directionology"]
        bad = [f"{x['direction']} ({x['name']})" for x in d["afflicted"] if x["direction"]]
        if bad:
            out.append(f"Afflicted directions in {d['year']}: " + ", ".join(bad)
                       + f". Open: {', '.join(d['unafflicted']) or 'none'}.")
    except Exception:
        pass
    return out


def _deep_native(b, name):
    from app.services.native.core import native_totem
    t = native_totem(int(b["month"]), int(b["day"]))
    return [
        f"Birth totem the {t.name} — clan {t.clan}, of the {t.direction}.",
        f"Nature: {t.seed}.",
    ]


def _deep_mahabote(b, name):
    from app.services.mahabote.core import mahabote, HOUSES
    m = mahabote(int(b["year"]), int(b["month"]), int(b["day"]),
                 hour=int(b.get("hour")) if b.get("hour") is not None else None)
    out = [
        f"Day-lord {m.burmese} — {m.planet}, the {m.animal} ({m.element}, {m.direction}).",
        f"Nature: {m.seed}.",
        f"Burmese year {m.burmese_year}; the day-lord sits in {m.own_house} — "
        f"{m.own_house_meaning}",
        "The seven houses, each with the planet that fell in it:",
    ]
    # One line per house, each carrying its MEANING — not seven names on one line.
    # The engine had all of this and the renderer was dropping it: "Binga Moon; Ahtun
    # Mars; Yaza Mercury; ..." reads as an index to be summarised, and got summarised —
    # a reply asked to read the whole chart used two of the seven. Adipati and Marana
    # were the two that survived, and they were the only two rendered with meanings.
    # So give every house what those two had.
    for h, _, meaning in HOUSES:
        v = m.houses.get(h)
        if not v:
            continue
        mark = "  " if h != m.own_house else "  » "     # » marks where the day-lord sits
        out.append(f"{mark}{h} ({meaning.split('—')[0].strip()}): {v['planet']} — "
                   f"{v['planet_meaning']}")
    # The two that decide a Mahabote reading: what carries you and what takes from you.
    for key in ("Adipati", "Marana"):
        h = m.houses.get(key)
        if h:
            out.append(f"{key} is the {'strongest' if key == 'Adipati' else 'gravest'} of the "
                       f"seven and holds {h['planet']}: {h['planet_meaning']} in the house of "
                       f"{h['meaning'].split('—')[0].strip()}.")
    return out


def _deep_tibetan(b, name):
    from app.services.tibetan.core import tibetan_year, full
    t = tibetan_year(int(b["year"]))
    out = [
        f"Birth sign {t.sign} — element {t.element} ({t.element_seed}).",
        f"The {t.animal}: {t.animal_seed}.  Rabjung cycle {t.rabjung_cycle}, year {t.year_in_cycle} of 60.",
    ]
    # The nag-rtsis layer — mewa, parkha and the five forces — is what distinguishes
    # Tibetan practice from Chinese, so a deep profile that stops at the year sign has
    # given the reader the half they could have got from the Chinese engine.
    try:
        f = full(int(b["year"]), (b.get("gender") or "male"))
        mw, pk = f.get("mewa") or {}, f.get("parkha") or {}
        if mw:
            out.append(f"Mewa {mw.get('number')} {mw.get('colour')} — {mw.get('meaning')}.")
        if pk:
            out.append(f"Parkha {pk.get('name')} ({pk.get('element')}) — {pk.get('meaning')}.")
        forces = (f.get("forces") or {}).get("forces") or {}
        if forces:
            weak = (f.get("forces") or {}).get("most_exposed")
            out.append("The five forces: " + "; ".join(
                f"{k} {v['element']} ({v['state']})" for k, v in forces.items()))
            if weak:
                out.append(f"Most exposed this year: {weak} — {forces[weak]['read']}.")
    except Exception:
        pass
    return out


def _deep_egyptian(b, name):
    from app.services.egyptian.core import egyptian_decan
    e = egyptian_decan(int(b["year"]), int(b["month"]), int(b["day"]),
                       int(_g(b, "hour", 12)), int(_g(b, "minute", 0)))
    return [
        f"Decan {e['name']} — decan {e['decan_in_sign']} of {e['sign']}, ruled by {e['ruler']}.",
        f"The ruler's charge: {e['ruler_seed']}.",
    ]


def _deep_sacred(b, name):
    from app.services.sacred.core import sacred_geometry
    r = sacred_geometry(int(b["year"]), int(b["month"]), int(b["day"]))
    sld, pat = r["solid"], r["pattern"]
    return [
        f"Ruling solid the {sld[0]} — {sld[1]} ({sld[2]} faces): {sld[3]}.",
        f"The pattern you live inside — {pat[0]}: {pat[1]}.",
    ]


def _deep_alchemy(b, name):
    from app.services.alchemy.core import alchemy
    a = alchemy(int(b["year"]), int(b["month"]), int(b["day"]),
                int(_g(b, "hour", 12)), int(_g(b, "minute", 0)),
                float(_g(b, "lat", 28.6)), float(_g(b, "lng", 77.2)))
    op = a.operation
    return [
        f"Base metal {a.metal} ({a.planet}) — {a.metal_seed}.",
        f"The operation now alive: {op[0]} — {op[1]}: {op[2]}.",
        "Read: the Work is turning that base metal toward Gold — the realised Self.",
    ]


def _deep_hermetic(b, name):
    from app.services.hermetic.core import hermetic
    r = hermetic(int(b["year"]), int(b["month"]), int(b["day"]))
    return [
        f"Governing law — {r['name']}: “{r['axiom']}”",
        f"To live: {r['seed']}.",
    ]


def _deep_taoist(b, name):
    from app.services.taoist.core import taoist
    t = taoist(int(b["year"]), int(b["month"]), int(b["day"]),
               int(_g(b, "hour", 12)), int(_g(b, "minute", 0)))
    return [
        f"Ruling phase {t.phase} ({t.polarity}, {t.tendency}) — {t.seed}.",
        f"It feeds {t.generates} and it checks {t.controls}; its season is {t.phase_season}.",
        "Wu wei: move with this grain, not against it.",
    ]


def _deep_kabbalah(b, name):
    from app.services.kabbalah.core import tree_of_life
    r = tree_of_life(int(b["year"]), int(b["month"]), int(b["day"]), name or "")
    sp, w, ltr = r.sephirah, r.world, r.letter
    return [
        f"Governing Sephirah {sp[2]} — {sp[3]}: {sp[4]}.",
        f"In the World of {w[0]} — {w[2]}.",
        f"Walking the Path of {ltr[1]} ({ltr[0]}, ‘{ltr[2]}’) — a {ltr[3]} letter ({ltr[4]}).",
        f"(life-path {r.life_path})",
    ]


# ══════════════════════════════════════════════════════════════════════════════
# REGISTRY — one entry per system: id -> label, router aliases/facets, both depths.
# Order = reading order in the briefing.
# ══════════════════════════════════════════════════════════════════════════════

SIGNS = {
    "numerology": {"label": "Numerology",       "aliases": ["numerology", "numbers", "life path", "mulank", "bhagyank", "lucky number",
                               "chaldean", "pythagorean", "ank jyotish", "anka", "name number",
                               "destiny number", "birth number", "personal year"],
                   "facets": "driver_number, destiny_number, name_number, personal_year", "one": _numerology, "deep": _deep_numerology},
    "mayan":      {"label": "Mayan",            "aliases": ["mayan", "maya", "tzolkin", "galactic signature", "dreamspell"],
                   "facets": "galactic_signature, day_sign, galactic_tone, haab, long_count", "one": _mayan, "deep": _deep_mayan},
    "celtic":     {"label": "Celtic tree",      "aliases": ["celtic", "druid", "ogham", "tree sign"],
                   "facets": "tree_sign, ogham, seed", "one": _celtic, "deep": _deep_celtic},
    "aztec":      {"label": "Aztec",            "aliases": ["aztec", "nahuatl", "tonalpohualli"],
                   "facets": "day_sign, sacred_number", "one": _aztec, "deep": _deep_aztec},
    "ninestar":   {"label": "Nine Star Ki",     "aliases": ["nine star", "9 star", "nine star ki", "kyusei", "feng shui star",
                                "directionology", "bad direction", "bad directions", "unlucky direction",
                                "auspicious direction", "direction to travel", "which direction"],
                   "facets": "principal_star, element, direction, trigram", "one": _ninestar, "deep": _deep_ninestar},
    "native":     {"label": "Native totem",     "aliases": ["native totem", "native american", "totem", "medicine wheel", "spirit animal", "birth animal"],
                   "facets": "totem, clan, direction", "one": _native, "deep": _deep_native},
    "mahabote":   {"label": "Mahabote",         "aliases": ["mahabote", "burmese", "day lord"],
                   "facets": "day_lord, planet, animal, element, mahabote_houses, adipati, marana, thike", "one": _mahabote, "deep": _deep_mahabote},
    "tibetan":    {"label": "Tibetan",          "aliases": ["tibetan", "rabjung", "tibet"],
                   "facets": "birth_sign, element, animal, rabjung", "one": _tibetan, "deep": _deep_tibetan},
    "egyptian":   {"label": "Egyptian decan",   "aliases": ["egyptian", "decan", "decanate"],
                   "facets": "decan, ruler", "one": _egyptian, "deep": _deep_egyptian},
    "sacred":     {"label": "Sacred geometry",  "aliases": ["sacred geometry", "platonic", "geometry", "flower of life", "metatron"],
                   "facets": "ruling_solid, pattern", "one": _sacred, "deep": _deep_sacred},
    "alchemy":    {"label": "Alchemy",          "aliases": ["alchemy", "alchemical", "great work", "metals", "magnum opus"],
                   "facets": "base_metal, operation, phase", "one": _alchemy, "deep": _deep_alchemy},
    "hermetic":   {"label": "Hermetic law",     "aliases": ["hermetic", "kybalion", "hermeticism", "seven laws", "as above so below"],
                   "facets": "governing_law, axiom", "one": _hermetic, "deep": _deep_hermetic},
    "taoist":     {"label": "Taoist phase",     "aliases": ["taoist", "taoism", "wu xing", "five phases", "wu wei"],
                   "facets": "ruling_phase, polarity, generating_cycle", "one": _taoist, "deep": _deep_taoist},
    "kabbalah":   {"label": "Kabbalah",         "aliases": ["kabbalah", "kabbalistic", "tree of life", "sephirah", "sefirot", "gematria path"],
                   "facets": "sephirah, world, path_letter", "one": _kabbalah, "deep": _deep_kabbalah},
}

# Consumed by the systems registry so the cross-system router can pick these too.
SIGNATURE_IDS = set(SIGNS)
MINOR_SYSTEMS = {sid: {"label": s["label"], "aliases": s["aliases"], "sections": s["facets"]}
                 for sid, s in SIGNS.items()}


def is_signature_system(sid: str) -> bool:
    return sid in SIGNS


_HEADER = "=== THE WIDER COUNCIL — every other system, in brief (real, computed) ===\n"


def wider_council(birth_data: Optional[dict], name: str = "", exclude: Optional[Iterable[str]] = None) -> str:
    """One compact block: a computed one-line signature from every system (minus any in
    `exclude`, e.g. the systems already rendered in full by deep_council). Empty string if
    there's no usable birth data or nothing computed. Never raises."""
    if not birth_data:
        return ""
    skip = set(exclude or ())
    lines = []
    for sid, s in SIGNS.items():
        if sid in skip:
            continue
        try:
            v = s["one"](birth_data, name)
            if v:
                lines.append(f"{s['label']} — {v}")
        except Exception:
            pass
    return _HEADER + "\n".join(lines) if lines else ""


def deep_signature(sid: str, birth_data: Optional[dict], name: str = "") -> str:
    """A FULL computed profile for one system, titled like the big traditions. Empty
    string if the system is unknown, there's no birth data, or nothing computed."""
    if not birth_data or sid not in SIGNS:
        return ""
    s = SIGNS[sid]
    try:
        body = s["deep"](birth_data, name) or []
    except Exception as exc:
        # Same silence that hid the broken sections, in the other half of the council: a
        # system wins a deep slot, its profile raises, the block vanishes, and the prompt
        # still lists it as consulted. Say it out loud and keep going.
        try:
            from .section_errors import note_section_failure
            note_section_failure(sid, "deep_signature", exc)
        except Exception:
            pass
        return ""
    # Most deep functions return a list of lines, but several in signatures_extended and
    # signatures_more return one pre-joined string. Iterating a string yields CHARACTERS,
    # so those were being rendered one letter per line into the prompt — Tibetan, Thai,
    # Weton, Pawukon, Ba Zhai, Plum Blossom and Tai Yi all silently arrived as vertical
    # alphabet soup. Normalising here fixes every one of them and any added later.
    if isinstance(body, str):
        body = body.splitlines()
    body = [ln for ln in body if ln and str(ln).strip()]
    if not body:
        return ""
    title = f"=== {s['label'].upper()} — the deep signature (real, computed) ==="
    return title + "\n" + "\n".join(body)


def deep_council(birth_data: Optional[dict], name: str = "", sids: Optional[Iterable[str]] = None) -> str:
    """Full profiles for the given systems (the ones a question actually called for),
    stacked into one block. Empty string if none produced. Never raises."""
    if not birth_data:
        return ""
    out = []
    for sid in (sids or []):
        blk = deep_signature(sid, birth_data, name)
        if blk:
            out.append(blk)
    return "\n\n".join(out)
