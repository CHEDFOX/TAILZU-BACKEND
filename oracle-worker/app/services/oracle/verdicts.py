"""
PER-SYSTEM VERDICTS — turning each tradition's computed data into a weighable judgement.

The pipeline already convenes a council: `plan_analysis` runs per tradition, `run_deep`
computes each one's witnesses, and the results are concatenated into one block for the
final synthesis. Each tradition is genuinely consulted — but only in prose, so the
structure is lost and the final call has to work out every implication at once.

This module adds a small step: after a tradition's data is computed, one fast call judges
THAT DATA ALONE against the user's question and returns three fields.

    direction   supportive | adverse | neutral | mixed
    strength    0.0–1.0
    because     one plain sentence, no jargon

Those become `Finding` objects, which the consensus engine weighs by INDEPENDENCE — so
three unrelated traditions agreeing outranks one technique restated three times, and the
final answer's confidence reflects that.

WHY THE JUDGING IS DONE BY THE MODEL AND NOT BY RULES
─────────────────────────────────────────────────────
Hand-written rules would need one per topic per tradition, and people ask about anything.
The model already makes this judgement well; it simply has not been asked to hand it back
in a form that can be weighed. This is a schema change, not a knowledge-engineering
project.

ISOLATION IS THE LOAD-BEARING PART
──────────────────────────────────
Each verdict is formed from ONE tradition's data, in its own call, blind to the others. If
a single call saw every tradition at once, its verdicts would correlate — it would form
one impression and split it five ways — and the independence weighting would be measuring
its own consistency rather than anything about the traditions. The parallel per-system
structure is what makes the arithmetic mean something.
"""
import asyncio
import json
import re
from typing import Dict, List, Optional, Tuple

VERDICT_PROMPT = """You judge ONE divinatory tradition's computed data against a person's question.

You see this tradition's data and NOTHING ELSE. Do not speculate about what other systems
might say — you cannot see them, and your value here is that you are not influenced by them.

Return ONLY this JSON, no other text:
{"direction": "supportive|adverse|neutral|mixed", "strength": 0.0-1.0, "because": "one plain sentence"}

direction — does this tradition's data favour what they asked about, or cut against it?
  supportive  the data points toward what they want or asked about going well
  adverse     it points against
  neutral     the data genuinely says little about this question
  mixed       real factors pull both ways within this one tradition

strength — how strongly this tradition's own data supports that direction.
  0.8-1.0  unambiguous within this tradition
  0.5-0.7  clear but qualified
  0.2-0.4  weak, or resting on a single indicator
  0.0-0.2  barely present

because — ONE sentence a person would understand. No technical terms, no tradition name,
no jargon. "A long supportive period is running and it touches their work" — not
"Jupiter mahadasha with 10th lord placement". This sentence may be read aloud.

Judge only what the data shows. If it says little about the question, say neutral with a
low strength — a tradition that has nothing to say is useful information, and inventing a
verdict to seem helpful corrupts the whole reading."""


def _parse(text: str) -> Optional[Dict]:
    """Pull the verdict JSON out of a model reply, defensively."""
    if not text:
        return None
    m = re.search(r"\{[^{}]*\}", text, re.S)
    if not m:
        return None
    try:
        d = json.loads(m.group(0))
    except Exception:
        return None

    direction = str(d.get("direction", "")).strip().lower()
    if direction not in ("supportive", "adverse", "neutral", "mixed"):
        return None
    try:
        strength = float(d.get("strength", 0.5))
    except Exception:
        strength = 0.5
    strength = max(0.0, min(1.0, strength))
    because = str(d.get("because", "")).strip()
    if not because:
        return None
    return {"direction": direction, "strength": strength, "because": because}


