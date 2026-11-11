"""One answer (server/answer.py): the pipeline once, the reply streamed from the chat chain, and what comes back."""
import json

import pytest

from app.core import llm
from app.services.oracle import pipeline

from conftest import signed

BIRTH = {"year": 1994, "month": 7, "day": 13, "hour": 9, "minute": 30, "lat": 19.07, "lng": 72.87, "place": "Mumbai"}


class FakeStream:
    def __init__(self, pieces, cost=0.021):
        self.pieces, self.cost, self.closed = pieces, cost, False

    async def aiter_lines(self):
        for p in self.pieces:
            yield "data: " + json.dumps({"choices": [{"delta": {"content": p}}]})
        yield "data: " + json.dumps({"choices": [{"delta": {}, "finish_reason": "stop"}], "usage": {"cost": self.cost}})
        yield "data: [DONE]"

    async def __aexit__(self, *a):
        self.closed = True


@pytest.fixture
def stand_ins(monkeypatch):
    seen = {}

    async def fake_pipeline(message, birth, history, system, **kw):
        seen.update(message=message, birth=birth, history=history, system=system, **kw)
        return {"system_prompt": "You are The Oracle.", "intent": {"question_type": "timing", "language": "english"},
                "deep": False, "tier": "focused", "route_state": {"topic": "career", "picks": ["bphs.dasamsa"]},
                "cast": {"deck": "tarot", "title": "Tarot", "spread_name": "Three cards",
                         "picks": [{"label": "Past", "name": "The Tower", "reversed": True}]}}

    stream = FakeStream(["The user's question is clear. ", "January is your month. ", "Start the groundwork now."])

    async def fake_open(client, role, payload, session=None, passes=None):
        seen.update(role=role, payload=payload, session=session)
        return stream, stream, "anthropic/claude-sonnet-5.5@low"

    monkeypatch.setattr(pipeline, "process_oracle_query", fake_pipeline)
    monkeypatch.setattr(llm, "open_stream", fake_open)
    return seen, stream


def _events(client, body):
    raw, headers = signed("/v1/answer", body)
    with client.stream("POST", "/v1/answer", content=raw, headers=headers) as r:
        assert r.status_code == 200 and r.headers["content-type"].startswith("application/x-ndjson")
        return [json.loads(line) for line in r.iter_lines() if line]


def test_the_answer_streams_its_words_then_the_result(client, stand_ins):
    seen, stream = stand_ins
    ev = _events(client, {"message": "When should I apply?", "session": "u1:oracle", "birth": BIRTH,
                          "history": [{"role": "user", "content": "New job this year?"}, {"role": "assistant", "content": "It's open."}],
                          "last_route": {"picks": ["bphs.dasamsa"]}})
    kinds = [e["t"] for e in ev]
    assert kinds[:2] == ["status", "status"] and kinds[-1] == "result" and "text" in kinds
    words = "".join(e["text"] for e in ev if e["t"] == "text")
    assert words == "January is your month. Start the groundwork now."            # the leaked planning is dropped
    result = ev[-1]["result"]
    assert result["text"] == words and result["route_state"]["picks"] == ["bphs.dasamsa"] and result["chart"] is True
    assert result["model"] == "anthropic/claude-sonnet-5.5@low" and result["usd"] == pytest.approx(0.025)
    assert result["cast"]["picks"] == [{"position": "Past", "name": "The Tower", "reversed": True}]
    assert seen["birth"]["lat"] == 19.07 and seen["system"] == "plutto" and seen["session_id"] == "u1:oracle"
    assert seen["last_route"] == {"picks": ["bphs.dasamsa"]} and seen["role"] == "chat" and seen["session"] == "u1:oracle"
    assert seen["payload"]["messages"][-1] == {"role": "user", "content": "When should I apply?"}
    assert "THEIR LANGUAGE" in seen["payload"]["messages"][0]["content"] and stream.closed


def test_without_birth_details_the_engine_is_asked_without_a_chart(client, stand_ins):
    seen, _ = stand_ins
    ev = _events(client, {"message": "Will I be happy?", "session": "u2:oracle"})
    assert seen["birth"] is None and ev[-1]["result"]["chart"] is False


def test_one_json_when_not_streaming(client, stand_ins):
    raw, headers = signed("/v1/answer", {"message": "hi", "session": "u3:oracle", "stream": False})
    r = client.post("/v1/answer", content=raw, headers=headers)
    assert r.status_code == 200 and r.json()["text"].startswith("January")


def test_when_no_model_answers_the_stream_says_so(client, stand_ins, monkeypatch):
    async def down(*a, **k):
        raise llm.ModelsUnavailable("all down")
    monkeypatch.setattr(llm, "open_stream", down)
    ev = _events(client, {"message": "hi", "session": "u4:oracle"})
    assert ev[-1] == {"t": "error", "code": "models_down",
                      "message": "The oracle can't reach a model right now. Nothing was lost; try again in a moment."}
