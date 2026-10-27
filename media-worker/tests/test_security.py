"""Who may call the worker (app/security.py, app/main.py): signed requests, a clock, a nonce used once, and bounded bodies."""
import threading
import time

import pytest
from fastapi.testclient import TestClient

from app import isolate, security
from app.config import Settings
from app.errors import WorkerError
from app.main import create_app

from conftest import SECRET, Signed


def test_the_signature_is_the_one_the_vps_makes():
    # The same vector tulmi/tests/ingest-worker.test.ts checks: the two sides cannot drift apart.
    sig = security.sign(b"test-secret-0123456789abcdef0123456789", 1700000000, "00112233445566778899aabbccddeeff", "POST", "/v1/convert?format=docx", b"hello")
    assert sig == "2a33a770351bfe2000365ad6e1b9bf4a56f4fc6c83a9765044275a57ed4b38bf"


def test_signed_lines_are_version_time_nonce_method_path_and_body_hash():
    lines = security.signed_lines(5, "ab", "post", "/v1/image?max=512", "deadbeef").decode().split("\n")
    assert lines == ["v1", "5", "ab", "POST", "/v1/image?max=512", "deadbeef"]


def test_health_needs_no_secret_and_says_nothing_about_files(client):
    r = client.client.get("/healthz")
    assert r.status_code == 200
    assert set(r.json()) == {"ok", "version", "markitdown", "docling", "ffmpeg"}
    assert r.headers["cache-control"] == "no-store"


def test_there_are_no_docs_pages_to_find(client):
    for path in ("/docs", "/redoc", "/openapi.json"):
        assert client.client.get(path).status_code == 404


def test_the_worker_will_not_start_with_a_missing_or_short_secret():
    with pytest.raises(RuntimeError, match="MEDIA_WORKER_SECRET"):
        create_app(Settings(secret=b""))
    with pytest.raises(RuntimeError):
        create_app(Settings(secret=b"short"))


@pytest.mark.parametrize("missing", ["x-tailzu-timestamp", "x-tailzu-nonce", "x-tailzu-signature"])
def test_a_request_missing_a_header_is_refused(client, missing):
    path, body = "/v1/convert?format=docx", b"x"
    h = client.headers("POST", path, body)
    del h[missing]
    r = client.client.post(path, content=body, headers=h)
    assert r.status_code == 401 and r.json()["code"] == "auth"


def test_a_request_with_a_bad_signature_wrong_secret_or_malformed_headers_is_refused(client):
    path, body = "/v1/convert?format=docx", b"x"
    assert client.post(path, body, secret=b"another-secret-0123456789abcdef012345").status_code == 401
    h = client.headers("POST", path, body)
    h["x-tailzu-signature"] = "0" * 64
    assert client.client.post(path, content=body, headers=h).status_code == 401
    h = client.headers("POST", path, body)
    h["x-tailzu-nonce"] = "not hex!"
    assert client.client.post(path, content=body, headers=h).status_code == 401
    h = client.headers("POST", path, body)
    h["x-tailzu-timestamp"] = "yesterday"
    assert client.client.post(path, content=body, headers=h).status_code == 401


def test_a_body_a_path_or_a_query_changed_after_signing_is_refused(client):
    path, body = "/v1/convert?format=docx", b"original"
    h = client.headers("POST", path, body)
    assert client.client.post(path, content=b"swapped!", headers=h).status_code == 401
    h = client.headers("POST", path, body)
    assert client.client.post("/v1/convert?format=xlsx", content=body, headers=h).status_code == 401
    h = client.headers("POST", path, body)
    assert client.client.post("/v1/pdf", content=body, headers=h).status_code == 401


def test_a_request_too_old_or_too_new_is_refused(client):
    path, body = "/v1/convert?format=docx", b"x"
    now = int(time.time())
    for ts in (now - 61, now + 61, now - 3600):
        r = client.post(path, body, ts=ts)
        assert r.status_code == 401, ts
        assert "too old or too new" in r.json()["message"]
    # Just inside the window the signature is checked and the request goes on (to an unsupported-file answer).
    assert client.post(path, body, ts=now - 30).status_code != 401


