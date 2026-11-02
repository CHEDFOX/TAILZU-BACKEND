"""THE ZIP INSIDE EVERY DOCX, XLSX, PPTX, ODT, ODS, ODP AND EPUB, CHECKED BEFORE ANYTHING OPENS IT.

The VPS has checked it already (src/media/zip.ts); this is the second line, in the process that would be hurt. Nothing is inflated here: the
directory is read, and a file that says too many entries, too much once opened, or an entry that grows too many times, is refused as a bomb.
An encrypted entry is a password-protected file. Mirrors the limits in config.py.
"""
from __future__ import annotations

import zipfile

from .config import Settings
from .errors import WorkerError

_RATIO_FROM = 1024 * 1024


def check(path: str, s: Settings) -> zipfile.ZipFile:
    """The open archive if it is safe to read; raises WorkerError otherwise. The caller closes it."""
    try:
        zf = zipfile.ZipFile(path)
    except (zipfile.BadZipFile, OSError):
        raise WorkerError("corrupt", "That file is damaged, so I could not open it.") from None
    try:
        infos = zf.infolist()
        if len(infos) > s.zip_entries_max:
            raise WorkerError("bomb", f"That file holds {len(infos)} parts, which is far more than a document has. I did not open it.")
        declared = 0
        for i in infos:
            if i.flag_bits & 0x1:
                raise WorkerError("password", "That file is password-protected. I can't open it. Save a copy without the password and send it again.")
            declared += i.file_size
            if declared > s.zip_declared_max:
                raise WorkerError("bomb", "That file would grow to far more than its size once opened. I did not open it.")
            if i.file_size > _RATIO_FROM and i.file_size / max(i.compress_size, 1) > s.zip_ratio_max:
                raise WorkerError("bomb", "A part of that file would grow hundreds of times once opened. I did not open it.")
        return zf
    except BaseException:
        zf.close()
        raise


def bounded_read(zf: zipfile.ZipFile, name: str, limit: int) -> bytes:
    """One entry, never more than `limit` bytes: an entry that is bigger than it said is refused."""
    with zf.open(name) as f:
        data = f.read(limit + 1)
    if len(data) > limit:
        raise WorkerError("bomb", "A part of that file is bigger than it says it is. I did not open it.")
    return data
