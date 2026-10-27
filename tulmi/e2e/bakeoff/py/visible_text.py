"""The visible text of saved pages, from a neutral parser (lxml): used only to check the hand-written truth against the pages themselves.

    python -I visible_text.py <pages dir> <id> [<id> ...]    ->  {id: {"text": ..., "main": ..., "pres": [...]}}
"""
import json, os, re, sys

import lxml.html

pages, ids = sys.argv[1], sys.argv[2:]
out = {}
for i in ids:
    doc = lxml.html.parse(os.path.join(pages, i + ".html")).getroot()
    for bad in doc.xpath("//script|//style|//noscript|//svg|//template"):
        bad.drop_tree()
    mains = doc.xpath("//main") or doc.xpath("//article") or doc.xpath('//*[@role="main"]') or doc.xpath('//div[@class="body"]') or doc.xpath("//body")
    out[i] = {
        "text": re.sub(r"\s+", " ", " ".join(doc.itertext())),
        "main": re.sub(r"\s+", " ", " ".join(mains[0].itertext())),
        "mainIsBody": mains[0].tag == "body",
        "pres": [p.text_content() for p in doc.xpath("//pre")],
    }
print(json.dumps(out))
