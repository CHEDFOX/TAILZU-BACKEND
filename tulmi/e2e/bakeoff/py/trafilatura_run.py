"""Runs Trafilatura (the pinned version, in its own venv) over saved pages and prints {id: markdown} as JSON.

    python -I trafilatura_run.py <pages dir> <id> [<id> ...]

Defaults as a user would call it for a page they want read by a model: markdown output, tables and formatting kept, links dropped. Nothing is fetched.
"""
import json, os, sys, time

import trafilatura

pages, ids = sys.argv[1], sys.argv[2:]
out = {}
for i in ids:
    with open(os.path.join(pages, i + ".html"), encoding="utf-8", errors="replace") as f:
        html = f.read()
    t0 = time.perf_counter()
    text, err = "", None
    try:
        text = trafilatura.extract(html, output_format="markdown", include_tables=True, include_formatting=True, include_links=False, include_comments=False) or ""
    except Exception as e:  # an extractor that throws on a page is a result, not a crash
        err = str(e)[:200]
    out[i] = {"text": text, "ms": (time.perf_counter() - t0) * 1000, **({"error": err} if err else {})}
print(json.dumps(out))
