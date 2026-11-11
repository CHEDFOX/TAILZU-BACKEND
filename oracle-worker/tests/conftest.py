"""The worker's tests run offline: the engine's pipeline and the models are stood in for where a test needs them."""
import hashlib
import json
import os
import secrets
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("OPENROUTER_API_KEY", "test-key")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from server import security  # noqa: E402
from server.config import Settings  # noqa: E402
from server.main import create_app  # noqa: E402

SECRET = b"test-secret-0123456789abcdef0123456789"


def signed(path: str, body: dict, method: str = "POST") -> tuple[bytes, dict]:
    raw = json.dumps(body).encode()
    ts, nonce = int(time.time()), secrets.token_hex(16)
    sig = security.sign(SECRET, ts, nonce, method, path, raw)
    return raw, {"x-tailzu-timestamp": str(ts), "x-tailzu-nonce": nonce, "x-tailzu-signature": sig, "content-type": "application/json"}


@pytest.fixture
def client():
    return TestClient(create_app(Settings(secret=SECRET)))


def body_hash(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()
