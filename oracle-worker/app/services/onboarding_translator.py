"""
Backend-driven content for the birth onboarding screen.

Canonical English baseline lives here. For any other language we ask the
LLM to translate while keeping the poetic register intact, then cache the
result to disk so each language is generated at most once per copy revision.

Cache layout:
  data/cache/onboarding_birth/<lang>.json

A translation that comes back INCOMPLETE is filled from the English baseline
rather than discarded — see _normalize. Discarding it was the bug that stalled
onboarding: one missing key threw away nine good strings, became a 5xx, and the
client retried forever on a screen the user was watching.

TranslationUnavailable still exists for a genuinely unusable response, but the
caller (onboarding_content) no longer turns it into a 5xx — it serves English and
warms in the background.

The auth screen is text-free (handled visually) and is NOT translated here.
"""

import asyncio
import json
from pathlib import Path

import httpx

from app.core.config import settings
# The salvaging JSON parser, shared with the router. classifier imports nothing
# from app, so this cannot cycle.
from app.services.oracle.classifier import _loads_salvaging


BIRTH_BASELINE = {
    "identityTitle":    "Who Are You?",
    "namePlaceholder":  "Your name",
    "genderMale":       "MALE",
    "genderFemale":     "FEMALE",
    "genderOther":      "OTHER",
    "combinedTitle":    "When Did You Arrive\nOn Earth?",
    "placeTitle":       "Where Did You Take\nYour First Breath?",
    "placePlaceholder": "Search city",
    "continue":         "CONTINUE",
    # Translated and shipped, currently unrendered. The auth screen's welcome
    # sequence was removed after review, but the run that produced these across
    # all 109 languages had already happened — and _normalize drops any key not
    # in this schema, so taking them out would strip work already paid for and
    # committed. Left here: two short strings, no cost, and putting the sequence
    # back becomes a frontend change with nothing to re-translate.
    "welcomeLead":      "Welcome to",
    "welcomeSpace":     "Your space",
    # The brand travels with the line now, so it is translated too — a
    # transliteration into each script rather than the Latin wordmark stranded
    # inside a Devanagari or Japanese sentence. The model is told to render the
    # SOUND of the name, not to find a meaning for it.
    "welcomeBrand":     "Plutto",
    "labels": {
        "day":    "DAY",
        "month":  "MONTH",
        "year":   "YEAR",
        "hour":   "HOUR",
        "minute": "MINUTE",
    },
}

GENDER_ICONS = {
    "male":   "icons/gender_male",
    "female": "icons/gender_female",
    "other":  "icons/gender_other",
}

# SHIPPED TRANSLATIONS — the canonical copy, in version control.
#
# These used to live only in data/cache/, which is exactly what it says: 107 of the
# 109 files were untracked and existed on one server. Rebuild that box, clear the
# directory, or deploy anywhere else and every language is cold again — and a cold
# language is what stalled onboarding in the first place. A cache you cannot afford
# to lose is not a cache; it is source data kept in the wrong place.
#
# So the languages ship WITH the code. Loaded once at import, checked before the
# disk cache and long before the model, which means the ordinary path for every
# user in every language makes no LLM call at all: no cost, no latency, and nothing
# that can fail. The model is now only for a language added without a translation,
# and warm_onboarding.py --export folds that back into this file.
_BUNDLED_PATH = Path(__file__).resolve().parent / "data" / "onboarding_translations.json"
_BUNDLED: dict = {}
try:
    with _BUNDLED_PATH.open("r", encoding="utf-8") as _f:
        _BUNDLED = json.load(_f) or {}
except Exception:
    _BUNDLED = {}

_CACHE_ROOT = Path(__file__).resolve().parents[2] / "data" / "cache"
_CACHE_DIR = _CACHE_ROOT / "onboarding_birth"
try:
    _CACHE_DIR.mkdir(parents=True, exist_ok=True)
except Exception:
    pass

# THE VOICE, not just the words. The old hint — "poetic, minimal, soft — titles for
# a Vedic astrology app" — said nothing about how to ADDRESS the reader, so each
# language guessed. Half of Europe came back formal: "Qui êtes-vous ?", "Кто вы?",
# "Ко сте Ви?", "Kimsiniz?" — the register of a tax form — while German, Spanish,
# Italian, Dutch and Polish came back intimate. Every one of them is a correct
# translation and the app still ends up sounding like two different products.
#
# For a language where "correct" and "in character" diverge, in character wins:
# this is an oracle speaking to one person, not an institution processing them.
_REGISTER_HINT = (
    "Poetic, minimal, soft — screen titles for an oracle speaking to one person "
    "it knows.\n"
    "ADDRESS: use the INTIMATE second person — the form kept for someone close "
    "(tú, du, tu, ty, तुम) — NEVER the polite or distancing one (usted, Sie, vous, "
    "вы, आप, 당신). This matters more than any other instruction here: the formal "
    "form is not wrong, it is simply a different product. Where a language's plain "
    "form would be genuinely rude to a stranger rather than merely informal (Korean, "
    "Japanese), take the warmest register that is not rude — never the most "
    "deferential one, and never the bureaucratic one.\n"
    "SHAPE: match the English capitalisation pattern where the script has capitals. "
    "Keep it short — a title on a screen, not a sentence. Keep the line breaks.\n"
    "NEVER: clinical, administrative, or phrased like a form field or a survey "
    "question."
)

