"""ONE ANSWER: THE ORACLE'S PIPELINE, THEN THE REPLY, STREAMED.

  1. the pipeline    process_oracle_query (app/services/oracle/pipeline.py): the subsystem router picks what to read, the engines compute it
                     from the person's birth details, the council weighs it, and what comes out is the reply's system prompt (the persona, the
                     rules, the data). With no birth details it is the no-chart prompt, which reads what it can and asks for them when the
                     question needs them
  2. the reply       the chat chain (app/core/llm.py: Sonnet 5.5 at low thinking under ORACLE_PROFILE=bot, with its spares), streamed. A model
                     that is down before its first word hands the reply to the next one, and the conversation keeps the one that took over
  3. what comes back the words as they come; then the whole text, the route to send back next turn (a follow-up on the same subject reuses
                     it), a draw if one was laid, and what it cost in dollars: the reply's own cost, which OpenRouter reports, and a fixed
                     allowance for the machinery before it (the router, the planner and the council, a few small calls)
"""
from __future__ import annotations

import json
from typing import Any, Callable, Dict, List, Literal, Optional

from pydantic import BaseModel, Field, field_validator

from .errors import WorkerError
from .reply import _ANSWER_NOW, _THINKING_HEADROOM, _build_messages, _drop_planning, _reply_budget, _split_lead, _voice_rule

# The router's pick, the planner and the council's verdicts: a few calls on the fast chain, about this much for one question.
MACHINERY_USD = 0.004
_LEAD_MAX = 600


class Turn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=4000)


class Birth(BaseModel):
    """Where and when they were born, as the engine reads it: the local time at the place, which the engine turns into UT itself."""
    year: int = Field(ge=1800, le=2100)
    month: int = Field(ge=1, le=12)
    day: int = Field(ge=1, le=31)
    hour: int = Field(ge=0, le=23)
    minute: int = Field(ge=0, le=59)
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    name: Optional[str] = Field(default=None, max_length=80)
    gender: Optional[str] = Field(default=None, max_length=20)
    place: Optional[str] = Field(default=None, max_length=120)


class AnswerRequest(BaseModel):
    message: str = Field(min_length=1, max_length=8000)
    history: List[Turn] = Field(default_factory=list, max_length=12)
    birth: Optional[Birth] = None
    last_route: Optional[Dict[str, Any]] = None
    session: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9:_\-]+$")
    language: str = Field(default="en", max_length=16)
    stream: bool = True

    @field_validator("last_route")
    @classmethod
    def _small_route(cls, v):
        if v is not None and len(json.dumps(v)) > 20000:
            raise ValueError("last_route is too large")
        return v


Emit = Callable[[Dict[str, Any]], None]


async def answer(req: AnswerRequest, emit: Emit) -> Dict[str, Any]:
    import httpx
    from app.core import llm
    from app.services.oracle.pipeline import process_oracle_query

    history = [t.model_dump() for t in req.history]
    emit({"t": "status", "stage": "reading"})
    try:
        result = await process_oracle_query(
            req.message, req.birth.model_dump() if req.birth else None, history, "plutto",
            session_id=req.session, last_route=req.last_route)
    except llm.ModelsUnavailable:
        raise WorkerError("models_down", "The oracle can't reach a model right now. Nothing was lost; try again in a moment.", 503)

    emit({"t": "status", "stage": "thinking"})
    intent = result.get("intent") or {}
    role = "deep" if result.get("deep") and llm.has_deep() else "chat"
    messages = _build_messages(result["system_prompt"], history, req.message, _voice_rule(intent, req.language))
    budget = _reply_budget(intent)
    payload = {"messages": messages, "max_tokens": budget + _THINKING_HEADROOM, "temperature": 0.75, "usage": {"include": True}}

    text, lead, lead_done, usd, model = "", "", False, None, None

    def say(piece: str) -> None:
        nonlocal text
        if piece:
            text += piece
            emit({"t": "text", "text": piece})

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=15.0)) as client:
            resp, cm, model = await llm.open_stream(client, role, payload, session=req.session)
            try:
                async for line in resp.aiter_lines():
                    if not line.startswith("data: ") or line[6:].strip() == "[DONE]":
                        continue
                    try:
                        chunk = json.loads(line[6:])
                    except ValueError:
                        continue
                    cost = (chunk.get("usage") or {}).get("cost")
                    if isinstance(cost, (int, float)):
                        usd = float(cost)
                    piece = (((chunk.get("choices") or [{}])[0].get("delta") or {}).get("content")) or ""
                    if not piece:
                        continue
                    if lead_done:
                        say(piece)
                        continue
                    lead += piece
                    if _split_lead(_drop_planning(lead, log=False))[0] is not None or len(lead) > _LEAD_MAX:
                        lead_done = True
                        say(_drop_planning(lead))
            finally:
                await cm.__aexit__(None, None, None)
        if not lead_done:
            say(_drop_planning(lead))
    except llm.ModelsUnavailable:
        raise WorkerError("models_down", "The oracle can't reach a model right now. Nothing was lost; try again in a moment.", 503)

    if not text.strip():
        # Nothing left (an empty stream, or planning only): ask once more, directly.
        try:
            again, model = await llm.complete(role, _build_messages(result["system_prompt"], history, req.message,
                                                                    _voice_rule(intent, req.language) + _ANSWER_NOW),
                                              session=req.session, max_tokens=budget + _THINKING_HEADROOM, temperature=0.75,
                                              timeout=90.0, parse=lambda t: _drop_planning(t).strip())
        except llm.ModelsUnavailable:
            raise WorkerError("models_down", "The oracle can't reach a model right now. Nothing was lost; try again in a moment.", 503)
        say(again)

    cast = result.get("cast")
    return {
        "text": text.strip(),
        "route_state": result.get("route_state"),
        "cast": {"deck": cast.get("deck"), "title": cast.get("title"), "spread": cast.get("spread_name"),
                 "picks": [{"position": p.get("label"), "name": p.get("name"), "reversed": bool(p.get("reversed"))} for p in cast.get("picks") or []]}
        if isinstance(cast, dict) else None,
        "chart": bool(req.birth),
        "tier": result.get("tier"),
        "model": model,
        "usd": round((usd or 0.0) + MACHINERY_USD, 5),
    }
