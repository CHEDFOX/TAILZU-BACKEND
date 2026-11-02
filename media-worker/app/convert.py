"""OFFICE FILES AND WEB PAGES TO MARKDOWN: docx, xlsx, pptx, epub and html through MarkItDown (MIT), odt, ods and odp through a reader of our own.

Run inside a job's child process (app/isolate.py), so a hostile file can cost the job its life and nothing else.

  docx pptx epub html   MarkItDown. Only the converters we need are registered, none of the ones that can reach the network (audio transcription, YouTube,
                        Wikipedia, Bing) and no plugins. The input is a file on disk with a known extension, never a URL
  xlsx                  the rows of up to six visible sheets are read with openpyxl (read-only, cached values, external links off, formulas never evaluated),
                        500 rows a sheet kept; the Markdown is MarkItDown's when the workbook is small, else a capped version of the same tables
  odt ods odp           the OpenDocument XML read with defusedxml: headings, paragraphs, lists, tables, slides
  every zip format      checked first for a bomb and for encryption (app/zipguard.py)

Returns {"markdown", "pages", "tables": [{name, columns, rows, total_rows}], "notes": [...]}. Macros, fields and formulas are data here; nothing runs.
"""
from __future__ import annotations

import datetime as _dt
import re
from pathlib import Path
from typing import Any

from defusedxml import ElementTree as ET

from . import zipguard
from .config import Settings
from .errors import WorkerError

OOXML = {"docx": "word/document.xml", "xlsx": "xl/workbook.xml", "pptx": "ppt/presentation.xml"}
ODF = {"odt": "text", "ods": "spreadsheet", "odp": "presentation"}
EXT = {"docx": ".docx", "xlsx": ".xlsx", "pptx": ".pptx", "epub": ".epub", "html": ".html"}
OLE2 = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"
XML_PART_MAX = 60 * 1024 * 1024
_DATA_URI = re.compile(r"\(data:[a-z/+.-]+;base64,[A-Za-z0-9+/=\s]{200,}\)")


def convert_file(path: Path, fmt: str, s: Settings) -> dict[str, Any]:
    head = path.read_bytes()[:8]
    if head.startswith(OLE2):
        raise WorkerError("password", "That Office file is password-protected, or an old binary format. I can't open it. Save it as a docx, xlsx or pptx without a password.")
    notes: list[str] = []
    tables: list[dict] = []
    pages: int | None = None

    if fmt == "html":
        md = _markitdown(path, ".html")
    elif fmt in OOXML or fmt in ODF or fmt == "epub":
        zf = zipguard.check(str(path), s)
        try:
            names = set(zf.namelist())
            if fmt in OOXML and OOXML[fmt] not in names:
                raise WorkerError("unsupported", f"That is not a {fmt} file.")
            if fmt == "epub":
                _check_epub(zf)
            if fmt in ODF:
                md, tables, pages = _odf(zf, fmt, s)
            else:
                md = ""
        finally:
            zf.close()
        if fmt == "xlsx":
            tables, text, note = _xlsx(path, s)
            md = text
            if note:
                notes.append(note)
        elif fmt in ("docx", "pptx", "epub"):
            md = _markitdown(path, EXT[fmt])
            if fmt == "pptx":
                pages = len(re.findall(r"<!--\s*Slide number:\s*\d+\s*-->", md)) or None
    else:
        raise WorkerError("unsupported", "I don't read that kind of file.")

    md = _DATA_URI.sub("(image)", md).replace("\x00", "")
    if len(md) > s.markdown_chars_max:
        md = md[: s.markdown_chars_max]
        notes.append("The file is longer than I take in, so only the first part was read.")
    return {"markdown": md, "pages": pages, "tables": tables[: s.tables_max], "notes": notes}


# ------------------------------------------------------------------ MarkItDown


def _markitdown(path: Path, ext: str) -> str:
    from markitdown import MarkItDown, StreamInfo
    from markitdown.converters import DocxConverter, EpubConverter, HtmlConverter, PptxConverter, XlsxConverter

    md = MarkItDown(enable_builtins=False, enable_plugins=False)
    for c in (DocxConverter(), XlsxConverter(), PptxConverter(), EpubConverter(), HtmlConverter()):
        md.register_converter(c)
    try:
        with open(path, "rb") as f:
            result = md.convert_stream(f, stream_info=StreamInfo(extension=ext))
    except WorkerError:
        raise
    except Exception:  # noqa: BLE001 - a parser's complaint can quote the file; the person is told the plain fact
        raise WorkerError("corrupt", "I could not read that file. It may be damaged, or not what its name says.") from None
    return result.markdown or ""