_memory_cache: dict = {"en": BIRTH_BASELINE}
_generic_mem: dict = {}     # generic copy bundles, keyed "<cache_name>:<lang>"
_locks: dict = {}


class TranslationUnavailable(Exception):
    """Raised when a non-English translation cannot be produced."""


def _safe_lang(language: str) -> str:
    return "".join(c for c in (language or "") if c.isalnum() or c in "-_").lower() or "en"


def _normalize(obj, schema, _missing=None):
    """Coerce obj to the schema's shape, FILLING any gap from the schema itself.

    This used to return None the moment a single key was absent, which threw the
    whole translation away — and because the schema is the English baseline, the
    thing being discarded was nine good translated strings over one the model
    happened to omit. Downstream that became TranslationUnavailable, a 5xx, and a
    client that retries forever while the user watches the loading animation. Every
    retry asked the same model the same question and got the same omission, so the
    failure was permanent rather than transient.

    Filling is strictly better: the reader gets nine strings in their language and
    one in English, instead of an app that never leaves the transition. What is
    genuinely unusable — a response that is not a dict at all — still returns None,
    so a real failure is still a failure.

    Missing keys are collected so the caller can log which languages came back
    incomplete; a translation that is quietly half-English should be visible."""
    if isinstance(schema, dict):
        if not isinstance(obj, dict):
            return None
        out = {}
        for k, sub in schema.items():
            if k not in obj:
                if _missing is not None:
                    _missing.append(k)
                out[k] = sub                     # English, rather than nothing
                continue
            cleaned = _normalize(obj[k], sub, _missing)
            if cleaned is None:
                if _missing is not None:
                    _missing.append(k)
                out[k] = sub
                continue
            out[k] = cleaned
        return out
    if obj is None:
        return None
    return str(obj)


def _disk_path(lang: str, cache_dir: Path = _CACHE_DIR) -> Path:
    return cache_dir / f"{lang}.json"


def _load_from_disk(lang: str, cache_dir: Path = _CACHE_DIR, baseline=BIRTH_BASELINE):
    path = _disk_path(lang, cache_dir)
    if not path.exists():
        return None
    try:
        with path.open("r", encoding="utf-8") as f:
            return _normalize(json.load(f), baseline)
    except Exception:
        return None


def _save_to_disk(lang: str, content, cache_dir: Path = _CACHE_DIR):
    try:
        cache_dir.mkdir(parents=True, exist_ok=True)
        with _disk_path(lang, cache_dir).open("w", encoding="utf-8") as f:
            json.dump(content, f, ensure_ascii=False, indent=2)
    except Exception:
        pass


def _build_prompt(target_language_name: str, baseline=BIRTH_BASELINE, register: str = _REGISTER_HINT,
                  language_code: str = "") -> str:
    baseline_json = json.dumps(baseline, ensure_ascii=False, indent=2)
    # NAME THE LANGUAGE BY CODE AS WELL AS BY NAME. The registry stores each
    # language's name in its OWN script — so the instruction used to read
    # "translate into ᱥᱟᱱᱛᱟᱲᱤ" or "translate into ꯃꯤꯇꯩꯂꯣꯟ", which asks the model to
    # recognise Ol Chiki or Meitei Mayek before it can even identify the target. A
    # model that does not will translate into the wrong language, refuse, or emit
    # something that fails to parse — and it fails hardest for exactly the smaller
    # languages that most need the support. The ISO code is unambiguous and costs
    # four tokens.
    target = f"{target_language_name} (ISO 639 code: {language_code})" if language_code \
        else target_language_name
    return (
        f"Translate this onboarding UI copy into {target}.\n\n"
        f"Register: {register}.\n"
        "Preserve the exact JSON shape and keys. Where '\\n' appears in a "
        "string, the translation must keep a '\\n' at a visually balanced "
        "break so the line splits nicely. Keep short labels short. Keep "
        "uppercase ACTION words uppercase if the script supports caps; "
        "otherwise use the natural emphatic short form.\n\n"
        # welcomeBrand is a NAME. Without this the model looks for a meaning —
        # 'Plutto' is close enough to Pluto that several scripts would happily
        # return their word for the planet, or for wealth, and the product would
        # be called something different in every language.
        "'welcomeBrand' is the product's NAME, not a word. Render its SOUND in "
        "the target script (a transliteration), never its meaning, and never a "
        "word that merely resembles it. If the script is Latin, leave it exactly "
        "as it is.\n\n"
        "Return ONLY the translated JSON object. No prose, no markdown fences.\n\n"
        f"English baseline:\n{baseline_json}"
    )


