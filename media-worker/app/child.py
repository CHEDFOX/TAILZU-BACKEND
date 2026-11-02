"""The child process of a job (app/isolate.py): `python -m app.child <task> <folder>`. Limits first, then the network lock, then the work."""
from __future__ import annotations

import json
import os
import resource
import sys
import traceback
from pathlib import Path


def _limits() -> None:
    mb = int(os.environ.get("TAILZU_LIMIT_AS_MB", "0") or 0)
    cpu = int(os.environ.get("TAILZU_LIMIT_CPU_S", "0") or 0)
    if mb > 0:
        resource.setrlimit(resource.RLIMIT_AS, (mb * 1024 * 1024, mb * 1024 * 1024))
    if cpu > 0:
        resource.setrlimit(resource.RLIMIT_CPU, (cpu, cpu + 5))
    resource.setrlimit(resource.RLIMIT_FSIZE, (256 * 1024 * 1024, 256 * 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))


def main(argv: list[str]) -> int:
    _limits()
    from . import netguard

    netguard.install()
    from .errors import WorkerError
    from .config import Settings

    task, folder = argv[1], Path(argv[2])
    args = json.loads((folder / "args.json").read_text())
    # The limits the server was started with, not the child's own defaults.
    s = Settings.from_public(args.pop("_settings")) if "_settings" in args else Settings.from_env()
    try:
        if task == "convert":
            from .convert import convert_file

            result = convert_file(folder / "in.bin", args["format"], s)
        elif task == "pdf":
            from .pdfdoc import convert_pdf

            result = convert_pdf(folder / "in.bin", s)
        elif task == "image":
            from .images import optimise_file

            result = optimise_file(folder / "in.bin", folder, args, s)
        elif task == "video":
            from .video import read_video

            result = read_video(folder / "in.bin", folder, s)
        elif task == "selftest":
            # For the tests: proves what a job cannot do (no network, a memory limit).
            from .selftest import run as selftest

            result = selftest(args)
        else:
            raise WorkerError("unsupported", "Unknown task.")
        (folder / "out.json").write_text(json.dumps({"ok": result}))
        return 0
    except WorkerError as e:
        (folder / "out.json").write_text(json.dumps({"error": e.as_dict()}))
        return 0
    except MemoryError:
        return 3
    except Exception:  # noqa: BLE001 - nothing of a traceback may reach the person: it can hold their file's words
        traceback.print_exc(file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