def _check_epub(zf) -> None:
    """An EPUB with DRM is a password-protected file. (Font obfuscation, which every publisher uses, is not DRM.)"""
    if "META-INF/encryption.xml" not in zf.namelist():
        return
    xml = zipguard.bounded_read(zf, "META-INF/encryption.xml", 1024 * 1024).decode("utf8", "replace")
    algos = re.findall(r'Algorithm="([^"]+)"', xml)
    fonts = ("http://www.idpf.org/2008/embedding", "http://ns.adobe.com/pdf/enc#RC")
    if any(a not in fonts for a in algos):
        raise WorkerError("password", "That book is copy-protected (DRM), so I can't open it.")


# ------------------------------------------------------------------ xlsx


def _cell(v: Any) -> Any:
    if v is None:
        return None
    if isinstance(v, bool):
        return "TRUE" if v else "FALSE"
    if isinstance(v, (int, float)):
        return v
    if isinstance(v, (_dt.datetime, _dt.date, _dt.time)):
        return v.isoformat()
    if isinstance(v, (bytes, bytearray)):
        return None
    t = str(v).strip()
    return t[:500] if t else None


def _xlsx(path: Path, s: Settings) -> tuple[list[dict], str, str]:
    from openpyxl import load_workbook

    try:
        # A file object, not a path: openpyxl judges a path by its extension, and the job's file is called in.bin.
        wb = load_workbook(open(path, "rb"), read_only=True, data_only=True, keep_links=False)
    except Exception:  # noqa: BLE001
        raise WorkerError("corrupt", "I could not read that spreadsheet. It may be damaged, or password-protected.") from None
    tables: list[dict] = []
    note = ""
    try:
        for ws in wb.worksheets:
            if getattr(ws, "sheet_state", "visible") != "visible":
                continue
            if len(tables) >= s.tables_max:
                note = f"Only the first {s.tables_max} sheets were read."
                break
            header: list[str] | None = None
            rows: list[list[Any]] = []
            total = 0
            scanned = 0
            for row in ws.iter_rows(values_only=True):
                scanned += 1
                if scanned > 200_000:
                    note = "A sheet has more than 200,000 rows, so only the first of them were counted."
                    break
                cells = [_cell(c) for c in row[: s.columns_max]]
                if all(c is None for c in cells):
                    continue
                if header is None:
                    header = ["" if c is None else str(c) for c in cells]
                    continue
                total += 1
                if len(rows) < s.rows_max:
                    rows.append(cells)
            if header is None:
                continue
            tables.append({"name": str(ws.title)[:80], "columns": header, "rows": rows, "total_rows": total})
    finally:
        wb.close()
    if not tables:
        raise WorkerError("unsupported", "I found no data in that spreadsheet.")
    # MarkItDown for a small workbook (it reads every row of every sheet); our own capped tables otherwise.
    text = ""
    if _declared_size(path) <= 8 * 1024 * 1024:
        try:
            text = _markitdown(path, ".xlsx")
        except WorkerError:
            text = ""
    if not text.strip():
        text = "\n\n".join(f"## {t['name']}\n\n{md_table(t['columns'], t['rows'])}" for t in tables)
        if any(t["total_rows"] > len(t["rows"]) for t in tables):
            note = note or f"Only the first {s.rows_max} rows of each sheet are shown."
    return tables, text, note


def _declared_size(path: Path) -> int:
    import zipfile

    with zipfile.ZipFile(str(path)) as zf:
        return sum(i.file_size for i in zf.infolist())


def md_table(columns: list[str], rows: list[list[Any]]) -> str:
    def esc(v: Any) -> str:
        return ("" if v is None else str(v)).replace("|", "\\|").replace("\n", " ")

    if not columns:
        return ""
    out = ["| " + " | ".join(esc(c) for c in columns) + " |", "| " + " | ".join("---" for _ in columns) + " |"]
    for r in rows:
        out.append("| " + " | ".join(esc(r[i] if i < len(r) else None) for i in range(len(columns))) + " |")
    return "\n".join(out)


# ------------------------------------------------------------------ OpenDocument

_NS = {
    "office": "urn:oasis:names:tc:opendocument:xmlns:office:1.0",
    "text": "urn:oasis:names:tc:opendocument:xmlns:text:1.0",
    "table": "urn:oasis:names:tc:opendocument:xmlns:table:1.0",
    "draw": "urn:oasis:names:tc:opendocument:xmlns:drawing:1.0",
    "manifest": "urn:oasis:names:tc:opendocument:xmlns:manifest:1.0",
}


def _q(prefix: str, tag: str) -> str:
    return "{%s}%s" % (_NS[prefix], tag)


def _text(el) -> str:
    out = [el.text or ""]
    for c in el:
        if c.tag == _q("text", "s"):
            out.append(" " * min(int(c.get(_q("text", "c"), "1") or 1), 50))
        elif c.tag == _q("text", "tab"):
            out.append("\t")
        elif c.tag == _q("text", "line-break"):
            out.append("\n")
        elif c.tag in (_q("text", "note"), _q("office", "annotation")):
            pass
        else:
            out.append(_text(c))
        out.append(c.tail or "")
    return "".join(out)


