"""LICENCE CHECK: NO AGPL, NO GPL, NOTHING THAT FORBIDS A COMMERCIAL SERVICE, IN ANYTHING THE WORKER INSTALLS.

    python licenses_check.py            # prints every installed distribution with its licence; exits 1 if one is not allowed
    python licenses_check.py --json     # the same as JSON

The worker is a closed-source service's part, so these are refused whatever the package is: AGPL, GPL (any version, including "or later"), SSPL,
Commons Clause, Business Source, PolyForm, Elastic License, any Creative Commons "NonCommercial", OpenRAIL (Marker's and Surya's weights), and by name
PyMuPDF / fitz / pymupdf4llm (AGPL), marker-pdf, surya-ocr and MinerU. LGPL is allowed only as a library used as it is (never modified, never linked
into something we distribute); each one found is listed under "review" so that someone looks. ffmpeg is a program, not a Python package, and is run
as a separate process (docs/media.md says which builds).

A package whose metadata names no licence at all is looked up in KNOWN (checked by hand, with where it was checked) before it fails the run.
"""
from __future__ import annotations

import json
import re
import sys
from importlib import metadata

DENY_NAMES = {"pymupdf", "fitz", "pymupdf4llm", "pymupdfb", "marker-pdf", "surya-ocr", "mineru", "chandra-ocr"}
DENY = re.compile(
    r"(?<![A-Za-z])A?GPL(?:v?\d|(?![A-Za-z]))|GNU General Public|GNU Affero|(?<![A-Za-z])SSPL|Server Side Public|Commons Clause|Business Source|BUSL|PolyForm|Elastic License|"
    r"Non-?Commercial|CC-BY-NC|OpenRAIL|Sustainable Use",
    re.I,
)
LGPL = re.compile(r"LGPL|Lesser General Public", re.I)

# Distributions whose metadata says nothing (or something misleading), looked at by hand: name -> (licence, where it was checked).
KNOWN: dict[str, tuple[str, str]] = {
    "magika": ("Apache-2.0", "PyPI classifiers / GitHub google/magika LICENSE"),
    "markitdown": ("MIT", "GitHub microsoft/markitdown LICENSE"),
    "pillow": ("MIT-CMU (HPND)", "PyPI / GitHub python-pillow LICENSE"),
    "docling": ("MIT", "GitHub docling-project/docling LICENSE"),
    "docling-slim": ("MIT", "GitHub docling-project/docling LICENSE (the same repository)"),
    "docling-core": ("MIT", "GitHub docling-project/docling-core LICENSE"),
    "docling-ibm-models": ("MIT", "GitHub docling-project/docling-ibm-models LICENSE"),
    "docling-parse": ("MIT", "GitHub docling-project/docling-parse LICENSE"),
    "doclang": ("MIT", "PyPI doclang (docling-project)"),
    "rapidocr": ("Apache-2.0", "GitHub RapidAI/RapidOCR LICENSE"),
    "opencv-python-headless": ("Apache-2.0 (bundled FFmpeg is LGPL-2.1)", "PyPI opencv-python LICENSE-3RD-PARTY.txt"),
    "certifi": ("MPL-2.0", "PyPI certifi (a bundle of CA certificates, used unmodified)"),
}


def _licence(d: metadata.Distribution) -> tuple[str, list[str]]:
    m = d.metadata
    expr = (m.get("License-Expression") or "").strip()
    lic = (m.get("License") or "").strip()
    classifiers = [c.split("::")[-1].strip() for c in (m.get_all("Classifier") or []) if c.startswith("License ::")]
    text = expr or (lic if 0 < len(lic) <= 120 else "")
    if not text and classifiers:
        text = "; ".join(classifiers)
    return text, classifiers


def scan() -> dict:
    rows, bad, review, unknown = [], [], [], []
    for d in sorted(metadata.distributions(), key=lambda x: (x.metadata.get("Name") or "").lower()):
        name = (d.metadata.get("Name") or "").strip()
        if not name:
            continue
        key = name.lower().replace("_", "-")
        text, classifiers = _licence(d)
        # What is looked at for the deny list: the expression, the short licence field, the classifiers. (A long licence field is the licence's own
        # text, which can mention other licences without being one.)
        looked = " | ".join([text, *classifiers])
        row = {"name": name, "version": d.version, "licence": text or "(none stated)"}
        rows.append(row)
        if key in DENY_NAMES:
            bad.append({**row, "why": "package is on the deny list"})
        elif DENY.search(looked):
            # An SPDX "A OR B" (or several classifiers) is a choice: fine if one of the choices is free of the deny list. "A AND B" is both.
            choices = [c for c in re.split(r"\sOR\s|;", looked) if c.strip()]
            if len(choices) > 1 and any(not DENY.search(c) for c in choices):
                review.append({**row, "why": "dual-licensed with an option that is allowed"})
            else:
                bad.append({**row, "why": "licence is not allowed"})
        elif LGPL.search(looked):
            review.append({**row, "why": "LGPL: allowed as a library used unmodified"})
        elif not text and key not in KNOWN:
            unknown.append(row)
        elif key in KNOWN and not text:
            row["licence"] = f"{KNOWN[key][0]} (checked by hand: {KNOWN[key][1]})"
    return {"packages": rows, "denied": bad, "review": review, "unknown": unknown}


def main(argv: list[str]) -> int:
    r = scan()
    if "--json" in argv:
        print(json.dumps(r, indent=2))
    else:
        for row in r["packages"]:
            print(f"{row['name']:<34} {row['version']:<14} {row['licence'][:70]}")
        print()
        print(f"{len(r['packages'])} packages, {len(r['denied'])} denied, {len(r['review'])} to review, {len(r['unknown'])} with no licence stated")
        for x in r["review"]:
            print(f"  review: {x['name']} {x['version']}: {x['licence']} ({x['why']})")
        for x in r["denied"]:
            print(f"  DENIED: {x['name']} {x['version']}: {x['licence']} ({x['why']})")
        for x in r["unknown"]:
            print(f"  UNKNOWN: {x['name']} {x['version']}: no licence in its metadata; add it to KNOWN after checking")
    return 1 if r["denied"] or r["unknown"] else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
