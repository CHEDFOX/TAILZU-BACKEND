"""SCANNED AND COMPLEX PDFs, READ BY DOCLING (MIT): LAYOUT, TABLES AND OCR.

The VPS reads a PDF with a text layer itself (unpdf, in Node) and sends only the ones it cannot: pages that are pictures of text, a broken text
layer, or a file the person says has tables. Docling's models (layout, table structure, OCR) are baked into the image when it is built and read from
DOCLING_ARTIFACTS_PATH; the job has no network, so it can fetch nothing. Remote services and external plugins are off.

The page count and the password are checked first with pdfium (it is a Docling dependency): an encrypted PDF is refused in words, and a long one is
refused before any model is loaded. Pages are separated by a form feed in the Markdown, so the VPS can say which page an answer came from.
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Callable

from .config import Settings
from .errors import WorkerError

FILE_MAX = 30 * 1024 * 1024


def _pages(path: Path) -> int:
    import pypdfium2 as pdfium

    try:
        pdf = pdfium.PdfDocument(str(path))
    except pdfium.PdfiumError as e:
        if "password" in str(e).lower():
            raise WorkerError("password", "That PDF is password-protected. I can't open it. Take the password off and send it again.") from None
        raise WorkerError("corrupt", "That PDF is damaged, so I could not read it.") from None
    try:
        return len(pdf)
    finally:
        pdf.close()


def _docling_converter() -> Any:
    from docling.datamodel.base_models import InputFormat
    from docling.datamodel.pipeline_options import PdfPipelineOptions
    from docling.document_converter import DocumentConverter, PdfFormatOption

    opts = PdfPipelineOptions()
    opts.do_ocr = True
    opts.do_table_structure = True
    opts.enable_remote_services = False
    opts.allow_external_plugins = False
    art = os.environ.get("DOCLING_ARTIFACTS_PATH")
    if art:
        opts.artifacts_path = art
    return DocumentConverter(allowed_formats=[InputFormat.PDF], format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=opts)})


def convert_pdf(path: Path, s: Settings, make_converter: Callable[[], Any] | None = None) -> dict[str, Any]:
    n = _pages(path)
    if n > s.pdf_pages_max:
        raise WorkerError("too_long", f"That PDF has {n} pages, and I read {s.pdf_pages_max} at most. Send the part you want asked about.")
    try:
        conv = (make_converter or _docling_converter)()
        res = conv.convert(str(path), max_num_pages=s.pdf_pages_max, max_file_size=FILE_MAX)
        md = res.document.export_to_markdown(page_break_placeholder="\f")
    except WorkerError:
        raise
    except Exception:  # noqa: BLE001 - never repeat a model's or a parser's message: it can quote the file
        raise WorkerError("failed", "The layout reader could not read that PDF.", 502) from None
    notes = []
    if len(md) > s.markdown_chars_max:
        md = md[: s.markdown_chars_max]
        notes.append("The PDF is longer than I take in, so only the first part was read.")
    return {"markdown": md.replace("\x00", ""), "pages": n, "notes": notes}
