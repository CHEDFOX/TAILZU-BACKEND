"""A VIDEO INTO WHAT CAN BE READ: KEY FRAMES AT THE SCENE CHANGES (AT MOST 8) AND THE SOUND TRACK, BOTH BY ffmpeg.

ffmpeg is run as a separate program (a GPL-enabled build is fine that way; it is never linked or shipped), in this job's child process, with:
  - `-protocol_whitelist file`: a container that names another address (an HLS playlist, a concat list) cannot make it read one
  - a format allowlist, checked with ffprobe first: only real media containers; a text file renamed .mp4 is refused
  - `-nostdin`, no output but into this job's folder, the job's clock and memory limit

FRAMES. The first frame, then every frame where the scene changes by more than 0.3 (ffmpeg's `scene` score), 1024 pixels wide at most, as JPEG; if that
gives fewer than four (a talking head, a slide that stays), evenly spaced frames are added until there are six or so. Never more than 8, in time order.
SOUND. Mono, 16 kHz, 32 kbit/s MP3 (Opus in Ogg when the build has no MP3 encoder): small, and what a speech-to-text service wants. No audio track, no audio.
"""
from __future__ import annotations

import base64
import json
import re
import subprocess
from pathlib import Path
from typing import Any

from .config import Settings
from .errors import WorkerError

FORMATS_OK = {"mov", "mp4", "m4a", "3gp", "3g2", "mj2", "matroska", "webm", "avi", "flv", "ogg", "mp3", "wav", "flac", "aac", "amr", "aiff", "asf"}
SCENE = 0.3
WIDTH = 1024
MIN_FRAMES = 4
_COMMON = ["-nostdin", "-hide_banner", "-protocol_whitelist", "file"]


def _run(cmd: list[str], timeout: int) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(cmd, stdin=subprocess.DEVNULL, capture_output=True, timeout=timeout, check=False)
    except subprocess.TimeoutExpired:
        raise WorkerError("timeout", "That video took too long to read, so I stopped.", 504) from None
    except FileNotFoundError:
        raise WorkerError("failed", "The video reader is not installed on this worker.", 503) from None


def probe(path: Path, s: Settings) -> dict[str, Any]:
    r = _run(["ffprobe", "-v", "error", "-protocol_whitelist", "file", "-print_format", "json", "-show_format", "-show_streams", str(path)], 30)
    if r.returncode != 0:
        raise WorkerError("corrupt", "I could not read that video. It may be damaged, or not what its name says.")
    try:
        info = json.loads(r.stdout or b"{}")
    except ValueError:
        raise WorkerError("corrupt", "I could not read that video.") from None
    names = set(str(info.get("format", {}).get("format_name", "")).split(","))
    if not names & FORMATS_OK:
        raise WorkerError("unsupported", "That is not a video or sound file I read.")
    duration = float(info.get("format", {}).get("duration") or 0)
    if duration > s.video_seconds_max:
        raise WorkerError("too_long", f"That video is {round(duration / 60)} minutes long, and I read {s.video_seconds_max // 60} at most.")
    return info


def _scene_frames(path: Path, folder: Path, s: Settings) -> list[tuple[float, Path]]:
    pattern = str(folder / "s%02d.jpg")
    vf = f"select='eq(n\\,0)+gt(scene\\,{SCENE})',scale='min({WIDTH}\\,iw)':-2,showinfo"
    r = _run(["ffmpeg", *_COMMON, "-i", str(path), "-an", "-sn", "-dn", "-vf", vf, "-fps_mode", "vfr", "-frames:v", str(s.frames_max), "-q:v", "4", "-y", pattern], 240)
    times = [float(t) for t in re.findall(r"pts_time:\s*([0-9.]+)", r.stderr.decode("utf8", "replace"))]
    files = sorted(folder.glob("s*.jpg"))
    return [(times[i] if i < len(times) else 0.0, f) for i, f in enumerate(files)]


def _frame_at(path: Path, folder: Path, t: float, n: int) -> Path | None:
    out = folder / f"u{n:02d}.jpg"
    r = _run(["ffmpeg", *_COMMON, "-ss", f"{t:.2f}", "-i", str(path), "-an", "-sn", "-dn", "-frames:v", "1", "-vf", f"scale='min({WIDTH}\\,iw)':-2", "-q:v", "4", "-y", str(out)], 60)
    return out if r.returncode == 0 and out.exists() and out.stat().st_size > 0 else None


def frames(path: Path, folder: Path, duration: float, s: Settings) -> list[tuple[float, bytes]]:
    got = _scene_frames(path, folder, s)
    if len(got) < MIN_FRAMES and duration > 3:
        taken = [t for t, _ in got]
        for i in range(6):
            t = duration * (i + 0.5) / 6
            if len(got) >= min(6, s.frames_max):
                break
            if any(abs(t - x) < 1.0 for x in taken):
                continue
            f = _frame_at(path, folder, t, i)
            if f:
                got.append((t, f))
                taken.append(t)
    got.sort(key=lambda x: x[0])
    return [(t, f.read_bytes()) for t, f in got[: s.frames_max]]


def audio(path: Path, folder: Path, s: Settings) -> tuple[str, bytes] | None:
    for codec, ext, mime, extra in (("libmp3lame", "mp3", "audio/mpeg", []), ("libopus", "ogg", "audio/ogg", ["-application", "voip"])):
        out = folder / f"a.{ext}"
        r = _run(["ffmpeg", *_COMMON, "-i", str(path), "-vn", "-sn", "-dn", "-map", "0:a:0", "-ac", "1", "-ar", "16000", "-c:a", codec, "-b:a", "32k", *extra, "-y", str(out)], 280)
        if r.returncode == 0 and out.exists() and out.stat().st_size > 0:
            data = out.read_bytes()
            if len(data) > s.audio_bytes_max:
                raise WorkerError("too_long", "The sound of that video is longer than I take in.")
            return mime, data
    return None


def read_video(path: Path, folder: Path, s: Settings) -> dict[str, Any]:
    info = probe(path, s)
    streams = info.get("streams", [])
    vids = [x for x in streams if x.get("codec_type") == "video" and not x.get("disposition", {}).get("attached_pic")]
    has_audio = any(x.get("codec_type") == "audio" for x in streams)
    duration = float(info.get("format", {}).get("duration") or 0)
    notes: list[str] = []
    fr: list[tuple[float, bytes]] = []
    if vids:
        fr = frames(path, folder, duration, s)
        if not fr:
            notes.append("No picture could be taken out of the video.")
    else:
        notes.append("That file has sound but no picture.")
    sound = audio(path, folder, s) if has_audio else None
    if has_audio and sound is None:
        notes.append("The sound could not be taken out of the video.")
    v = vids[0] if vids else {}
    return {
        "duration": duration, "width": int(v.get("width") or 0), "height": int(v.get("height") or 0),
        "frames": [{"t": round(t, 2), "jpeg": base64.b64encode(b).decode()} for t, b in fr],
        "audio": {"mime": sound[0], "data": base64.b64encode(sound[1]).decode()} if sound else None,
        "notes": notes,
    }
