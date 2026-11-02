"""EVERY JOB RUNS IN A PROCESS OF ITS OWN, WITH A CLOCK, A MEMORY LIMIT AND NO NETWORK.

A file is whatever a stranger made it, and the libraries that read it (a PDF layout model, an office parser, ffmpeg) are large. So the web
process never reads one. It writes the bytes to a private temporary folder and runs `python -m app.child <task> <folder>` as a child, in its own
session, with:

  a clock         the child and everything it started is killed when the job's time is up (killpg), not just asked to stop
  a memory limit  RLIMIT_AS, set by the child itself before it reads anything: a job that wants more dies, the server does not
  a CPU limit     RLIMIT_CPU, a little over the clock
  a file limit    RLIMIT_FSIZE, so a job cannot fill the disk
  no network      app/netguard.py, installed first thing in the child

The child writes `out.json` ({"ok": ...} or {"error": {code, message}}) and any files it makes into the folder; the parent reads them back and
removes the folder. A child that crashes or is killed by the limit is "failed" in words, never a stack trace.
"""
from __future__ import annotations

import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any, Callable

from .errors import WorkerError

ROOT = Path(__file__).resolve().parent.parent
OUT_FILE_MAX = 64 * 1024 * 1024


def run(task: str, data: bytes, args: dict[str, Any], *, timeout: int, memory_mb: int, after: Callable[[Path, dict], Any] | None = None, in_name: str = "in.bin") -> Any:
    """Runs a task in a child process. `after(folder, result)` may read the files the child made before the folder is removed."""
    work = Path(tempfile.mkdtemp(prefix="mw-"))
    try:
        (work / in_name).write_bytes(data)
        (work / "args.json").write_text(json.dumps(args))
        env = {
            "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
            "HOME": str(work),
            "TMPDIR": str(work),
            "LANG": "C.UTF-8",
            "PYTHONHASHSEED": "0",
            "HF_HUB_OFFLINE": "1",
            "TRANSFORMERS_OFFLINE": "1",
            "OMP_NUM_THREADS": os.environ.get("OMP_NUM_THREADS", "2"),
            "TAILZU_LIMIT_AS_MB": str(memory_mb),
            "TAILZU_LIMIT_CPU_S": str(timeout + 10),
            **{k: v for k, v in os.environ.items() if k in ("DOCLING_ARTIFACTS_PATH", "XDG_CACHE_HOME", "HF_HOME", "TORCH_HOME", "VIRTUAL_ENV")},
        }
        proc = subprocess.Popen(
            [sys.executable, "-E", "-s", "-m", "app.child", task, str(work)],
            cwd=str(ROOT), env=env, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True,
        )
        try:
            proc.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            _kill(proc)
            raise WorkerError("timeout", "That file took too long to read, so I stopped. Try a smaller or simpler one.", 504) from None
        out = work / "out.json"
        if proc.returncode != 0 or not out.exists():
            # Killed by a limit (memory, CPU) or a crash. Nothing of its output is shown: it may hold the file's own words.
            raise WorkerError("failed", "I could not read that file: it may be too large or too complex for the reader.", 502)
        result = json.loads(out.read_text())
        if "error" in result:
            e = result["error"]
            raise WorkerError(str(e.get("code", "failed")), str(e.get("message", "I could not read that file.")), 422)
        return after(work, result["ok"]) if after else result["ok"]
    finally:
        shutil.rmtree(work, ignore_errors=True)


def _kill(proc: subprocess.Popen) -> None:
    try:
        os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
    except (ProcessLookupError, PermissionError):
        pass
    try:
        proc.communicate(timeout=5)
    except Exception:
        pass