def _cell_value(cell) -> Any:
    kind = cell.get(_q("office", "value-type"))
    if kind in ("float", "percentage", "currency"):
        try:
            v = float(cell.get(_q("office", "value")))
            return int(v) if v.is_integer() else v
        except (TypeError, ValueError):
            return None
    if kind == "date":
        return cell.get(_q("office", "date-value"))
    text = "\n".join(_text(p) for p in cell.findall(_q("text", "p"))).strip()
    return text[:500] or None


def _odf_table(tbl, s: Settings) -> tuple[list[str], list[list[Any]], int]:
    grid: list[list[Any]] = []
    total = 0
    for row in tbl.iter(_q("table", "table-row")):
        if len(grid) >= s.rows_max + 1 and total > s.rows_max + 1:
            break
        cells: list[Any] = []
        for c in row:
            if c.tag not in (_q("table", "table-cell"), _q("table", "covered-table-cell")):
                continue
            repeat = min(int(c.get(_q("table", "number-columns-repeated"), "1") or 1), s.columns_max)
            cells.extend([_cell_value(c)] * repeat)
            if len(cells) >= s.columns_max:
                break
        cells = cells[: s.columns_max]
        while cells and cells[-1] is None:
            cells.pop()
        if not cells:
            continue
        total += 1
        if len(grid) < s.rows_max + 1:
            grid.append(cells)
    if not grid:
        return [], [], 0
    width = max(len(r) for r in grid)
    header = ["" if v is None else str(v) for v in (grid[0] + [None] * (width - len(grid[0])))]
    body = [r + [None] * (width - len(r)) for r in grid[1:]]
    return header, body, max(0, total - 1)


def _walk(el, out: list[str], s: Settings, depth: int = 0) -> None:
    for c in el:
        tag = c.tag
        if tag == _q("text", "h"):
            level = min(max(int(c.get(_q("text", "outline-level"), "1") or 1), 1), 6)
            t = _text(c).strip()
            if t:
                out.append(f"{'#' * level} {t}")
        elif tag == _q("text", "p"):
            t = _text(c).strip()
            if t:
                out.append(t)
        elif tag == _q("text", "list"):
            for item in c.iter(_q("text", "list-item")):
                t = " ".join(_text(p).strip() for p in item.findall(_q("text", "p")) if _text(p).strip())
                if t:
                    out.append(f"{'  ' * depth}- {t}")
        elif tag == _q("table", "table"):
            header, body, _ = _odf_table(c, s)
            if header:
                out.append(md_table(header, body))
        elif tag in (_q("text", "section"), _q("draw", "frame"), _q("draw", "text-box"), _q("draw", "custom-shape"), _q("draw", "g")):
            _walk(c, out, s, depth + 1)


def _odf(zf, fmt: str, s: Settings) -> tuple[str, list[dict], int | None]:
    names = set(zf.namelist())
    if "META-INF/manifest.xml" in names:
        manifest = zipguard.bounded_read(zf, "META-INF/manifest.xml", 4 * 1024 * 1024)
        if b"encryption-data" in manifest:
            raise WorkerError("password", "That file is password-protected. I can't open it. Save a copy without the password and send it again.")
    if "content.xml" not in names:
        raise WorkerError("unsupported", f"That is not an {fmt} file.")
    try:
        root = ET.fromstring(zipguard.bounded_read(zf, "content.xml", XML_PART_MAX))
    except WorkerError:
        raise
    except Exception:  # noqa: BLE001
        raise WorkerError("corrupt", "I could not read that file. It may be damaged.") from None
    body = root.find(_q("office", "body"))
    if body is None or len(body) == 0:
        raise WorkerError("unsupported", "I found no text in that file.")
    out: list[str] = []
    tables: list[dict] = []
    pages: int | None = None
    kind = ODF[fmt]
    inner = body.find(_q("office", kind))
    if inner is None:
        raise WorkerError("unsupported", f"That is not an {fmt} file.")
    if kind == "text":
        _walk(inner, out, s)
    elif kind == "spreadsheet":
        for tbl in inner.findall(_q("table", "table")):
            if len(tables) >= s.tables_max:
                break
            header, rows, total = _odf_table(tbl, s)
            if not header:
                continue
            name = (tbl.get(_q("table", "name")) or f"Sheet{len(tables) + 1}")[:80]
            tables.append({"name": name, "columns": header, "rows": rows, "total_rows": total})
            out.append(f"## {name}\n\n{md_table(header, rows)}")
    else:
        slides = inner.findall(_q("draw", "page"))
        pages = len(slides)
        for i, page in enumerate(slides, 1):
            parts: list[str] = []
            _walk(page, parts, s)
            out.append(f"<!-- Slide number: {i} -->\n" + "\n\n".join(parts))
    return "\n\n".join(out), tables, pages
