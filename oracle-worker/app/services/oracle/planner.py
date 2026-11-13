"""
PLANNER — the LLM-as-astrologer decides WHICH computations a question calls for.

It knows the śāstra (a marriage question wants the 7th, its lord, Venus, the
Darakaraka, the D9, the 7th-cusp sub-lord, Manglik, the daśā…). So we let it pick
the council — from the real toolbox — and the engine returns exact facts. One small
LLM call; runs in parallel with the classifier, so it adds no latency.
"""
import json
from datetime import datetime

from .computations import toolbox_menu


_LENS = {
    'western': "master Western astrologer (the texts: Ptolemy, modern psychological astrology)",
    'chinese': "master BaZi (Four Pillars) astrologer",
}


async def plan_analysis(question, api_key, model, today="", history=None, system="bphs"):
    """Return a list of {name, params} — the computations to consult for this question."""
    system = (system or "bphs").lower()
    if not api_key or not model:
        return []
    _today = today or datetime.now().strftime("%Y-%m-%d")
    lens = _LENS.get(system, "master Vedic astrologer (the texts: BPHS / Jaimini / KP)")
    prompt = f"""You are a {lens}. TODAY is {_today}. For the user's question, decide EXACTLY which computations to consult — the full classical council the texts prescribe for THAT matter — nothing less, nothing padded.

YOUR TOOLBOX (call by name, with params):
{toolbox_menu(system)}

Rules:
- Works for ANY question — common or unusual, spanning any life-area. There is NO fixed topic list: reason from the SIGNIFICATIONS. For whatever the person asks, work out which houses, house-lords, planetary/Jaimini kārakas, divisional chart, and KP sub-lord actually GOVERN that matter, and consult those. Never treat a topic as "unsupported" — every question maps to significators.
- Choose EVERY witness genuinely relevant — the governing houses + their lords, the kāraka(s), the topic's own divisional chart (e.g. marriage→9, career→10, children→7, wealth→2, spirituality→20, and reason out the right varga for anything else), the KP sub-lord of the key house(s), relevant yogas/doshas, chart strength, and the daśā (+ dasha_at / transits_at with the exact date when a time is mentioned or implied).
- Be thorough like a real jyotiṣī, but precise — 5 to 12 witnesses, not a dump.
- Put the right params (which house number, which division, which date YYYY-MM-DD).

Return ONLY JSON: {{ "computations": [ {{"name": "...", "params": {{...}}}} ] }}"""
    try:
        from app.core import llm
        from .classifier import history_messages
        messages = [{"role": "system", "content": prompt}] + history_messages(history, 2)
        messages.append({"role": "user", "content": question})

        def computations(text: str):
            try:
                obj = json.loads(text.replace("```json", "").replace("```", "").strip())
            except Exception:
                return None
            comps = obj.get("computations") if isinstance(obj, dict) else obj
            return comps if isinstance(comps, list) and comps else None
        # The "fast" chain with spares (core/llm.py): a model that is down or answers with nothing usable hands
        # the request to the next one. Structured planning JSON, so no thinking.
        comps, _ = await llm.complete("fast", messages, max_tokens=500, temperature=0.2, timeout=15.0,
                                      extra={"reasoning": {"enabled": False}}, parse=computations, passes=1)
        return comps
    except Exception:
        return []
