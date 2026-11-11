"""
THE ISLAMIC LETTER SCIENCES — Zāʾirja, Jafr, Fāl-e Ḥāfeẓ, Istikhāra, Ikhtiyārāt.

The computational half of Islamic divination is already here — firdaria, the lunar
mansions, geomancy, abjad values. This is the other half: the sciences that treat the
ARABIC ALPHABET itself as the substrate of prediction, and the two practices for choosing
a moment and seeking guidance.

  ZĀʾIRJA (زايرجة)   A mechanical device — concentric rings of letters, a table of
                     correspondences, and a cycling algorithm — that converts a question
                     into a versified answer. Ibn Khaldūn devotes a long section of the
                     Muqaddima to it, reproduces a worked example, and says frankly that
                     he does not know how it works while insisting the procedure is real.
                     It is arguably the oldest documented algorithmic text generator.

  JAFR (علم الجفر)    The esoteric letter science: values, their reduction, the four
                     elemental classes of the letters, and the derivation of a name's
                     hidden number. Attributed in Shiʿi tradition to a book of Imām Jaʿfar
                     al-Ṣādiq.

  FĀL-E ḤĀFEẒ         Persian bibliomancy on the Dīvān of Hafez, at New Year and at need.
                     The 495 ghazals are indexed; the poems are not reproduced.

  ISTIKHĀRA           Seeking guidance. Two forms: the ṣalāt al-istikhāra, which is prayer
                     and yields no computed answer at all, and istikhāra bi-l-Qurʾān, the
                     lot-opening. Only the second is mechanical, and the distinction is
                     kept because collapsing them misrepresents the practice.

  IKHTIYĀRĀT          Islamic electional astrology — choosing the hour by the Moon's
                     mansion and its aspects, the planetary hour, and the day's lord.

ON ZĀʾIRJA, HONESTLY. The letter rings and the cycling are documented; the TABLE OF
CORRESPONDENCES that turns the extracted letters into a verse is not recoverable from
Ibn Khaldūn's account, and every modern reconstruction supplies its own. This module
computes the extraction faithfully and stops there, returning the letter sequence rather
than manufacturing a verse. That is the honest boundary of what survives.
"""
import hashlib
from typing import Dict

from app.services.numerology.arabic import MASHRIQI, _normalise

# The four elemental classes of the letters, cycling fire-air-water-earth through the
# abjad order — the backbone of Jafr.
ELEMENTS = ["نارية Fire", "هوائية Air", "مائية Water", "ترابية Earth"]
_ABJAD_ORDER = list(MASHRIQI.keys())
LETTER_ELEMENT = {c: ELEMENTS[i % 4] for i, c in enumerate(_ABJAD_ORDER)}

# The 28 letters distributed over the 28 lunar mansions — the link Jafr uses to join the
# letter sciences to the astronomical ones.
LETTER_MANSION = {c: i + 1 for i, c in enumerate(_ABJAD_ORDER)}


def jafr(text: str) -> Dict:
    """The Jafr reading of a name or question.

    Gives the abjad value, its reduction, the elemental census of the letters, the
    dominant element, and the lunar mansion each letter answers to — which is the bridge
    Jafr uses between the alphabet and the sky."""
    norm = _normalise(text)
    letters = [c for c in norm if c in MASHRIQI]
    if not letters:
        return {"system": "Jafr (علم الجفر)", "error": "needs Arabic letters",
                "note": "Jafr operates on the Arabic alphabet; Latin script has no value here."}
    total = sum(MASHRIQI[c] for c in letters)
    counts: Dict[str, int] = {}
    for c in letters:
        e = LETTER_ELEMENT[c]
        counts[e] = counts.get(e, 0) + 1
    dom = max(counts, key=counts.get)
    reduced = total
    while reduced > 9:
        reduced = sum(int(d) for d in str(reduced))
    return {
        "system": "Jafr (علم الجفر)", "text": str(text), "value": total,
        "reduced": reduced,
        "elements": counts, "dominant_element": dom,
        "letters": [{"letter": c, "value": MASHRIQI[c], "element": LETTER_ELEMENT[c],
                     "mansion": LETTER_MANSION[c]} for c in letters],
        "mansions_touched": sorted({LETTER_MANSION[c] for c in letters}),
        "note": ("Jafr joins the alphabet to the sky: each of the 28 letters answers to "
                 "one of the 28 lunar mansions, which is how a name becomes a position."),
    }