def test_a_nonce_works_once(client, monkeypatch):
    monkeypatch.setattr(isolate, "run", lambda *a, **k: {"markdown": "", "pages": None, "tables": [], "notes": []})
    path, body = "/v1/convert?format=docx", b"x"
    first = client.post(path, body, nonce="ab" * 16)
    assert first.status_code == 200
    replay = client.post(path, body, nonce="ab" * 16)
    assert replay.status_code == 401 and "already made" in replay.json()["message"]
    assert client.post(path, body, nonce="cd" * 16).status_code == 200


def test_a_forged_request_does_not_use_up_a_nonce(client, monkeypatch):
    monkeypatch.setattr(isolate, "run", lambda *a, **k: {"markdown": "", "pages": None, "tables": [], "notes": []})
    path, body = "/v1/convert?format=docx", b"x"
    assert client.post(path, body, nonce="ef" * 16, secret=b"another-secret-0123456789abcdef012345").status_code == 401
    assert client.post(path, body, nonce="ef" * 16).status_code == 200


def test_nonces_are_remembered_for_their_time_and_then_forgotten_and_the_cache_is_bounded():
    c = security.NonceCache(ttl=10, max_entries=4)
    assert c.use("a", 0) and not c.use("a", 5) and c.use("a", 11)
    for n in "bcde":
        assert c.use(n, 100)
    with pytest.raises(WorkerError) as e:
        c.use("f", 101)
    assert e.value.code == "busy"
    assert c.use("f", 111)


def test_an_unknown_format_or_a_non_pdf_is_refused_after_the_signature(client):
    assert client.post("/v1/convert?format=exe", b"x").json()["code"] == "unsupported"
    r = client.post("/v1/pdf", b"this is not a pdf")
    assert r.status_code == 422 and r.json()["message"] == "That is not a PDF."
    assert client.post("/v1/image?format=gif", b"x").status_code == 400
    assert client.post("/v1/image?max=99999", b"x").status_code == 422
    assert client.post("/v1/convert?format=docx", b"").json()["code"] == "unsupported"


def test_a_body_over_the_cap_is_refused_before_it_is_read():
    s = Settings(secret=SECRET, body_max={"convert": 100, "pdf": 100, "image": 100, "video": 100})
    c = Signed(TestClient(create_app(s)))
    body = b"x" * 101
    r = c.post("/v1/convert?format=docx", body)
    assert r.status_code == 413 and r.json()["code"] == "too_big"
    # Even when the length is not declared up front.
    h = c.headers("POST", "/v1/convert?format=docx", body)
    r2 = c.client.post("/v1/convert?format=docx", content=(chunk for chunk in (body[:50], body[50:])), headers={k: v for k, v in h.items()})
    assert r2.status_code == 413


def test_a_busy_worker_says_so_instead_of_queueing_without_end(monkeypatch):
    s = Settings(secret=SECRET, concurrency=1)
    c = Signed(TestClient(create_app(s)))
    started, release = threading.Event(), threading.Event()

    def slow(*a, **k):
        started.set()
        release.wait(5)
        return {"markdown": "", "pages": None, "tables": [], "notes": []}

    monkeypatch.setattr(isolate, "run", slow)
    first = {}
    t = threading.Thread(target=lambda: first.update(r=c.post("/v1/convert?format=docx", b"x")))
    t.start()
    assert started.wait(5)
    r = c.post("/v1/convert?format=docx", b"y")
    assert r.status_code == 503 and r.json()["code"] == "busy" and r.headers["retry-after"] == "5"
    release.set()
    t.join(5)
    assert first["r"].status_code == 200
    # The slot is free again.
    monkeypatch.setattr(isolate, "run", lambda *a, **k: {"markdown": "", "pages": None, "tables": [], "notes": []})
    assert c.post("/v1/convert?format=docx", b"z").status_code == 200
