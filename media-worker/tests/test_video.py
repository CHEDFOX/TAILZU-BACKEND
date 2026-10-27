"""Video into key frames (scene changes, at most 8) and a sound track (app/video.py), with the real ffmpeg when the machine has it."""
import base64

import pytest

from conftest import HAS_FFMPEG, make_video

pytestmark = pytest.mark.skipif(not HAS_FFMPEG, reason="ffmpeg is not installed here")


def test_three_scenes_give_frames_and_a_sound_track(client, tmp_path):
    r = client.post("/v1/video", make_video(tmp_path, seconds=6))
    assert r.status_code == 200, r.text
    body = r.json()
    assert 5 <= body["duration"] <= 7 and (body["width"], body["height"]) == (320, 240)
    frames = body["frames"]
    assert 3 <= len(frames) <= 8
    assert [f["t"] for f in frames] == sorted(f["t"] for f in frames)
    for f in frames:
        assert base64.b64decode(f["jpeg"])[:3] == b"\xff\xd8\xff"
    assert body["audio"]["mime"] in ("audio/mpeg", "audio/ogg")
    assert len(base64.b64decode(body["audio"]["data"])) > 1000


def test_a_video_with_no_sound_has_no_audio_and_says_nothing_is_wrong(client, tmp_path):
    body = client.post("/v1/video", make_video(tmp_path, seconds=6, audio=False)).json()
    assert body["audio"] is None and len(body["frames"]) >= 3


def test_never_more_than_eight_frames(client, tmp_path):
    # Many scene changes: a colour change every half second for a minute.
    import subprocess

    out = tmp_path / "busy.mp4"
    subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-f", "lavfi", "-i", "testsrc2=s=160x120:r=10:d=20", "-vf", "hue=h=t*200,format=yuv420p", "-c:v", "mpeg4", "-y", str(out)], check=True)
    body = client.post("/v1/video", out.read_bytes()).json()
    assert 1 <= len(body["frames"]) <= 8


def test_a_text_file_renamed_to_a_video_is_not_one(client):
    r = client.post("/v1/video", b"#EXTM3U\n#EXT-X-VERSION:3\nhttp://evil.example/seg.ts\n")
    assert r.status_code == 422 and r.json()["code"] in ("corrupt", "unsupported")


def test_a_playlist_cannot_make_ffmpeg_fetch_anything(client, tmp_path):
    # A concat list naming a file elsewhere: not a media container, so it is refused, and nothing is read.
    secret = tmp_path / "secret.txt"
    secret.write_text("top secret")
    r = client.post("/v1/video", f"ffconcat version 1.0\nfile '{secret}'\n".encode())
    assert r.status_code == 422


def test_a_video_longer_than_the_limit_is_refused(tmp_path):
    from fastapi.testclient import TestClient

    from app.config import Settings
    from app.main import create_app
    from conftest import SECRET, Signed

    c = Signed(TestClient(create_app(Settings(secret=SECRET, video_seconds_max=3))))
    r = c.post("/v1/video", make_video(tmp_path, seconds=6))
    assert r.status_code == 422 and r.json()["code"] == "too_long"