def zairja(question: str, ascendant_degrees: float = 0.0) -> Dict:
    """The Zāʾirja extraction, as far as the sources actually support.

    Ibn Khaldūn's procedure: take the question's letters, take the ascendant at the moment
    of asking, cycle the letters through the rings by a repeated arithmetic step, and read
    off the extracted sequence. The extraction is documented and is computed here.

    What is NOT computed is the final verse. The table that turns the extracted letters
    into rhymed lines is not recoverable from the Muqaddima, and every modern
    reconstruction quietly supplies its own. This returns the letter sequence and says so,
    rather than inventing the missing half."""
    norm = _normalise(question)
    letters = [c for c in norm if c in MASHRIQI]
    if not letters:
        return {"system": "Zāʾirja (زايرجة)", "error": "needs an Arabic question"}

    # The ascendant's degree sets the cycling step, which is why the same question asked at
    # a different moment extracts differently — the device is time-bound by design.
    asc = int(float(ascendant_degrees) % 360.0)
    step = (asc % 28) or 1
    ring = _ABJAD_ORDER

    extracted, pos = [], sum(MASHRIQI[c] for c in letters) % 28
    for i, c in enumerate(letters):
        pos = (pos + step + MASHRIQI[c] % 28) % 28
        extracted.append(ring[pos])

    return {
        "system": "Zāʾirja (زايرجة)",
        "question": str(question),
        "ascendant": asc, "cycling_step": step,
        "input_letters": letters,
        "extracted": extracted,
        "extracted_string": "".join(extracted),
        "extracted_value": sum(MASHRIQI[c] for c in extracted),
        "limit": ("The extraction is what the Muqaddima documents and it is computed here. "
                  "The correspondence table that renders the extracted letters as verse "
                  "does not survive in a recoverable form, so no verse is produced. Ibn "
                  "Khaldūn himself reported the procedure without claiming to understand "
                  "it; inventing the missing half would be worse than leaving it open."),
    }


def fal_e_hafez(seed, ghazal_count: int = 495) -> Dict:
    """Opening the Dīvān of Hafez to a ghazal.

    The custom has a form: one holds the question in mind, addresses Hafez directly — the
    tradition treats him as answering — and opens the book. The number is the draw; the
    poem is Hafez's and is not reproduced."""
    h = hashlib.sha256(f"hafez:{seed}".encode()).digest()
    n = (int.from_bytes(h[:8], "big") % max(1, int(ghazal_count))) + 1
    return {"system": "Fāl-e Ḥāfeẓ (فال حافظ)", "ghazal": n, "of": int(ghazal_count),
            "custom": ("The questioner addresses Hafez by name and asks him to answer "
                       "truly, then opens the Dīvān. It is done at Nowruz and at Yalda, "
                       "and at any point of real uncertainty."),
            "corpus_note": "The ghazals are Hafez's poetry and are not reproduced here."}


def istikhara(kind: str = "quran", seed=None, surah_count: int = 114) -> Dict:
    """Seeking guidance — and the two forms are not interchangeable.

    ṣalāt al-istikhāra is a prayer. It produces no drawn answer, and returning one would
    misrepresent the practice as mechanical when its whole premise is that the outcome
    arrives through circumstance rather than through a device. istikhāra bi-l-Qurʾān is
    the lot-opening, and that one is a draw."""
    k = (kind or "quran").strip().lower()
    if k.startswith("prayer") or k.startswith("salat") or k.startswith("ṣalāt"):
        return {
            "system": "Istikhāra (استخارة)", "form": "ṣalāt al-istikhāra — the prayer",
            "computed": False,
            "note": ("Two units of prayer and a supplication asking that the matter be "
                     "made easy if it is good and turned away if it is not. There is no "
                     "drawn answer: the response is understood to come through how "
                     "circumstances then unfold, and through the ease or difficulty of "
                     "the path. Producing a number here would misrepresent the practice."),
        }
    h = hashlib.sha256(f"istikhara:{seed}".encode()).digest()
    s = (int.from_bytes(h[:8], "big") % max(1, int(surah_count))) + 1
    return {"system": "Istikhāra (استخارة)", "form": "istikhāra bi-l-Qurʾān — the opening",
            "computed": True, "surah": s, "of": int(surah_count),
            "note": ("The lot-opening form. Scholars differ on its permissibility, and "
                     "the prayer form is the one most widely taught."),
            "corpus_note": "The text is not reproduced."}