async def judge_one(system_id: str, system_data: str, question: str,
                    api_key: str, model: str, timeout: float = 12.0) -> Optional[Dict]:
    """One tradition's verdict. Returns None on any failure — a missing verdict simply
    drops that system from the council rather than breaking the turn."""
    if not api_key or not model or not system_data:
        return None
    try:
        from app.core import llm
        # The "fast" chain with spares (core/llm.py): a model that is down, or whose verdict cannot be read, hands
        # the request to the next one. Low temperature: the same chart should give the same verdict. This is the one
        # place drift would undermine the weighting.
        v, _ = await llm.complete("fast", [
            {"role": "system", "content": VERDICT_PROMPT},
            {"role": "user", "content": f"QUESTION: {question}\n\nTHIS TRADITION'S DATA:\n{system_data[:6000]}"},
        ], max_tokens=200, temperature=0.1, timeout=timeout, parse=_parse, passes=1)
    except Exception:
        return None
    return {**v, "system": system_id} if v else None


async def judge_all(system_data: Dict[str, str], question: str,
                    api_key: str, model: str) -> List[Dict]:
    """Every consulted tradition, judged in parallel and in isolation."""
    if not system_data:
        return []
    ids = list(system_data.keys())
    results = await asyncio.gather(
        *[judge_one(sid, system_data[sid], question, api_key, model) for sid in ids],
        return_exceptions=True)
    return [r for r in results if isinstance(r, dict) and r]


# ── Mapping a routed system id to the provenance method that represents it ───────────
# The consensus engine reasons over METHODS, because that is where the dependency graph
# lives. A system contributes the method that carries its core computation.
SYSTEM_METHOD = {
    "bphs": "vimshottari_dasha",
    "kp": "kp_sublord",
    "western": "tropical_chart",
    "chinese": "four_pillars",
    "mandala": "rashi_chart",
    "weton": "weton",
    "pawukon": "pawukon",
    "tibetan_elemental": "tibetan_elemental",
    "tibetan": "tibetan_elemental",
    "thai": "thai_horasat",
    "bazhai": "ba_zhai",
    "ifa": "ifa_cast",
    "liuyao": "liu_yao",
    "dreams": "oneiromancy",
    "prakriti": "prakriti",
    "humandesign": "human_design",
    "enneagram": "enneagram",
    # Signature systems without their own registered method fall back to the chart they
    # are computed from, so they cluster correctly rather than posing as independent.
    "numerology": None, "mayan": None, "celtic": None, "aztec": None,
    "ninestar": None, "native": None, "egyptian": None, "kabbalah": None,
    "alchemy": None, "hermetic": None, "sacred": None, "taoist": None,
    "mahabote": None,
}


def to_findings(verdicts: List[Dict], topic: str) -> Tuple[List, List[str]]:
    """Convert verdicts into Finding objects the consensus engine can weigh.

    Returns (findings, skipped_system_ids). A system with no registered method is skipped
    rather than guessed at — the consensus engine reasons over the dependency graph, and a
    method it does not know cannot be placed in it."""
    from app.services.consensus import Finding

    out, skipped = [], []
    for v in verdicts or []:
        method_id = SYSTEM_METHOD.get(v.get("system"))
        if not method_id:
            skipped.append(v.get("system", "?"))
            continue
        try:
            out.append(Finding(
                method_id=method_id,
                topic=topic or "this",
                direction=v["direction"],
                strength=float(v["strength"]),
                basis=v["because"],
            ))
        except Exception:
            skipped.append(v.get("system", "?"))
    return out, skipped


async def council_guidance(system_data: Dict[str, str], question: str, topic: str,
                           api_key: str, model: str) -> Dict:
    """The whole path: judge each tradition, weigh by independence, return tone guidance.

    The returned `guidance` names no system and exposes no machinery — it tells the final
    synthesis HOW SURE TO SOUND. `detail` is the full structure, for the case where the
    user asks how we know."""
    from app.services.consensus import consensus, weight, to_guidance, to_detail

    verdicts = await judge_all(system_data, question, api_key, model)
    if not verdicts:
        return {"guidance": "", "verdicts": [], "weight": None}

    findings, skipped = to_findings(verdicts, topic)
    if not findings:
        return {"guidance": "", "verdicts": verdicts, "weight": None,
                "skipped": skipped}

    result = consensus(findings, topic=topic or "this question", scope="personal")
    return {
        "guidance": to_guidance(result, topic),
        "detail": to_detail(result),
        "weight": weight(result),
        "verdicts": verdicts,
        "skipped": skipped,
        "result": result,
    }
