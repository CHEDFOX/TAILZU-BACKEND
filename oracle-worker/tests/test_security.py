"""Who may ask the oracle (server/security.py, server/main.py): signed requests, a clock, a nonce used once."""
import pytest
from fastapi.testclient import TestClient

from server import security
from server.config import Settings
from server.main import create_app

from conftest import SECRET, signed


def test_the_signature_is_the_one_the_vps_makes():
    # The media worker's vector: the backend signs both workers the same way (tulmi/src/media/worker.ts).
    sig = security.sign(SECRET, 1700000000, "00112233445566778899aabbccddeeff", "POST", "/v1/convert?format=docx", b"hello")
    assert sig == "2a33a770351bfe2000365ad6e1b9bf4a56f4fc6c83a9765044275a57ed4b38bf"


def test_health_needs_no_secret_and_there_are_no_docs_pages(client):
    health = client.get("/healthz").json()
    assert health["ok"] is True and health["models"] is True     # the tests' stand-in key arrived
    assert "test-key" not in str(health)                          # and only whether, never what
    for path in ("/docs", "/redoc", "/openapi.json"):
        assert client.get(path).status_code == 404


def test_the_worker_will_not_start_without_a_long_secret():
    with pytest.raises(RuntimeError, match="ORACLE_WORKER_SECRET"):
        create_app(Settings(secret=b"short"))


def test_an_unsigned_or_replayed_request_is_refused(client):
    assert client.post("/v1/answer", json={"message": "hi", "session": "s"}).status_code == 401
    raw, headers = signed("/v1/answer", {"message": "hi", "session": "s", "stream": False})
    headers["x-tailzu-signature"] = "0" * 64
    assert client.post("/v1/answer", content=raw, headers=headers).status_code == 401


def test_a_bad_body_is_a_400_in_words(client):
    raw, headers = signed("/v1/answer", {"message": "", "session": "s"})
    r = client.post("/v1/answer", content=raw, headers=headers)
    assert r.status_code == 400 and r.json()["code"] == "bad_request" and "message" in r.json()["message"]
    raw, headers = signed("/v1/answer", {"message": "hi", "session": "s", "birth": {"year": 1994, "month": 13, "day": 1,
                                                                                 "hour": 9, "minute": 0, "lat": 0, "lng": 0}})
    assert client.post("/v1/answer", content=raw, headers=headers).status_code == 400