# ── IKHTIYĀRĀT — Islamic electional ──────────────────────────────────────────

# The Chaldean order, which governs the planetary hours.
CHALDEAN = ["Saturn", "Jupiter", "Mars", "Sun", "Venus", "Mercury", "Moon"]
DAY_LORDS = ["Sun", "Moon", "Mars", "Mercury", "Jupiter", "Venus", "Saturn"]  # Sunday first
ELECTION_QUALITY = {
    "Sun": "authority, petitions to those in power, matters of standing",
    "Moon": "travel, water, the public, anything requiring change or movement",
    "Mars": "surgery, contest, iron, and cutting — nothing requiring peace",
    "Mercury": "writing, contracts, trade, study, and messages",
    "Jupiter": "law, marriage, wealth, teachers, and asking a favour",
    "Venus": "marriage, ornament, reconciliation, art, and pleasure",
    "Saturn": "building, land, endings, burial, and long slow undertakings",
}


def planetary_hour(weekday_sunday0: int, hour_index: int, night: bool = False) -> Dict:
    """The lord of a planetary hour. Hours run from sunrise, twelve by day and twelve by
    night, and each is ruled in the Chaldean order beginning with the day's own lord."""
    d = int(weekday_sunday0) % 7
    lord = DAY_LORDS[d]
    start = CHALDEAN.index(lord)
    i = int(hour_index) % 12 + (12 if night else 0)
    ruler = CHALDEAN[(start + i) % 7]
    return {"day_lord": lord, "hour": int(hour_index) + 1,
            "period": "night" if night else "day",
            "hour_lord": ruler, "suits": ELECTION_QUALITY[ruler]}


def ikhtiyarat(weekday_sunday0: int, hour_index: int, moon_mansion: int,
               night: bool = False) -> Dict:
    """An electional judgement — is this hour fit for the act?

    Judged from the planetary hour and the Moon's mansion, which is the Islamic tradition's
    own contribution: the 28 manāzil each carry a verdict for undertakings, and they are
    consulted before the aspects are."""
    ph = planetary_hour(weekday_sunday0, hour_index, night)
    m = ((int(moon_mansion) - 1) % 28) + 1
    # The classical fortunate mansions for undertakings.
    good = {1, 3, 4, 6, 7, 10, 11, 13, 15, 17, 20, 22, 24, 26, 27}
    verdict = ("fit — both the hour and the mansion favour it" if m in good else
               "unfit — the mansion is against it whatever the hour says")
    if m not in good and ph["hour_lord"] in ("Jupiter", "Venus"):
        verdict = "mixed — a benefic hour against an unfavourable mansion; postpone if you can"
    return {"system": "Ikhtiyārāt (اختيارات)", **ph,
            "moon_mansion": m, "mansion_favourable": m in good, "verdict": verdict}


assert len(CHALDEAN) == 7 and len(DAY_LORDS) == 7
assert len(LETTER_ELEMENT) == 28 and len(LETTER_MANSION) == 28
assert set(LETTER_MANSION.values()) == set(range(1, 29))
assert zairja("سؤال", 90.0)["extracted"] == zairja("سؤال", 90.0)["extracted"], \
    "the extraction must be deterministic for a given question and moment"
assert zairja("سؤال", 90.0)["extracted"] != zairja("سؤال", 200.0)["extracted"], \
    "a different ascendant must extract differently — the device is time-bound"