async def _translate_via_llm(language_code: str, language_name: str, baseline=BIRTH_BASELINE, register: str = _REGISTER_HINT):
    if not getattr(settings, "OPENROUTER_API_KEY", None):
        return None
    prompt = _build_prompt(language_name, baseline, register, language_code)
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            r = await client.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {settings.OPENROUTER_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": settings.OPENROUTER_MODEL,
                    "messages": [
                        {"role": "system", "content": "You translate UI copy. Output only valid JSON. No prose."},
                        {"role": "user", "content": prompt},
                    ],
                    "temperature": 0.3,
                    # Two keys were added to the baseline after this number was
                    # chosen, and non-Latin scripts spend far more tokens per
                    # character than the English they are translating — which is
                    # why the truncation showed up in Bodo and not in Spanish.
                    "max_tokens": 1100,
                    "response_format": {"type": "json_object"},
                },
            )
            if r.status_code != 200:
                print(f"[onboarding_translator] HTTP {r.status_code} for {language_code}")
                return None
            data = r.json()
            raw = data["choices"][0]["message"]["content"].strip()
            if raw.startswith("```"):
                raw = raw.strip("`")
                if raw.lower().startswith("json"):
                    raw = raw[4:]
                raw = raw.strip()
            missing = []
            # SALVAGE a truncated reply instead of losing the language.
            #
            # brx (Bodo) failed with "Unterminated string": the model's JSON was
            # cut off mid-value, json.loads raised, and the whole language was
            # marked unavailable — for a tail it never got to, when every key
            # before the cut had arrived intact. _loads_salvaging closes the
            # structures the model had already opened and returns the complete
            # part; _normalize then fills whatever is still missing from the
            # English baseline. Losing the last string is a blemish. Losing the
            # language is what stalled onboarding in the first place.
            out = _normalize(_loads_salvaging(raw), baseline, missing)
            if missing:
                print(f"[onboarding_translator] {language_code}: model omitted "
                      f"{len(missing)} key(s) {missing[:6]} — filled from English",
                      flush=True)
            return out
    except Exception as e:
        print(f"[onboarding_translator] error for {language_code}: {e}")
        return None


async def get_birth_content(language_code: str, language_name: str):
    """Birth-screen copy (translated) + gender icon media paths."""
    content = await _resolve_birth_copy(language_code, language_name)
    return {**content, "genderIcons": GENDER_ICONS}


async def _resolve_birth_copy(language_code: str, language_name: str):
    """Return the birth-screen copy for the given language.

    Raises TranslationUnavailable if the language is non-English and we
    cannot produce a complete translation (no cache, LLM failed, etc.).
    English always succeeds with the baseline.
    """
    lang = _safe_lang(language_code)
    if lang == "en":
        return BIRTH_BASELINE
    if lang in _memory_cache:
        return _memory_cache[lang]
    shipped = _BUNDLED.get(lang)
    if shipped:
        got = _normalize(shipped, BIRTH_BASELINE)
        if got:
            _memory_cache[lang] = got
            return got
    disk = _load_from_disk(lang)
    if disk:
        _memory_cache[lang] = disk
        return disk
    lock = _locks.setdefault(lang, asyncio.Lock())
    async with lock:
        if lang in _memory_cache:
            return _memory_cache[lang]
        disk = _load_from_disk(lang)
        if disk:
            _memory_cache[lang] = disk
            return disk
        generated = await _translate_via_llm(lang, language_name or lang)
        if generated:
            _memory_cache[lang] = generated
            _save_to_disk(lang, generated)
            return generated
    raise TranslationUnavailable(f"Could not translate birth content into '{lang}'")


async def translate_copy(baseline, cache_name: str, register: str, language_code: str, language_name: str):
    """Translate an arbitrary bundle of UI strings (any nested dict of strings)
    into `language_code`, cached on disk (data/cache/onboarding_<cache_name>/
    <lang>.json) + in memory. English returns the baseline unchanged.

    Reuses the same LLM + normalize + cache machinery as the birth screen, so any
    onboarding screen can pass its copy through the app language. Raises
    TranslationUnavailable when a non-English translation can't be produced —
    callers may catch it and fall back to the English baseline.
    """
    lang = _safe_lang(language_code)
    if lang == "en":
        return baseline
    cache_dir = _CACHE_ROOT / f"onboarding_{cache_name}"
    key = f"{cache_name}:{lang}"
    if key in _generic_mem:
        return _generic_mem[key]
    disk = _load_from_disk(lang, cache_dir, baseline)
    if disk:
        _generic_mem[key] = disk
        return disk
    lock = _locks.setdefault(key, asyncio.Lock())
    async with lock:
        if key in _generic_mem:
            return _generic_mem[key]
        disk = _load_from_disk(lang, cache_dir, baseline)
        if disk:
            _generic_mem[key] = disk
            return disk
        generated = await _translate_via_llm(lang, language_name or lang, baseline, register)
        if generated:
            _generic_mem[key] = generated
            _save_to_disk(lang, generated, cache_dir)
            return generated
    raise TranslationUnavailable(f"Could not translate '{cache_name}' copy into '{lang}'")
